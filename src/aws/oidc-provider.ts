/**
 * OIDC Identity Provider management
 *
 * Note: The OIDC provider is created as part of the CloudFormation stack,
 * but this module provides utilities for checking if one already exists.
 */

import {
  IAMClient,
  GetOpenIDConnectProviderCommand,
  ListOpenIDConnectProvidersCommand,
} from '@aws-sdk/client-iam';
import type { AwsCredentialIdentity } from '@aws-sdk/types';
import * as logger from '../utils/logger.js';
import { OIDC_PROVIDER_URL } from '../types/config.js';

export interface OidcProviderInfo {
  exists: boolean;
  arn?: string;
}

export async function checkOidcProviderExists(
  credentials?: AwsCredentialIdentity,
  region?: string
): Promise<OidcProviderInfo> {
  const client = new IAMClient({
    credentials,
    region,
  });

  try {
    const response = await client.send(new ListOpenIDConnectProvidersCommand({}));

    const providers = response.OpenIDConnectProviderList || [];

    for (const provider of providers) {
      if (!provider.Arn) continue;

      try {
        const providerDetails = await client.send(
          new GetOpenIDConnectProviderCommand({
            OpenIDConnectProviderArn: provider.Arn,
          })
        );

        if (providerDetails.Url?.includes(OIDC_PROVIDER_URL)) {
          logger.verbose(`Found existing OIDC provider: ${provider.Arn}`);
          return {
            exists: true,
            arn: provider.Arn,
          };
        }
      } catch {
        // Continue checking other providers
      }
    }

    logger.verbose(`No existing OIDC provider found for ${OIDC_PROVIDER_URL}`);
    return { exists: false };
  } catch (error) {
    logger.verbose(`Error checking OIDC providers: ${error instanceof Error ? error.message : String(error)}`);
    return { exists: false };
  }
}

/**
 * Get the OIDC provider ARN for a given account ID
 * This is used to reference the provider in IAM trust policies
 */
export function getOidcProviderArn(accountId: string): string {
  return `arn:aws:iam::${accountId}:oidc-provider/${OIDC_PROVIDER_URL}`;
}

/**
 * Get the thumbprint for the OIDC provider
 * This should be the SHA-1 thumbprint of the OIDC provider's TLS certificate
 * For production, this should be fetched dynamically or configured
 */
export function getOidcThumbprint(): string {
  // TODO: This should be the actual thumbprint for devramps.com
  // For now, using a placeholder that should be replaced with the real value
  return 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
}
