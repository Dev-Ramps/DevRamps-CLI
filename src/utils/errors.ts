/**
 * Custom error types for better error handling
 */

export class DevRampsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DevRampsError';
  }
}

export class NoDevrampsFolderError extends DevRampsError {
  constructor() {
    super(
      'Could not find .devramps folder in current directory. ' +
      'Please run this command from the root of your project.'
    );
    this.name = 'NoDevrampsFolderError';
  }
}

export class NoCredentialsError extends DevRampsError {
  constructor() {
    super(
      'No AWS credentials found. Please configure AWS credentials using `aws configure` ' +
      'or set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables.'
    );
    this.name = 'NoCredentialsError';
  }
}

export class RoleAssumptionError extends DevRampsError {
  accountId: string;
  roleName: string;

  constructor(accountId: string, roleName: string) {
    super(
      `Cannot bootstrap account ${accountId}. Unable to assume role '${roleName}' in that account. ` +
      'Please ensure your current credentials have permission to assume this role, ' +
      'or use --target-account-role-name to specify a different role.'
    );
    this.name = 'RoleAssumptionError';
    this.accountId = accountId;
    this.roleName = roleName;
  }
}

export class PipelineParseError extends DevRampsError {
  pipelineSlug: string;

  constructor(pipelineSlug: string, cause: string) {
    super(`Failed to parse pipeline.yaml in .devramps/${pipelineSlug}/: ${cause}`);
    this.name = 'PipelineParseError';
    this.pipelineSlug = pipelineSlug;
  }
}

export class AuthenticationError extends DevRampsError {
  constructor(message: string) {
    super(`Authentication failed: ${message}`);
    this.name = 'AuthenticationError';
  }
}

export class CloudFormationError extends DevRampsError {
  stackName: string;
  accountId: string;

  constructor(stackName: string, accountId: string, cause: string) {
    super(`Failed to deploy stack '${stackName}' in account ${accountId}: ${cause}`);
    this.name = 'CloudFormationError';
    this.stackName = stackName;
    this.accountId = accountId;
  }
}
