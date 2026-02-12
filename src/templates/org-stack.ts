/**
 * Org Stack CloudFormation Template Generator
 *
 * Creates the organization-level stack deployed to the CI/CD account.
 * Contains:
 * - DevRamps-CICD-DeploymentRole (org-wide orchestration role)
 * - KMS Key for artifact encryption
 * - Terraform state S3 bucket with merged bucket policy
 *
 * Note: The OIDC provider is created by the Account Bootstrap stack,
 * not the Org stack. The CI/CD account must be included in account bootstrapping.
 */

import type { CloudFormationTemplate } from '../types/aws.js';
import {
  createBaseTemplate,
  buildOidcTrustPolicy,
  createIamRoleResource,
  createS3BucketResource,
  createKmsKeyResource,
  createKmsKeyAliasResource,
  STANDARD_TAGS,
} from './common.js';
import {
  getOrgStackName,
  getOrgRoleName,
  generateTerraformStateBucketName,
  getKmsKeyAlias,
} from '../naming/index.js';
import { createTerraformStateBucketPolicy } from '../merge/bucket-policy.js';

export interface OrgStackOptions {
  orgSlug: string;
  cicdAccountId: string;
  /** All target account IDs that need access to Terraform state bucket */
  targetAccountIds: string[];
  /** Override the OIDC provider URL (e.g. from endpoint override) */
  oidcProviderUrl?: string;
}

/**
 * Generate the CloudFormation template for the org stack
 */
export function generateOrgStackTemplate(options: OrgStackOptions): CloudFormationTemplate {
  const { orgSlug, cicdAccountId, targetAccountIds, oidcProviderUrl } = options;

  const template = createBaseTemplate(`DevRamps Org Stack for ${orgSlug}`);

  // 1. KMS Key for encryption
  const kmsKeyPolicy = buildKmsKeyPolicy(cicdAccountId, targetAccountIds);
  template.Resources.DevRampsKMSKey = createKmsKeyResource(
    `DevRamps encryption key for org: ${orgSlug}`,
    kmsKeyPolicy,
    [{ Key: 'Organization', Value: orgSlug }]
  );

  template.Resources.DevRampsKMSKeyAlias = createKmsKeyAliasResource(
    getKmsKeyAlias(orgSlug),
    'DevRampsKMSKey'
  );

  // 2. Terraform state S3 bucket
  const bucketName = generateTerraformStateBucketName(orgSlug);
  template.Resources.TerraformStateBucket = createS3BucketResource(
    bucketName,
    [{ Key: 'Organization', Value: orgSlug }],
    { kmsKeyArn: { 'Fn::GetAtt': ['DevRampsKMSKey', 'Arn'] } }
  );

  // 3. Terraform state bucket policy
  const bucketPolicy = createTerraformStateBucketPolicy(
    bucketName,
    cicdAccountId,
    targetAccountIds
  );

  template.Resources.TerraformStateBucketPolicy = {
    Type: 'AWS::S3::BucketPolicy',
    Properties: {
      Bucket: { Ref: 'TerraformStateBucket' },
      PolicyDocument: bucketPolicy,
    },
  };

  // 4. DevRamps-CICD-DeploymentRole (org-wide orchestration)
  const trustPolicy = buildOidcTrustPolicy(cicdAccountId, `org:${orgSlug}/cicd`, oidcProviderUrl);
  const orgRolePolicies = buildOrgRolePolicies(orgSlug);

  template.Resources.DevRampsCICDDeploymentRole = createIamRoleResource(
    getOrgRoleName(),
    trustPolicy,
    orgRolePolicies,
    [{ Key: 'Organization', Value: orgSlug }]
  );

  // Outputs
  template.Outputs = {
    OrgRoleArn: {
      Description: 'ARN of the org-level CICD deployment role',
      Value: { 'Fn::GetAtt': ['DevRampsCICDDeploymentRole', 'Arn'] },
      Export: { Name: `DevRamps-${orgSlug}-OrgRoleArn` },
    },
    OrgRoleName: {
      Description: 'Name of the org-level CICD deployment role',
      Value: { Ref: 'DevRampsCICDDeploymentRole' },
    },
    KMSKeyArn: {
      Description: 'ARN of the KMS encryption key',
      Value: { 'Fn::GetAtt': ['DevRampsKMSKey', 'Arn'] },
      Export: { Name: `DevRamps-${orgSlug}-KMSKeyArn` },
    },
    KMSKeyId: {
      Description: 'ID of the KMS encryption key',
      Value: { Ref: 'DevRampsKMSKey' },
    },
    TerraformStateBucketName: {
      Description: 'Name of the Terraform state bucket',
      Value: { Ref: 'TerraformStateBucket' },
      Export: { Name: `DevRamps-${orgSlug}-TerraformStateBucket` },
    },
    TerraformStateBucketArn: {
      Description: 'ARN of the Terraform state bucket',
      Value: { 'Fn::GetAtt': ['TerraformStateBucket', 'Arn'] },
    },
  };

  return template;
}

/**
 * Build KMS key policy allowing CI/CD account and target accounts
 */
function buildKmsKeyPolicy(cicdAccountId: string, targetAccountIds: string[]): object {
  const allAccountIds = [...new Set([cicdAccountId, ...targetAccountIds])];

  return {
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'EnableRootAccountPermissions',
        Effect: 'Allow',
        Principal: {
          AWS: `arn:aws:iam::${cicdAccountId}:root`,
        },
        Action: 'kms:*',
        Resource: '*',
      },
      {
        Sid: 'AllowTargetAccountsEncryptDecrypt',
        Effect: 'Allow',
        Principal: {
          AWS: allAccountIds.map(id => `arn:aws:iam::${id}:root`),
        },
        Action: [
          'kms:Encrypt',
          'kms:Decrypt',
          'kms:ReEncrypt*',
          'kms:GenerateDataKey*',
          'kms:DescribeKey',
        ],
        Resource: '*',
      },
    ],
  };
}

/**
 * Build inline policies for the org CICD role
 */
function buildOrgRolePolicies(orgSlug: string): object[] {
  return [
    {
      PolicyName: 'DevRampsOrgPolicy',
      PolicyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Sid: 'AllowAssumeStageRoles',
            Effect: 'Allow',
            Action: 'sts:AssumeRole',
            Resource: `arn:aws:iam::*:role/DevRamps-*-DeploymentRole`,
          },
          {
            Sid: 'AllowKMSUsage',
            Effect: 'Allow',
            Action: [
              'kms:Encrypt',
              'kms:Decrypt',
              'kms:GenerateDataKey*',
              'kms:DescribeKey',
            ],
            Resource: '*',
            Condition: {
              StringEquals: {
                'kms:CallerAccount': { Ref: 'AWS::AccountId' },
              },
            },
          },
          {
            Sid: 'AllowS3TerraformState',
            Effect: 'Allow',
            Action: [
              's3:GetObject',
              's3:PutObject',
              's3:DeleteObject',
              's3:ListBucket',
            ],
            Resource: [
              { 'Fn::GetAtt': ['TerraformStateBucket', 'Arn'] },
              { 'Fn::Sub': '${TerraformStateBucket.Arn}/*' },
            ],
          },
          {
            Sid: 'AllowECROperations',
            Effect: 'Allow',
            Action: [
              'ecr:GetAuthorizationToken',
              'ecr:BatchCheckLayerAvailability',
              'ecr:GetDownloadUrlForLayer',
              'ecr:BatchGetImage',
              'ecr:PutImage',
              'ecr:InitiateLayerUpload',
              'ecr:UploadLayerPart',
              'ecr:CompleteLayerUpload',
              'ecr:DescribeRepositories',
            ],
            Resource: '*',
          },
          {
            Sid: 'AllowS3ArtifactBuckets',
            Effect: 'Allow',
            Action: [
              's3:ListBucket',
              's3:GetBucketLocation',
            ],
            Resource: '*',
          },
          {
            Sid: 'AllowSecretsManagerOperations',
            Effect: 'Allow',
            Action: [
              'secretsmanager:CreateSecret',
              'secretsmanager:GetSecretValue',
              'secretsmanager:PutSecretValue',
              'secretsmanager:UpdateSecret',
              'secretsmanager:DeleteSecret',
              'secretsmanager:DescribeSecret',
              'secretsmanager:TagResource',
            ],
            Resource: {
              'Fn::Sub': 'arn:aws:secretsmanager:*:${AWS::AccountId}:secret:devramps/*',
            },
          },
        ],
      },
    },
  ];
}

// Re-export stack name function
export { getOrgStackName };
