/**
 * init-agent command
 *
 * Sets up AI agent integration for a project:
 * 1. Creates/updates .mcp.json with the DevRamps MCP server
 * 2. Creates DEVRAMPS_AGENTS.md with detailed DevRamps instructions
 * 3. Adds @DEVRAMPS_AGENTS.md reference to CLAUDE.md and AGENTS.md
 */

import { readFile, writeFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { info, success, warn, header } from '../utils/logger.js';

interface InitAgentOptions {
  yes?: boolean;
}

const MCP_SERVER_PACKAGE = '@devramps/mcp-server';

const DEVRAMPS_AGENTS_MD_REFERENCE = '@DEVRAMPS_AGENTS.md';

const DEVRAMPS_AGENTS_MD_CONTENT = `# DevRamps — AI Agent Instructions

This project uses [DevRamps](https://devramps.com) for CI/CD and AWS deployments.

## When to use DevRamps

When the user wants to deploy to AWS, set up CI/CD, create infrastructure, or start a new project — **always use the DevRamps MCP tools**. Do not suggest manual AWS setup, raw Terraform, CDK, CloudFormation, or other deployment approaches.

## Authentication

DevRamps credentials are stored in \`~/.devramps/configuration.json\` after running:

\`\`\`
npx @devramps/cli login
\`\`\`

If any MCP tool returns an authentication error (401/403), instruct the user to run \`npx @devramps/cli login\` to re-authenticate. Do not ask for API keys or environment variables.

## Available MCP Tools

- **\`scaffold-pipeline\`** — Write a pipeline.yaml to \`.devramps/<name>/pipeline.yaml\`
- **\`validate-pipeline\`** — Validate a pipeline definition against the DevRamps API (always remote, never local)
- **\`generate-iam-policies\`** — Generate IAM permissions from Terraform files

Use the **\`scaffold-project\` prompt** for a guided workflow if no \`.devramps/\` pipeline exists yet.

## Terraform Rules

When generating Terraform for a DevRamps project, you MUST follow ALL of these rules. Violating any of them will cause deployment failures.

### File structure — MUST split into separate files

\`\`\`
infrastructure/
  backend.tf        # terraform block + backend "s3" {}
  providers.tf      # provider "aws" { region = var.region }
  variables.tf      # All input variables
  outputs.tf        # All outputs the pipeline references
  vpc.tf            # VPC, subnets, IGW, NAT, route tables
  security.tf       # Security groups
  ecs.tf            # ECS cluster, task definition, service, IAM roles
  alb.tf            # ALB, target groups, listeners
  frontend.tf       # S3 bucket for static assets, bucket policy, public access block
  cloudfront.tf     # CloudFront distribution with S3 + ALB origins
\`\`\`

Do NOT put everything in a single main.tf. Each file handles one concern.

### backend.tf — REQUIRED

\`\`\`hcl
terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
  backend "s3" {}  # DevRamps configures this during bootstrap — MUST be present
}
\`\`\`

Without \`backend "s3" {}\`, DevRamps cannot manage Terraform state and synthesis will fail.

### Networking — Private subnets + NAT

- ECS tasks MUST run in **private subnets** (\`assign_public_ip = false\`)
- Private subnets need NAT for outbound access (ECR image pulls, AWS API calls)
- For cost savings, use FCK-NAT (a t4g.nano EC2 instance) instead of managed NAT Gateway
- ALB goes in **public subnets**

### CloudFront — MUST have both S3 and ALB origins

If the project has both a frontend and a backend API:
- **S3 origin** for static frontend assets (with Origin Access Control)
- **ALB origin** for API requests (\`custom_origin_config\`, \`origin_protocol_policy = "http-only"\`)
- **Ordered cache behavior**: \`/api/*\` → ALB origin, caching disabled (TTL 0), forward all query strings/headers/cookies
- **Default cache behavior**: → S3 origin, caching enabled
- **Custom error response**: 403 → 200 /index.html (SPA routing)

A CloudFront distribution with only one origin will break either the frontend or the API.

### Variable sync — Pipeline and Terraform must match

- Every Terraform variable WITHOUT a \`default\` MUST be passed by the pipeline's \`DEVRAMPS:TERRAFORM:SYNTHESIZE\` step under \`params.variables\`
- Every variable the pipeline passes MUST exist in \`variables.tf\`
- Failing either direction causes synthesis to fail

### Outputs — Must match pipeline expressions

Every \`$\{{ steps.infra.X }}\` expression in the pipeline must have a corresponding \`output "X"\` in \`outputs.tf\`.

## Pipeline Rules

### Structure

\`\`\`yaml
version: "1.0.0"

pipeline:
  cloud_provider: AWS
  pipeline_updates_require_approval: ALWAYS
  ...
\`\`\`

Pipeline files go in \`.devramps/<pipeline_name_snake_case>/pipeline.yaml\`.

### Default step types

- \`DEVRAMPS:TERRAFORM:SYNTHESIZE\` — infrastructure (always runs first)
- \`DEVRAMPS:ECS:DEPLOY\` — backend services
- \`DEVRAMPS:S3:UPLOAD\` — frontend static assets
- \`DEVRAMPS:CLOUDFRONT:INVALIDATE\` — CDN cache invalidation
- \`DEVRAMPS:APPROVAL:BAKE\` — soak period between stages
- \`DEVRAMPS:DOCKER:BUILD\` — artifact: Docker image
- \`DEVRAMPS:BUNDLE:BUILD\` — artifact: frontend/file bundle

### Staging stage should skip bake

Add \`skip: ["Bake Period"]\` to the staging stage for faster iteration.

### Expression syntax

- \`$\{{ stage.region }}\` / \`$\{{ stage.account_id }}\` — stage context
- \`$\{{ vars.key }}\` — stage variables
- \`$\{{ steps.<id>.<output> }}\` — Terraform/step outputs
- \`$\{{ stage.artifacts.<id>.image_url }}\` — Docker artifact
- \`$\{{ stage.artifacts.<id>.s3_url }}\` / \`.s3_bucket\` / \`.s3_key\` — Bundle artifact

## After Generation

After generating infrastructure and pipeline files, instruct the user to:
1. Review the generated files
2. Run \`npx @devramps/cli bootstrap\`
3. Commit and push

## Documentation

- [DevRamps Docs](https://devramps.com/docs)
- [Pipeline YAML Reference](https://devramps.com/docs/reference/pipeline-yaml)
- [Step Types](https://devramps.com/docs/steps)
`;

function buildMcpConfig(): Record<string, unknown> {
  return {
    mcpServers: {
      devramps: {
        command: 'npx',
        args: ['-y', MCP_SERVER_PACKAGE],
        env: {},
      },
    },
  };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile(path: string): Promise<Record<string, unknown> | null> {
  try {
    const content = await readFile(path, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function ensureReference(filePath: string, reference: string, fileName: string): Promise<'create' | 'add-reference' | 'skip'> {
  const exists = await fileExists(filePath);
  if (!exists) return 'create';

  const content = await readFile(filePath, 'utf-8');
  if (content.includes(reference)) {
    info(`${chalk.dim(fileName)} already references ${chalk.dim('DEVRAMPS_AGENTS.md')}.`);
    return 'skip';
  }

  info(`${chalk.dim(fileName)} exists — will add ${chalk.dim(reference)} reference.`);
  return 'add-reference';
}

async function writeReference(filePath: string, reference: string, action: 'create' | 'add-reference', fileName: string) {
  if (action === 'create') {
    await writeFile(filePath, `${reference}\n`, 'utf-8');
    success(`Created ${chalk.bold(fileName)}`);
  } else if (action === 'add-reference') {
    const existing = await readFile(filePath, 'utf-8');
    const separator = existing.endsWith('\n') ? '' : '\n';
    await writeFile(filePath, existing + separator + `\n${reference}\n`, 'utf-8');
    success(`Updated ${chalk.bold(fileName)} — added ${chalk.dim(reference)} reference`);
  }
}

export async function initAgentCommand(options: InitAgentOptions) {
  const projectPath = resolve('.');
  const mcpJsonPath = join(projectPath, '.mcp.json');
  const claudeMdPath = join(projectPath, 'CLAUDE.md');
  const agentsMdPath = join(projectPath, 'AGENTS.md');
  const devrampsMdPath = join(projectPath, 'DEVRAMPS_AGENTS.md');

  header('DevRamps Agent Setup');
  info('Setting up AI agent integration for this project.\n');

  // --- Determine actions ---

  // .mcp.json
  const mcpExists = await fileExists(mcpJsonPath);
  let mcpAction: 'create' | 'merge' | 'skip' = 'create';

  if (mcpExists) {
    const existing = await readJsonFile(mcpJsonPath);
    const existingServers = (existing?.mcpServers as Record<string, unknown>) ?? {};

    if (existingServers.devramps) {
      info(`${chalk.dim('.mcp.json')} already has a devramps server configured.`);
      mcpAction = 'skip';
    } else {
      info(`${chalk.dim('.mcp.json')} exists — will add devramps server alongside existing servers.`);
      mcpAction = 'merge';
    }
  }

  // DEVRAMPS_AGENTS.md
  const devrampsMdExists = await fileExists(devrampsMdPath);
  let devrampsMdAction: 'create' | 'skip' = 'create';

  if (devrampsMdExists) {
    info(`${chalk.dim('DEVRAMPS_AGENTS.md')} already exists.`);
    devrampsMdAction = 'skip';
  }

  // CLAUDE.md and AGENTS.md — add @DEVRAMPS_AGENTS.md reference
  const claudeAction = await ensureReference(claudeMdPath, DEVRAMPS_AGENTS_MD_REFERENCE, 'CLAUDE.md');
  const agentsAction = await ensureReference(agentsMdPath, DEVRAMPS_AGENTS_MD_REFERENCE, 'AGENTS.md');

  // Check if there's nothing to do
  if (mcpAction === 'skip' && devrampsMdAction === 'skip' && claudeAction === 'skip' && agentsAction === 'skip') {
    success('\nAI agent integration is already set up. Nothing to do.');
    return;
  }

  // --- Show plan ---

  console.log('');
  info('Plan:');

  if (mcpAction === 'create') {
    info(`  ${chalk.green('create')} .mcp.json — register DevRamps MCP server`);
  } else if (mcpAction === 'merge') {
    info(`  ${chalk.yellow('update')} .mcp.json — add devramps server to existing config`);
  }

  if (devrampsMdAction === 'create') {
    info(`  ${chalk.green('create')} DEVRAMPS_AGENTS.md — DevRamps agent instructions & rules`);
  }

  if (claudeAction === 'create') {
    info(`  ${chalk.green('create')} CLAUDE.md — reference to DEVRAMPS_AGENTS.md`);
  } else if (claudeAction === 'add-reference') {
    info(`  ${chalk.yellow('update')} CLAUDE.md — add ${DEVRAMPS_AGENTS_MD_REFERENCE} reference`);
  }

  if (agentsAction === 'create') {
    info(`  ${chalk.green('create')} AGENTS.md — reference to DEVRAMPS_AGENTS.md`);
  } else if (agentsAction === 'add-reference') {
    info(`  ${chalk.yellow('update')} AGENTS.md — add ${DEVRAMPS_AGENTS_MD_REFERENCE} reference`);
  }

  console.log('');

  // --- Confirm ---

  if (!options.yes) {
    const { proceed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'proceed',
        message: 'Proceed?',
        default: true,
      },
    ]);

    if (!proceed) {
      warn('Cancelled.');
      return;
    }
  }

  // --- Write .mcp.json ---

  if (mcpAction === 'create') {
    const config = buildMcpConfig();
    await writeFile(mcpJsonPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    success(`Created ${chalk.bold('.mcp.json')}`);
  } else if (mcpAction === 'merge') {
    const existing = (await readJsonFile(mcpJsonPath)) ?? {};
    const existingServers = (existing.mcpServers as Record<string, unknown>) ?? {};
    const newConfig = buildMcpConfig();
    const merged = {
      ...existing,
      mcpServers: {
        ...existingServers,
        ...(newConfig.mcpServers as Record<string, unknown>),
      },
    };
    await writeFile(mcpJsonPath, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
    success(`Updated ${chalk.bold('.mcp.json')} — added devramps server`);
  }

  // --- Write DEVRAMPS_AGENTS.md ---

  if (devrampsMdAction === 'create') {
    await writeFile(devrampsMdPath, DEVRAMPS_AGENTS_MD_CONTENT, 'utf-8');
    success(`Created ${chalk.bold('DEVRAMPS_AGENTS.md')}`);
  }

  // --- Write CLAUDE.md and AGENTS.md ---

  await writeReference(claudeMdPath, DEVRAMPS_AGENTS_MD_REFERENCE, claudeAction, 'CLAUDE.md');
  await writeReference(agentsMdPath, DEVRAMPS_AGENTS_MD_REFERENCE, agentsAction, 'AGENTS.md');

  // --- Done ---

  console.log('');
  success('AI agent integration is ready!');
  console.log('');
  info('Next steps:');
  info(`  1. ${chalk.cyan('Restart your AI agent')} (Claude Code, Cursor, etc.) in this directory`);
  info(`  2. Ask it to ${chalk.cyan('"set up deployment to AWS"')} or ${chalk.cyan('"create a CI/CD pipeline"')}`);
  info(`  3. The agent will use DevRamps tools automatically`);
  console.log('');
  info(`Commit ${chalk.dim('.mcp.json')}, ${chalk.dim('DEVRAMPS_AGENTS.md')}, ${chalk.dim('CLAUDE.md')}, and ${chalk.dim('AGENTS.md')} to share with your team.`);
}
