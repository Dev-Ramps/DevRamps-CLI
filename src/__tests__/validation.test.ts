import { describe, it, expect } from 'vitest';
import {
  isValidAwsAccountId,
  isValidAwsRegion,
  validateAwsAccountId,
  validateAwsRegion,
} from '../utils/validation.js';

describe('isValidAwsAccountId', () => {
  it('should accept valid 12-digit account IDs', () => {
    expect(isValidAwsAccountId('123456789012')).toBe(true);
    expect(isValidAwsAccountId('000000000000')).toBe(true);
    expect(isValidAwsAccountId('999999999999')).toBe(true);
  });

  it('should reject account IDs with wrong length', () => {
    expect(isValidAwsAccountId('12345678901')).toBe(false); // 11 digits
    expect(isValidAwsAccountId('1234567890123')).toBe(false); // 13 digits
    expect(isValidAwsAccountId('')).toBe(false); // empty
  });

  it('should reject account IDs with non-digit characters', () => {
    expect(isValidAwsAccountId('12345678901a')).toBe(false);
    expect(isValidAwsAccountId('1234-5678901')).toBe(false);
    expect(isValidAwsAccountId('123456789 12')).toBe(false);
    expect(isValidAwsAccountId('abcdefghijkl')).toBe(false);
  });

  it('should reject account IDs with special characters', () => {
    expect(isValidAwsAccountId('123456789012\n')).toBe(false);
    expect(isValidAwsAccountId('123456789012;')).toBe(false);
    expect(isValidAwsAccountId('<script>123')).toBe(false);
  });
});

describe('isValidAwsRegion', () => {
  it('should accept valid AWS regions from the known list', () => {
    expect(isValidAwsRegion('us-east-1')).toBe(true);
    expect(isValidAwsRegion('us-west-2')).toBe(true);
    expect(isValidAwsRegion('eu-west-1')).toBe(true);
    expect(isValidAwsRegion('ap-northeast-1')).toBe(true);
    expect(isValidAwsRegion('sa-east-1')).toBe(true);
  });

  it('should accept valid AWS region format even if not in known list', () => {
    // These match the pattern but may not be in our list
    expect(isValidAwsRegion('xx-yyyy-1')).toBe(true);
  });

  it('should reject invalid region formats', () => {
    expect(isValidAwsRegion('')).toBe(false);
    expect(isValidAwsRegion('us-east')).toBe(false); // missing number
    expect(isValidAwsRegion('useast1')).toBe(false); // missing hyphens
    expect(isValidAwsRegion('US-EAST-1')).toBe(false); // uppercase
    expect(isValidAwsRegion('us-east-1a')).toBe(false); // has AZ suffix
  });

  it('should reject regions with injection attempts', () => {
    expect(isValidAwsRegion('us-east-1; rm -rf /')).toBe(false);
    expect(isValidAwsRegion('us-east-1\nmalicious')).toBe(false);
    expect(isValidAwsRegion('<script>alert(1)</script>')).toBe(false);
  });
});

describe('validateAwsAccountId', () => {
  it('should not throw for valid account IDs', () => {
    expect(() => validateAwsAccountId('123456789012')).not.toThrow();
    expect(() => validateAwsAccountId('000000000000')).not.toThrow();
  });

  it('should throw for invalid account IDs', () => {
    expect(() => validateAwsAccountId('12345')).toThrow(/Invalid.*AWS account ID/);
    expect(() => validateAwsAccountId('invalid')).toThrow(/must be exactly 12 digits/);
  });

  it('should include field name in error message', () => {
    expect(() => validateAwsAccountId('bad', 'CI/CD account ID')).toThrow(
      /Invalid CI\/CD account ID/
    );
  });
});

describe('validateAwsRegion', () => {
  it('should not throw for valid regions', () => {
    expect(() => validateAwsRegion('us-east-1')).not.toThrow();
    expect(() => validateAwsRegion('eu-west-2')).not.toThrow();
  });

  it('should throw for invalid regions', () => {
    expect(() => validateAwsRegion('invalid')).toThrow(/Invalid.*AWS region/);
    expect(() => validateAwsRegion('')).toThrow(/Invalid.*AWS region/);
  });

  it('should include field name in error message', () => {
    expect(() => validateAwsRegion('bad', 'deployment region')).toThrow(
      /Invalid deployment region/
    );
  });
});
