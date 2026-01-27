/**
 * AWS-related types
 */

import type { AwsCredentialIdentity } from '@aws-sdk/types';

export interface AssumedRoleCredentials {
  credentials: AwsCredentialIdentity;
  accountId: string;
  roleArn: string;
}

export interface CurrentIdentity {
  accountId: string;
  arn: string;
  userId: string;
}

export interface StackStatus {
  exists: boolean;
  status?: string;
  stackId?: string;
}

export interface CloudFormationTemplate {
  AWSTemplateFormatVersion: string;
  Description: string;
  Parameters?: Record<string, CloudFormationParameter>;
  Conditions?: Record<string, unknown>;
  Resources: Record<string, CloudFormationResource>;
  Outputs?: Record<string, CloudFormationOutput>;
}

export interface CloudFormationParameter {
  Type: string;
  Default?: string;
  Description?: string;
  AllowedValues?: string[];
}

export interface CloudFormationResource {
  Type: string;
  Condition?: string;
  Properties: Record<string, unknown>;
  DependsOn?: string | string[];
}

export interface CloudFormationOutput {
  Description?: string;
  Value: unknown;
  Export?: {
    Name: string;
  };
}
