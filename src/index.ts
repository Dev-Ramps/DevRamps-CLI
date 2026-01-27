#!/usr/bin/env node

/**
 * DevRamps CLI
 *
 * Bootstrap AWS infrastructure for CI/CD pipelines
 */

import { program } from 'commander';
import { bootstrapCommand } from './commands/bootstrap.js';

program
  .name('devramps')
  .description('DevRamps CLI - Bootstrap AWS infrastructure for CI/CD pipelines')
  .version('0.1.0');

program
  .command('bootstrap')
  .description('Bootstrap IAM roles in target AWS accounts based on pipeline definitions')
  .option(
    '--target-account-role-name <name>',
    'Role to assume in target accounts (default: OrganizationAccountAccessRole, fallback: AWSControlTowerExecution)'
  )
  .option(
    '--pipeline-slugs <slugs>',
    'Comma-separated list of pipeline slugs to bootstrap (default: all pipelines)'
  )
  .option(
    '--dry-run',
    'Show what would be deployed without actually deploying'
  )
  .option(
    '--verbose',
    'Enable verbose logging for debugging'
  )
  .option(
    '--endpoint-override <url>',
    'Override the DevRamps API endpoint (for testing, e.g., http://localhost:3000)'
  )
  .action(bootstrapCommand);

program.parse();
