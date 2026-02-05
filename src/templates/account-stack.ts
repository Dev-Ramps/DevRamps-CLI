/**
 * Account Bootstrap Stack CloudFormation Template Generator
 *
 * Creates the account-level bootstrap stack deployed once per AWS account.
 * Contains:
 * - OIDC Provider (globally unique per account)
 *
 * This stack must be deployed before any stage stacks in the same account.
 */

import type { CloudFormationTemplate } from '../types/aws.js';
import { createBaseTemplate, addOidcProviderResource, STANDARD_TAGS } from './common.js';
import { getAccountStackName } from '../naming/index.js';

/**
 * Generate the CloudFormation template for an account bootstrap stack
 */
export function generateAccountStackTemplate(): CloudFormationTemplate {
  const template = createBaseTemplate(
    'DevRamps Account Bootstrap Stack - Creates OIDC provider for the account'
  );

  // Only resource: OIDC Provider (unconditional - this stack owns it)
  addOidcProviderResource(template, false);

  // Outputs
  template.Outputs = {
    OIDCProviderArn: {
      Description: 'ARN of the OIDC provider',
      Value: { 'Fn::GetAtt': ['DevRampsOIDCProvider', 'Arn'] },
    },
  };

  return template;
}

// Re-export stack name function
export { getAccountStackName };
