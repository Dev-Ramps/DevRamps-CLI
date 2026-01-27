# @devramps/cli

DevRamps CLI - Bootstrap AWS infrastructure for CI/CD pipelines.

This CLI tool helps you set up IAM roles in your AWS accounts that allow DevRamps to deploy your applications securely using OIDC federation.

## Prerequisites

### Node.js

This tool requires Node.js version 18 or higher.

**First time installing Node.js?**

- **macOS**: Install via Homebrew: `brew install node`
- **Windows**: Download from [nodejs.org](https://nodejs.org/) or use [nvm-windows](https://github.com/coreybutler/nvm-windows)
- **Linux**: Use your package manager or [nvm](https://github.com/nvm-sh/nvm):
  ```bash
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
  nvm install 18
  ```

Verify your installation:
```bash
node --version  # Should be v18.0.0 or higher
npm --version   # Should be v8.0.0 or higher
```

### AWS CLI

You need AWS credentials configured. The CLI uses these credentials to assume roles in your target accounts.

1. Install the AWS CLI: [AWS CLI Installation Guide](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)
2. Configure credentials:
   ```bash
   aws configure
   ```
   Or set environment variables:
   ```bash
   export AWS_ACCESS_KEY_ID=your_access_key
   export AWS_SECRET_ACCESS_KEY=your_secret_key
   ```

## Installation

You can run the CLI directly using npx (no installation required):

```bash
npx @devramps/cli bootstrap
```

Or install it globally:

```bash
npm install -g @devramps/cli
devramps bootstrap
```

## Usage

### Bootstrap Command

The `bootstrap` command creates IAM roles in your target AWS accounts based on your pipeline definitions.

```bash
npx @devramps/cli bootstrap [options]
```

#### Options

| Option | Description |
|--------|-------------|
| `--target-account-role-name <name>` | Role to assume in target accounts. Default: `OrganizationAccountAccessRole`, fallback: `AWSControlTowerExecution` |
| `--pipeline-slugs <slugs>` | Comma-separated list of pipeline slugs to bootstrap. Default: all pipelines |
| `--dry-run` | Show what would be deployed without actually deploying |
| `--verbose` | Enable verbose logging for debugging |

#### Examples

Bootstrap all pipelines:
```bash
npx @devramps/cli bootstrap
```

Bootstrap specific pipelines:
```bash
npx @devramps/cli bootstrap --pipeline-slugs my-app,my-other-app
```

Use a custom role name for cross-account access:
```bash
npx @devramps/cli bootstrap --target-account-role-name MyCustomRole
```

Preview changes without deploying:
```bash
npx @devramps/cli bootstrap --dry-run
```

## Project Structure

Your project should have a `.devramps` folder at the root with the following structure:

```
your-project/
├── .devramps/
│   ├── my-pipeline/
│   │   ├── pipeline.yaml                        # Required: Pipeline definition
│   │   └── aws_additional_iam_policies.yaml     # Optional: Additional IAM policies
│   └── another-pipeline/
│       └── pipeline.yaml
└── ... your application code
```

### Additional IAM Policies

You can specify additional IAM policies in either JSON or YAML format for e.g. infrastructure synthesis:

**aws_additional_iam_policies.yaml**:
```yaml
- Version: "2012-10-17"
  Statement:
    - Effect: Allow
      Action:
        - s3:GetObject
        - s3:PutObject
      Resource: "arn:aws:s3:::my-bucket/*"
```

**aws_additional_iam_policies.json**:
```json
[
  {
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": ["s3:GetObject", "s3:PutObject"],
        "Resource": "arn:aws:s3:::my-bucket/*"
      }
    ]
  }
]
```

## What Gets Created

For each pipeline and target account combination, the bootstrap command creates a CloudFormation stack named `DevRamps-<pipeline-slug>-Bootstrap` containing:

1. **OIDC Identity Provider** (`devramps.com`) - Enables secure, credential-less authentication
2. **IAM Role** (`DevRamps-CICD-DeploymentRole`) - The role that DevRamps assumes to deploy your application
   - Trust policy allowing only your organization and pipeline
   - Policies for each deployment step type
   - Any additional policies you've specified

## Supported Step Types

| Step Type | Description |
|-----------|-------------|
| `DEVRAMPS:EKS:DEPLOY` | Deploy to EKS using kubectl |
| `DEVRAMPS:EKS:HELM` | Deploy to EKS using Helm |
| `DEVRAMPS:ECS:DEPLOY` | Deploy to ECS |
| `DEVRAMPS:APPROVAL:BAKE` | Wait/approval step (no AWS permissions needed) |
| `CUSTOM:*` | Custom steps (define permissions in additional policies) |

## Troubleshooting

### "Could not find .devramps folder"

Make sure you're running the command from the root of your project, where the `.devramps` folder is located.

### "No AWS credentials found"

Configure AWS credentials using one of these methods:
- Run `aws configure` to set up credentials
- Set `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` environment variables
- Use AWS SSO: `aws sso login`

### "Unable to assume role"

Your current AWS credentials don't have permission to assume the target role. Make sure:
1. The role exists in the target account
2. Your current credentials have `sts:AssumeRole` permission for that role
3. The role's trust policy allows your current identity to assume it

Try specifying a different role:
```bash
npx @devramps/cli bootstrap --target-account-role-name MyCustomRole
```

### "Authentication timed out"

The browser authentication flow has a 5-minute timeout. If you see this error:
1. Make sure your browser opened the DevRamps authentication page
2. Complete the login and organization selection
3. If the page didn't open, check if a popup blocker is preventing it

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - see [LICENSE](LICENSE) for details.
