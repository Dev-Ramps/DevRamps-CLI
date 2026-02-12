/**
 * Shared template utilities for CloudFormation template generation
 */

import { getOidcThumbprint } from '../aws/oidc-provider.js';
import { OIDC_PROVIDER_URL } from '../types/config.js';
import type { CloudFormationTemplate, CloudFormationResource } from '../types/aws.js';

/**
 * Standard tags applied to all DevRamps resources
 */
export const STANDARD_TAGS = [
  { Key: 'CreatedBy', Value: 'DevRamps' },
  { Key: 'ManagedBy', Value: 'DevRamps-CLI' },
];

/**
 * Create a base CloudFormation template with standard structure
 */
export function createBaseTemplate(description: string): CloudFormationTemplate {
  return {
    AWSTemplateFormatVersion: '2010-09-09',
    Description: description,
    Parameters: {},
    Conditions: {},
    Resources: {},
    Outputs: {},
  };
}

/**
 * Sanitize a name for use in CloudFormation resource/policy names
 * Only allows alphanumeric characters
 */
export function sanitizeResourceId(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9]/g, '')
    .substring(0, 64);
}

/**
 * Add OIDC provider resource to a template (conditional creation)
 *
 * @param template - The template to modify
 * @param conditional - Whether to make creation conditional
 * @param oidcProviderUrl - Override the OIDC provider URL (e.g. from endpoint override)
 */
export function addOidcProviderResource(
  template: CloudFormationTemplate,
  conditional: boolean = true,
  oidcProviderUrl?: string
): void {
  const providerUrl = oidcProviderUrl || OIDC_PROVIDER_URL;

  if (conditional) {
    template.Parameters!.OIDCProviderExists = {
      Type: 'String',
      Default: 'false',
      AllowedValues: ['true', 'false'],
      Description: 'Whether the OIDC provider already exists in this account',
    };

    template.Conditions!.CreateOIDCProvider = {
      'Fn::Equals': [{ Ref: 'OIDCProviderExists' }, 'false'],
    };
  }

  template.Resources.DevRampsOIDCProvider = {
    Type: 'AWS::IAM::OIDCProvider',
    ...(conditional ? { Condition: 'CreateOIDCProvider' } : {}),
    Properties: {
      Url: `https://${providerUrl}`,
      ClientIdList: [providerUrl],
      ThumbprintList: [getOidcThumbprint()],
      Tags: STANDARD_TAGS,
    },
  };
}

/**
 * Get the OIDC provider ARN (handles conditional creation)
 */
export function getOidcProviderArn(accountId: string, conditional: boolean = true, oidcProviderUrl?: string): unknown {
  const providerUrl = oidcProviderUrl || OIDC_PROVIDER_URL;

  if (conditional) {
    return {
      'Fn::If': [
        'CreateOIDCProvider',
        { 'Fn::GetAtt': ['DevRampsOIDCProvider', 'Arn'] },
        `arn:aws:iam::${accountId}:oidc-provider/${providerUrl}`,
      ],
    };
  }
  return { 'Fn::GetAtt': ['DevRampsOIDCProvider', 'Arn'] };
}

/**
 * Build a trust policy for OIDC federation
 */
export function buildOidcTrustPolicy(
  accountId: string,
  subject: string,
  oidcProviderUrl?: string
): object {
  const providerUrl = oidcProviderUrl || OIDC_PROVIDER_URL;

  return {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: {
          Federated: `arn:aws:iam::${accountId}:oidc-provider/${providerUrl}`,
        },
        Action: 'sts:AssumeRoleWithWebIdentity',
        Condition: {
          StringEquals: {
            [`${providerUrl}:sub`]: subject,
            [`${providerUrl}:aud`]: providerUrl,
          },
        },
      },
    ],
  };
}

/**
 * Create an IAM role resource
 */
export function createIamRoleResource(
  roleName: string,
  trustPolicy: object,
  policies: object[] | undefined,
  additionalTags: Array<{ Key: string; Value: string }> = []
): CloudFormationResource {
  return {
    Type: 'AWS::IAM::Role',
    Properties: {
      RoleName: roleName,
      AssumeRolePolicyDocument: trustPolicy,
      ...(policies && policies.length > 0 ? { Policies: policies } : {}),
      Tags: [...STANDARD_TAGS, ...additionalTags],
    },
  };
}

/**
 * Create an S3 bucket resource with standard security configuration
 */
export function createS3BucketResource(
  bucketName: string,
  additionalTags: Array<{ Key: string; Value: string }> = [],
  encryption?: { kmsKeyArn?: unknown }
): CloudFormationResource {
  const encryptionConfig = encryption?.kmsKeyArn
    ? {
        ServerSideEncryptionConfiguration: [
          {
            ServerSideEncryptionByDefault: {
              SSEAlgorithm: 'aws:kms',
              KMSMasterKeyID: encryption.kmsKeyArn,
            },
          },
        ],
      }
    : {
        ServerSideEncryptionConfiguration: [
          {
            ServerSideEncryptionByDefault: {
              SSEAlgorithm: 'AES256',
            },
          },
        ],
      };

  return {
    Type: 'AWS::S3::Bucket',
    Properties: {
      BucketName: bucketName,
      VersioningConfiguration: { Status: 'Enabled' },
      BucketEncryption: encryptionConfig,
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      Tags: [...STANDARD_TAGS, ...additionalTags],
    },
  };
}

/**
 * Create an ECR repository resource
 */
export function createEcrRepositoryResource(
  repositoryName: string,
  additionalTags: Array<{ Key: string; Value: string }> = []
): CloudFormationResource {
  return {
    Type: 'AWS::ECR::Repository',
    Properties: {
      RepositoryName: repositoryName,
      ImageScanningConfiguration: { ScanOnPush: true },
      EncryptionConfiguration: { EncryptionType: 'AES256' },
      Tags: [...STANDARD_TAGS, ...additionalTags],
    },
  };
}

/**
 * Create a KMS key resource
 */
export function createKmsKeyResource(
  description: string,
  keyPolicy: object,
  additionalTags: Array<{ Key: string; Value: string }> = []
): CloudFormationResource {
  return {
    Type: 'AWS::KMS::Key',
    Properties: {
      Description: description,
      EnableKeyRotation: true,
      KeyPolicy: keyPolicy,
      Tags: [...STANDARD_TAGS, ...additionalTags],
    },
  };
}

/**
 * Create a KMS key alias resource
 */
export function createKmsKeyAliasResource(aliasName: string, targetKeyRef: string): CloudFormationResource {
  return {
    Type: 'AWS::KMS::Alias',
    Properties: {
      AliasName: aliasName,
      TargetKeyId: { Ref: targetKeyRef },
    },
  };
}
