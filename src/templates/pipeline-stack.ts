/**
 * Pipeline Stack CloudFormation Template Generator
 *
 * Creates the pipeline-level stack deployed to the CI/CD account.
 * Contains root ECR repos and S3 buckets for artifacts where per_stage is false.
 *
 * Note: Artifacts with per_stage: true are skipped here - they only exist in stage stacks.
 */

import type { CloudFormationTemplate } from '../types/aws.js';
import type { DockerArtifact, BundleArtifact } from '../types/artifacts.js';
import {
  createBaseTemplate,
  createS3BucketResource,
  createEcrRepositoryResource,
  sanitizeResourceId,
} from './common.js';
import {
  getPipelineStackName,
  generatePipelineEcrRepoName,
  generatePipelineBucketName,
} from '../naming/index.js';
import { getArtifactId } from '../parsers/artifacts.js';

export interface PipelineStackOptions {
  pipelineSlug: string;
  cicdAccountId: string;
  /** Docker artifacts (non per_stage only) */
  dockerArtifacts: DockerArtifact[];
  /** Bundle artifacts (non per_stage only) */
  bundleArtifacts: BundleArtifact[];
}

/**
 * Generate the CloudFormation template for a pipeline stack
 */
export function generatePipelineStackTemplate(options: PipelineStackOptions): CloudFormationTemplate {
  const { pipelineSlug, cicdAccountId, dockerArtifacts, bundleArtifacts } = options;

  const template = createBaseTemplate(`DevRamps Pipeline Stack for ${pipelineSlug}`);

  // Track created resources for outputs
  const ecrOutputs: Record<string, { repoName: string; resourceId: string }> = {};
  const s3Outputs: Record<string, { bucketName: string; resourceId: string }> = {};

  // Create ECR repositories for Docker artifacts
  for (const artifact of dockerArtifacts) {
    const artifactId = getArtifactId(artifact);
    const repoName = generatePipelineEcrRepoName(pipelineSlug, artifactId);
    const resourceId = sanitizeResourceId(`ECR${artifactId}`);

    template.Resources[resourceId] = createEcrRepositoryResource(
      repoName,
      [
        { Key: 'Pipeline', Value: pipelineSlug },
        { Key: 'Artifact', Value: artifact.name },
        { Key: 'ArtifactType', Value: artifact.type },
      ]
    );

    ecrOutputs[artifact.name] = { repoName, resourceId };
  }

  // Create S3 buckets for Bundle artifacts
  for (const artifact of bundleArtifacts) {
    const artifactId = getArtifactId(artifact);
    const bucketName = generatePipelineBucketName(cicdAccountId, pipelineSlug, artifactId);
    const resourceId = sanitizeResourceId(`Bucket${artifactId}`);

    template.Resources[resourceId] = createS3BucketResource(
      bucketName,
      [
        { Key: 'Pipeline', Value: pipelineSlug },
        { Key: 'Artifact', Value: artifact.name },
        { Key: 'ArtifactType', Value: artifact.type },
      ]
    );

    s3Outputs[artifact.name] = { bucketName, resourceId };
  }

  // Add outputs for ECR repos
  for (const [artifactName, { resourceId }] of Object.entries(ecrOutputs)) {
    const safeName = sanitizeResourceId(artifactName);

    template.Outputs![`${safeName}RepoUri`] = {
      Description: `ECR Repository URI for ${artifactName}`,
      Value: { 'Fn::GetAtt': [resourceId, 'RepositoryUri'] },
      Export: { Name: `DevRamps-${pipelineSlug}-${safeName}-RepoUri` },
    };

    template.Outputs![`${safeName}RepoArn`] = {
      Description: `ECR Repository ARN for ${artifactName}`,
      Value: { 'Fn::GetAtt': [resourceId, 'Arn'] },
    };
  }

  // Add outputs for S3 buckets
  for (const [artifactName, { resourceId }] of Object.entries(s3Outputs)) {
    const safeName = sanitizeResourceId(artifactName);

    template.Outputs![`${safeName}BucketName`] = {
      Description: `S3 Bucket name for ${artifactName}`,
      Value: { Ref: resourceId },
      Export: { Name: `DevRamps-${pipelineSlug}-${safeName}-BucketName` },
    };

    template.Outputs![`${safeName}BucketArn`] = {
      Description: `S3 Bucket ARN for ${artifactName}`,
      Value: { 'Fn::GetAtt': [resourceId, 'Arn'] },
    };
  }

  // Add summary outputs
  template.Outputs!.PipelineSlug = {
    Description: 'Pipeline slug',
    Value: pipelineSlug,
  };

  template.Outputs!.ECRRepoCount = {
    Description: 'Number of ECR repositories created',
    Value: String(Object.keys(ecrOutputs).length),
  };

  template.Outputs!.S3BucketCount = {
    Description: 'Number of S3 buckets created',
    Value: String(Object.keys(s3Outputs).length),
  };

  return template;
}

// Re-export stack name function
export { getPipelineStackName };
