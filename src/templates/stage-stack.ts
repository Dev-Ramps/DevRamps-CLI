/**
 * Stage Stack CloudFormation Template Generator
 *
 * Creates the stage-level stack deployed to each stage's account/region.
 * Contains:
 * - Stage deployment role with permissions for pipeline steps
 * - Mirrored ECR repos and S3 buckets for all artifacts
 *
 * Note: OIDC provider is created by the Account Bootstrap stack (once per account)
 */

import type { CloudFormationTemplate } from '../types/aws.js';
import type { PipelineStep, IamPolicy } from '../types/pipeline.js';
import type { DockerArtifact, BundleArtifact } from '../types/artifacts.js';
import { getStepPermissions, hasPermissions } from '../permissions/index.js';
import { MIRROR_ECR_PERMISSIONS } from '../permissions/mirror-ecr.js';
import { MIRROR_S3_PERMISSIONS } from '../permissions/mirror-s3.js';
import {
  createBaseTemplate,
  buildOidcTrustPolicy,
  createIamRoleResource,
  createS3BucketResource,
  createEcrRepositoryResource,
  sanitizeResourceId,
} from './common.js';
import { OIDC_PROVIDER_URL } from '../types/config.js';
import {
  getStageStackName,
  generateStageRoleName,
  generateStageEcrRepoName,
  generateStageBucketName,
  generateTerraformStateBucketName,
} from '../naming/index.js';
import { getArtifactId } from '../parsers/artifacts.js';

export interface StageStackOptions {
  pipelineSlug: string;
  stageName: string;
  orgSlug: string;
  accountId: string;
  /** All steps in the pipeline */
  steps: PipelineStep[];
  /** Additional IAM policies from aws_additional_iam_policies.yaml */
  additionalPolicies: IamPolicy[];
  /** All Docker artifacts (for stage ECR repos) */
  dockerArtifacts: DockerArtifact[];
  /** All Bundle artifacts (for stage S3 buckets) */
  bundleArtifacts: BundleArtifact[];
  /** Override the OIDC provider URL (e.g. from endpoint override) */
  oidcProviderUrl?: string;
  /** Additional AWS account IDs to add to role trust policies (for local dev testing) */
  additionalTrustedAccounts?: string[];
  /** Skip OIDC federation in trust policies (for localhost testing) */
  skipOidc?: boolean;
}

/**
 * Generate the CloudFormation template for a stage stack
 */
export function generateStageStackTemplate(options: StageStackOptions): CloudFormationTemplate {
  const {
    pipelineSlug,
    stageName,
    orgSlug,
    accountId,
    steps,
    additionalPolicies,
    dockerArtifacts,
    bundleArtifacts,
    oidcProviderUrl,
    additionalTrustedAccounts,
    skipOidc,
  } = options;

  const template = createBaseTemplate(
    `DevRamps Stage Stack for ${pipelineSlug}/${stageName}`
  );

  // Note: OIDC provider is created by the Account Bootstrap stack (once per account)

  // 1. Stage deployment role
  const roleName = generateStageRoleName(pipelineSlug, stageName);
  const trustPolicy = buildStageTrustPolicy(accountId, orgSlug, pipelineSlug, oidcProviderUrl, additionalTrustedAccounts, skipOidc);
  const policies = buildStagePolicies(steps, additionalPolicies, dockerArtifacts, bundleArtifacts, orgSlug);

  template.Resources.StageDeploymentRole = createIamRoleResource(
    roleName,
    trustPolicy,
    policies.length > 0 ? policies : undefined,
    [
      { Key: 'Pipeline', Value: pipelineSlug },
      { Key: 'Stage', Value: stageName },
      { Key: 'Organization', Value: orgSlug },
    ]
  );

  // Track created resources for outputs
  const ecrOutputs: Record<string, { resourceId: string }> = {};
  const s3Outputs: Record<string, { resourceId: string }> = {};

  // 3. Stage ECR repositories (for all Docker artifacts)
  for (const artifact of dockerArtifacts) {
    const artifactId = getArtifactId(artifact);
    const repoName = generateStageEcrRepoName(pipelineSlug, stageName, artifactId);
    const resourceId = sanitizeResourceId(`ECR${artifactId}`);

    template.Resources[resourceId] = createEcrRepositoryResource(
      repoName,
      [
        { Key: 'Pipeline', Value: pipelineSlug },
        { Key: 'Stage', Value: stageName },
        { Key: 'Artifact', Value: artifact.name },
        { Key: 'ArtifactType', Value: artifact.type },
      ]
    );

    ecrOutputs[artifact.name] = { resourceId };
  }

  // 4. Stage S3 buckets (for all Bundle artifacts)
  for (const artifact of bundleArtifacts) {
    const artifactId = getArtifactId(artifact);
    const bucketName = generateStageBucketName(accountId, pipelineSlug, stageName, artifactId);
    const resourceId = sanitizeResourceId(`Bucket${artifactId}`);

    template.Resources[resourceId] = createS3BucketResource(
      bucketName,
      [
        { Key: 'Pipeline', Value: pipelineSlug },
        { Key: 'Stage', Value: stageName },
        { Key: 'Artifact', Value: artifact.name },
        { Key: 'ArtifactType', Value: artifact.type },
      ]
    );

    s3Outputs[artifact.name] = { resourceId };
  }

  // Outputs
  template.Outputs = {
    StageRoleArn: {
      Description: 'ARN of the stage deployment role',
      Value: { 'Fn::GetAtt': ['StageDeploymentRole', 'Arn'] },
      Export: { Name: `DevRamps-${pipelineSlug}-${stageName}-RoleArn` },
    },
    StageRoleName: {
      Description: 'Name of the stage deployment role',
      Value: { Ref: 'StageDeploymentRole' },
    },
    PipelineSlug: {
      Description: 'Pipeline slug',
      Value: pipelineSlug,
    },
    StageName: {
      Description: 'Stage name',
      Value: stageName,
    },
  };

  if (!skipOidc) {
    const providerUrl = oidcProviderUrl || OIDC_PROVIDER_URL;
    template.Outputs!.OIDCProviderArn = {
      Description: 'ARN of the OIDC provider (created by Account Bootstrap stack)',
      Value: `arn:aws:iam::${accountId}:oidc-provider/${providerUrl}`,
    };
  }

  // Add ECR outputs
  for (const [artifactName, { resourceId }] of Object.entries(ecrOutputs)) {
    const safeName = sanitizeResourceId(artifactName);

    template.Outputs![`${safeName}RepoUri`] = {
      Description: `ECR Repository URI for ${artifactName}`,
      Value: { 'Fn::GetAtt': [resourceId, 'RepositoryUri'] },
    };
  }

  // Add S3 outputs
  for (const [artifactName, { resourceId }] of Object.entries(s3Outputs)) {
    const safeName = sanitizeResourceId(artifactName);

    template.Outputs![`${safeName}BucketName`] = {
      Description: `S3 Bucket name for ${artifactName}`,
      Value: { Ref: resourceId },
    };
  }

  return template;
}

/**
 * Build trust policy for the stage deployment role
 * Uses OIDC federation with org/pipeline subject
 */
function buildStageTrustPolicy(
  accountId: string,
  orgSlug: string,
  pipelineSlug: string,
  oidcProviderUrl?: string,
  additionalTrustedAccounts?: string[],
  skipOidc?: boolean
): object {
  const subject = `org:${orgSlug}/pipeline:${pipelineSlug}`;
  return buildOidcTrustPolicy(accountId, subject, oidcProviderUrl, additionalTrustedAccounts, skipOidc);
}

/**
 * Build inline policies for the stage deployment role
 * Includes permissions for each step type and additional policies
 */
function buildStagePolicies(
  steps: PipelineStep[],
  additionalPolicies: IamPolicy[],
  dockerArtifacts: DockerArtifact[],
  bundleArtifacts: BundleArtifact[],
  orgSlug: string
): object[] {
  const policies: object[] = [];

  // Base validation policy for resource validation (ECR, S3, CloudWatch)
  policies.push({
    PolicyName: 'DevRampsValidationPolicy',
    PolicyDocument: {
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'AllowResourceValidation',
          Effect: 'Allow',
          Action: [
            'ecr:DescribeRepositories',
            's3:ListBucket',
            's3:GetBucketLocation',
            'cloudwatch:DescribeAlarms',
          ],
          Resource: '*',
        },
      ],
    },
  });

  // Terraform state bucket access (for reading and writing TF state)
  const tfStateBucketName = generateTerraformStateBucketName(orgSlug);
  policies.push({
    PolicyName: 'DevRampsTerraformStatePolicy',
    PolicyDocument: {
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'AllowTerraformStateReadWrite',
          Effect: 'Allow',
          Action: [
            's3:GetObject',
            's3:PutObject',
            's3:DeleteObject',
          ],
          Resource: `arn:aws:s3:::${tfStateBucketName}/*`,
        },
        {
          Sid: 'AllowTerraformStateList',
          Effect: 'Allow',
          Action: 's3:ListBucket',
          Resource: `arn:aws:s3:::${tfStateBucketName}`,
        },
        {
          Sid: 'AllowKMSForTerraformState',
          Effect: 'Allow',
          Action: [
            'kms:Encrypt',
            'kms:Decrypt',
            'kms:GenerateDataKey*',
            'kms:DescribeKey',
          ],
          Resource: '*',
          Condition: {
            StringLike: {
              'kms:ViaService': 's3.*.amazonaws.com',
            },
          },
        },
      ],
    },
  });

  // Add mirror permissions when artifacts exist (mirroring is an implicit operation)
  if (dockerArtifacts.length > 0) {
    policies.push({
      PolicyName: 'DevRampsMirrorECRPolicy',
      PolicyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Sid: 'AllowECRMirror',
            Effect: 'Allow',
            Action: MIRROR_ECR_PERMISSIONS.actions,
            Resource: MIRROR_ECR_PERMISSIONS.resources || ['*'],
          },
        ],
      },
    });
  }

  if (bundleArtifacts.length > 0) {
    policies.push({
      PolicyName: 'DevRampsMirrorS3Policy',
      PolicyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Sid: 'AllowS3Mirror',
            Effect: 'Allow',
            Action: MIRROR_S3_PERMISSIONS.actions,
            Resource: MIRROR_S3_PERMISSIONS.resources || ['*'],
          },
        ],
      },
    });
  }

  // Add policy for each step type that has permissions
  for (const step of steps) {
    if (!hasPermissions(step.type)) {
      continue;
    }

    const permissions = getStepPermissions(step.type);

    // Skip if no actions defined
    if (!permissions.actions || permissions.actions.length === 0) {
      continue;
    }

    const policyName = `${sanitizeResourceId(step.name)}DeploymentPolicy`;

    policies.push({
      PolicyName: policyName,
      PolicyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Sid: sanitizeResourceId(step.name),
            Effect: 'Allow',
            Action: permissions.actions,
            Resource: permissions.resources || ['*'],
          },
        ],
      },
    });
  }

  // Add additional policies
  for (let i = 0; i < additionalPolicies.length; i++) {
    const policy = additionalPolicies[i];
    const policyName = `AdditionalPolicy${i + 1}`;

    policies.push({
      PolicyName: policyName,
      PolicyDocument: {
        Version: policy.Version || '2012-10-17',
        Statement: policy.Statement.map(stmt => ({
          ...(stmt.Sid ? { Sid: stmt.Sid } : {}),
          Effect: stmt.Effect,
          Action: Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action],
          Resource: stmt.Resource,
          ...(stmt.Condition ? { Condition: stmt.Condition } : {}),
        })),
      },
    });
  }

  return policies;
}

// Re-export stack name function
export { getStageStackName };
