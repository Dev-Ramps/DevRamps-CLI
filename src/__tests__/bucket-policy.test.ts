import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BucketPolicyMergeStrategy, createTerraformStateBucketPolicy } from '../merge/bucket-policy.js';
import type { MergeContext, CloudFormationStackResources } from '../merge/strategy.js';
import type { ParsedPipeline } from '../types/pipeline.js';

// Mock the logger to avoid console output during tests
vi.mock('../utils/logger.js', () => ({
  verbose: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

describe('BucketPolicyMergeStrategy', () => {
  let strategy: BucketPolicyMergeStrategy;

  beforeEach(() => {
    strategy = new BucketPolicyMergeStrategy();
  });

  describe('collectNew', () => {
    it('should accept valid account IDs', async () => {
      const context: MergeContext = {
        orgSlug: 'test-org',
        cicdAccountId: '123456789012',
        cicdRegion: 'us-east-1',
        pipelines: [
          {
            slug: 'pipeline-1',
            targetAccountIds: ['111111111111', '222222222222'],
          } as ParsedPipeline,
        ],
      };

      const result = await strategy.collectNew(context);

      expect(result.allowedAccountIds).toContain('123456789012');
      expect(result.allowedAccountIds).toContain('111111111111');
      expect(result.allowedAccountIds).toContain('222222222222');
      expect(result.allowedAccountIds).toHaveLength(3);
    });

    it('should throw on invalid CI/CD account ID', async () => {
      const context: MergeContext = {
        orgSlug: 'test-org',
        cicdAccountId: 'invalid',
        cicdRegion: 'us-east-1',
        pipelines: [],
      };

      await expect(strategy.collectNew(context)).rejects.toThrow(
        /Invalid CI\/CD account ID.*must be exactly 12 digits/
      );
    });

    it('should throw on invalid CI/CD account ID with wrong length', async () => {
      const context: MergeContext = {
        orgSlug: 'test-org',
        cicdAccountId: '12345678901', // 11 digits
        cicdRegion: 'us-east-1',
        pipelines: [],
      };

      await expect(strategy.collectNew(context)).rejects.toThrow(
        /Invalid CI\/CD account ID/
      );
    });

    it('should throw on invalid target account ID in pipeline', async () => {
      const context: MergeContext = {
        orgSlug: 'test-org',
        cicdAccountId: '123456789012',
        cicdRegion: 'us-east-1',
        pipelines: [
          {
            slug: 'bad-pipeline',
            targetAccountIds: ['valid12345678', 'bad'],
          } as ParsedPipeline,
        ],
      };

      await expect(strategy.collectNew(context)).rejects.toThrow(
        /Invalid target account ID in pipeline "bad-pipeline"/
      );
    });

    it('should deduplicate account IDs', async () => {
      const context: MergeContext = {
        orgSlug: 'test-org',
        cicdAccountId: '123456789012',
        cicdRegion: 'us-east-1',
        pipelines: [
          {
            slug: 'pipeline-1',
            targetAccountIds: ['123456789012', '111111111111'],
          } as ParsedPipeline,
          {
            slug: 'pipeline-2',
            targetAccountIds: ['111111111111', '222222222222'],
          } as ParsedPipeline,
        ],
      };

      const result = await strategy.collectNew(context);

      expect(result.allowedAccountIds).toHaveLength(3);
      expect(new Set(result.allowedAccountIds).size).toBe(3);
    });
  });

  describe('merge', () => {
    it('should merge existing and new account IDs', () => {
      const existing = { allowedAccountIds: ['111111111111', '222222222222'] };
      const newData = { allowedAccountIds: ['222222222222', '333333333333'] };

      const result = strategy.merge(existing, newData);

      expect(result.allowedAccountIds).toContain('111111111111');
      expect(result.allowedAccountIds).toContain('222222222222');
      expect(result.allowedAccountIds).toContain('333333333333');
      expect(result.allowedAccountIds).toHaveLength(3);
    });

    it('should handle null existing data', () => {
      const newData = { allowedAccountIds: ['111111111111', '222222222222'] };

      const result = strategy.merge(null, newData);

      expect(result.allowedAccountIds).toHaveLength(2);
    });

    it('should sort account IDs for consistent output', () => {
      const existing = { allowedAccountIds: ['333333333333'] };
      const newData = { allowedAccountIds: ['111111111111', '222222222222'] };

      const result = strategy.merge(existing, newData);

      expect(result.allowedAccountIds[0]).toBe('111111111111');
      expect(result.allowedAccountIds[1]).toBe('222222222222');
      expect(result.allowedAccountIds[2]).toBe('333333333333');
    });
  });

  describe('validate', () => {
    it('should pass valid account IDs', () => {
      const result = strategy.validate({
        allowedAccountIds: ['123456789012', '111111111111'],
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should fail on invalid account ID format', () => {
      const result = strategy.validate({
        allowedAccountIds: ['123456789012', 'invalid'],
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid AWS account ID format: invalid');
    });

    it('should warn on large number of accounts', () => {
      const manyAccounts = Array.from({ length: 51 }, (_, i) =>
        String(i + 100000000000).slice(-12).padStart(12, '0')
      );

      const result = strategy.validate({
        allowedAccountIds: manyAccounts,
      });

      expect(result.valid).toBe(true);
      expect(result.warnings).toBeDefined();
      expect(result.warnings?.[0]).toContain('Large number of accounts');
    });
  });
});

describe('createTerraformStateBucketPolicy', () => {
  it('should create a valid bucket policy structure', () => {
    const policy = createTerraformStateBucketPolicy(
      'my-bucket',
      '123456789012',
      ['123456789012', '111111111111', '222222222222']
    );

    expect(policy).toHaveProperty('Version', '2012-10-17');
    expect(policy).toHaveProperty('Statement');
    expect(Array.isArray((policy as { Statement: unknown[] }).Statement)).toBe(true);
  });

  it('should include CI/CD account with full access', () => {
    const policy = createTerraformStateBucketPolicy(
      'my-bucket',
      '123456789012',
      ['123456789012', '111111111111']
    ) as { Statement: Array<{ Sid: string; Action: string | string[]; Principal: { AWS: string } }> };

    const cicdStatement = policy.Statement.find(s => s.Sid === 'AllowCICDAccount');

    expect(cicdStatement).toBeDefined();
    expect(cicdStatement?.Action).toBe('s3:*');
    expect(cicdStatement?.Principal.AWS).toContain('123456789012');
  });

  it('should include list bucket permission for all accounts', () => {
    const policy = createTerraformStateBucketPolicy(
      'my-bucket',
      '123456789012',
      ['123456789012', '111111111111', '222222222222']
    ) as { Statement: Array<{ Sid: string; Action: string; Principal: { AWS: string[] } }> };

    const listStatement = policy.Statement.find(s => s.Sid === 'AllowListBucket');

    expect(listStatement).toBeDefined();
    expect(listStatement?.Action).toBe('s3:ListBucket');
    expect(listStatement?.Principal.AWS).toHaveLength(3);
  });
});
