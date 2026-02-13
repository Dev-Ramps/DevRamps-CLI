/**
 * Import Stack CloudFormation Template Generator
 *
 * Creates the import-level stack deployed to each import source account.
 * Contains:
 * - DevRamps-{pipelineSlug}-ImportRole with read permissions for ECR and S3
 *
 * This stack is deployed to external accounts that artifacts are imported from,
 * allowing DevRamps to pull Docker images and S3 bundles during CI/CD.
 */

import type { CloudFormationTemplate } from '../types/aws.js';
import {
  createBaseTemplate,
  buildOidcTrustPolicy,
  createIamRoleResource,
} from './common.js';
import {
  getImportStackName,
  generateImportRoleName,
} from '../naming/index.js';

export interface ImportStackOptions {
  pipelineSlug: string;
  orgSlug: string;
  /** The account ID where this stack is being deployed (the import source account) */
  accountId: string;
  /** Override the OIDC provider URL (e.g. from endpoint override) */
  oidcProviderUrl?: string;
}

/**
 * Generate the CloudFormation template for an import stack
 */
export function generateImportStackTemplate(options: ImportStackOptions): CloudFormationTemplate {
  const { pipelineSlug, orgSlug, accountId, oidcProviderUrl } = options;

  const template = createBaseTemplate(
    `DevRamps Import Stack for ${pipelineSlug} - grants read access for artifact imports`
  );

  // Import role with OIDC trust for CI/CD operations
  const roleName = generateImportRoleName(pipelineSlug);
  const trustPolicy = buildOidcTrustPolicy(accountId, `org:${orgSlug}/cicd`, oidcProviderUrl);
  const policies = buildImportRolePolicies();

  template.Resources.ImportRole = createIamRoleResource(
    roleName,
    trustPolicy,
    policies,
    [
      { Key: 'Pipeline', Value: pipelineSlug },
      { Key: 'Organization', Value: orgSlug },
    ]
  );

  // Outputs
  template.Outputs = {
    ImportRoleArn: {
      Description: 'ARN of the import role',
      Value: { 'Fn::GetAtt': ['ImportRole', 'Arn'] },
    },
    ImportRoleName: {
      Description: 'Name of the import role',
      Value: { Ref: 'ImportRole' },
    },
    PipelineSlug: {
      Description: 'Pipeline slug',
      Value: pipelineSlug,
    },
  };

  return template;
}

/**
 * Build inline policies for the import role.
 * Grants read-only access to ECR and S3 for importing artifacts.
 */
function buildImportRolePolicies(): object[] {
  return [
    {
      PolicyName: 'DevRampsImportPolicy',
      PolicyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Sid: 'AllowECRRead',
            Effect: 'Allow',
            Action: [
              'ecr:GetAuthorizationToken',
              'ecr:DescribeImages',
              'ecr:BatchGetImage',
              'ecr:GetDownloadUrlForLayer',
              'ecr:BatchCheckLayerAvailability',
            ],
            Resource: '*',
          },
          {
            Sid: 'AllowS3Read',
            Effect: 'Allow',
            Action: [
              's3:GetObject',
              's3:HeadObject',
            ],
            Resource: '*',
          },
        ],
      },
    },
  ];
}

// Re-export stack name function
export { getImportStackName };
