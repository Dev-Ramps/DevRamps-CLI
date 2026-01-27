/**
 * CloudFormation template generator for bootstrap stacks
 */

import { getStepPermissions, hasPermissions } from '../permissions/index.js';
import { getOidcThumbprint } from '../aws/oidc-provider.js';
import { OIDC_PROVIDER_URL, DEPLOYMENT_ROLE_NAME } from '../types/config.js';
import type { CloudFormationTemplate } from '../types/aws.js';
import type { PipelineStep, IamPolicy } from '../types/pipeline.js';

export interface GenerateTemplateOptions {
  pipelineSlug: string;
  orgSlug: string;
  steps: PipelineStep[];
  additionalPolicies: IamPolicy[];
  accountId: string;
}

/**
 * Sanitize a name for use in CloudFormation resource/policy names
 */
function sanitizeName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9]/g, '')
    .substring(0, 64);
}

/**
 * Generate the CloudFormation template for a bootstrap stack
 */
export function generateBootstrapTemplate(
  options: GenerateTemplateOptions
): CloudFormationTemplate {
  const { pipelineSlug, orgSlug, steps, additionalPolicies, accountId } = options;

  const template: CloudFormationTemplate = {
    AWSTemplateFormatVersion: '2010-09-09',
    Description: `DevRamps bootstrap stack for pipeline: ${pipelineSlug}`,
    Parameters: {
      OIDCProviderExists: {
        Type: 'String',
        Default: 'false',
        AllowedValues: ['true', 'false'],
        Description: 'Whether the OIDC provider already exists in this account',
      },
    },
    Conditions: {
      CreateOIDCProvider: {
        'Fn::Equals': [{ Ref: 'OIDCProviderExists' }, 'false'],
      },
    },
    Resources: {},
    Outputs: {},
  };

  // Add OIDC Provider (conditional)
  template.Resources.DevRampsOIDCProvider = {
    Type: 'AWS::IAM::OIDCProvider',
    Condition: 'CreateOIDCProvider',
    Properties: {
      Url: `https://${OIDC_PROVIDER_URL}`,
      ClientIdList: [OIDC_PROVIDER_URL],
      ThumbprintList: [getOidcThumbprint()],
      Tags: [
        { Key: 'CreatedBy', Value: 'DevRamps' },
        { Key: 'ManagedBy', Value: 'DevRamps-CLI' },
      ],
    },
  };

  // Build the trust policy for the IAM role
  const trustPolicy = {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: {
          Federated: `arn:aws:iam::${accountId}:oidc-provider/${OIDC_PROVIDER_URL}`,
        },
        Action: 'sts:AssumeRoleWithWebIdentity',
        Condition: {
          StringEquals: {
            [`${OIDC_PROVIDER_URL}:sub`]: `org:${orgSlug}/pipeline:${pipelineSlug}`,
            [`${OIDC_PROVIDER_URL}:aud`]: OIDC_PROVIDER_URL,
          },
        },
      },
    ],
  };

  // Build inline policies for each step
  const policies: Array<{
    PolicyName: string;
    PolicyDocument: {
      Version: string;
      Statement: Array<{
        Sid?: string;
        Effect: string;
        Action: string[];
        Resource: string | string[];
      }>;
    };
  }> = [];

  for (const step of steps) {
    if (!hasPermissions(step.type)) {
      continue;
    }

    const permissions = getStepPermissions(step.type);
    const policyName = `${sanitizeName(step.name)}-Deployment-Policy`;

    policies.push({
      PolicyName: policyName,
      PolicyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Sid: sanitizeName(step.name),
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
          Sid: stmt.Sid,
          Effect: stmt.Effect,
          Action: Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action],
          Resource: stmt.Resource,
        })),
      },
    });
  }

  // Add the IAM role
  template.Resources.DevRampsCICDDeploymentRole = {
    Type: 'AWS::IAM::Role',
    Properties: {
      RoleName: DEPLOYMENT_ROLE_NAME,
      AssumeRolePolicyDocument: trustPolicy,
      Policies: policies.length > 0 ? policies : undefined,
      Tags: [
        { Key: 'CreatedBy', Value: 'DevRamps' },
        { Key: 'ManagedBy', Value: 'DevRamps-CLI' },
        { Key: 'Pipeline', Value: pipelineSlug },
        { Key: 'Organization', Value: orgSlug },
      ],
    },
  };

  // Add outputs
  template.Outputs = {
    RoleArn: {
      Description: 'ARN of the DevRamps CICD deployment role',
      Value: { 'Fn::GetAtt': ['DevRampsCICDDeploymentRole', 'Arn'] },
    },
    RoleName: {
      Description: 'Name of the DevRamps CICD deployment role',
      Value: { Ref: 'DevRampsCICDDeploymentRole' },
    },
    OIDCProviderArn: {
      Description: 'ARN of the OIDC provider (if created)',
      Value: {
        'Fn::If': [
          'CreateOIDCProvider',
          { 'Fn::GetAtt': ['DevRampsOIDCProvider', 'Arn'] },
          `arn:aws:iam::${accountId}:oidc-provider/${OIDC_PROVIDER_URL}`,
        ],
      },
    },
  };

  return template;
}

/**
 * Get the stack name for a pipeline
 */
export function getStackName(pipelineSlug: string): string {
  return `DevRamps-${pipelineSlug}-Bootstrap`;
}
