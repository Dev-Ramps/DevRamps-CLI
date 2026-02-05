/**
 * Logging utility with verbose mode support
 */

import chalk from 'chalk';

let verboseMode = false;

/**
 * Resource status for tracking deployment progress
 */
export interface ResourceStatus {
  logicalId: string;
  resourceType: string;
  status: 'in_progress' | 'complete' | 'failed';
  reason?: string;
}

/**
 * Stack type for display purposes
 */
export type StackType = 'org' | 'pipeline' | 'account' | 'stage';

/**
 * Stack status for multi-stack progress display
 */
export interface StackProgressState {
  stackName: string;
  stackType: StackType;
  accountId: string;
  region: string;
  completed: number;
  total: number;
  status: 'pending' | 'in_progress' | 'complete' | 'failed' | 'rollback';
  cfnStatus?: string; // The actual CloudFormation status
  latestResourceId?: string;
  failureReason?: string;
}

// Spinner frames for in-progress indication
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * Generate a unique key for a stack (same stack name can exist in multiple accounts)
 */
function getStackKey(stackName: string, accountId: string, region: string): string {
  return `${stackName}:${accountId}:${region}`;
}

/**
 * Multi-stack progress display for parallel deployments
 * Uses alternate screen buffer and debounced render to prevent terminal corruption
 */
export class MultiStackProgress {
  private stacks: Map<string, StackProgressState> = new Map();
  private stackOrder: string[] = [];
  private isTTY: boolean;
  private spinnerFrame = 0;
  private spinnerInterval: ReturnType<typeof setInterval> | null = null;
  private barWidth = 20;
  private renderScheduled = false;
  private lastRenderTime = 0;
  private hasRenderedOnce = false;
  private useAltScreen = true; // Use alternate screen buffer for clean display
  private maxStackNameLen = 40; // Will be calculated dynamically

  constructor() {
    this.isTTY = process.stdout.isTTY ?? false;
  }

  /**
   * Start the progress display (call after all stacks are registered)
   */
  start(): void {
    // Calculate max stack name length from all registered stacks
    this.maxStackNameLen = Math.max(
      ...Array.from(this.stacks.values()).map(s => s.stackName.length),
      20 // minimum width
    );

    if (this.isTTY) {
      if (this.useAltScreen) {
        // Enter alternate screen buffer (like vim/less do)
        process.stdout.write('\x1b[?1049h');
      }
      // Hide cursor during updates
      process.stdout.write('\x1b[?25l');
      // Move to top-left
      process.stdout.write('\x1b[H');
      // Clear screen
      process.stdout.write('\x1b[2J');
      // Do initial render
      this.doRender();
      // Start spinner animation (slower to reduce flicker)
      this.spinnerInterval = setInterval(() => {
        this.spinnerFrame = (this.spinnerFrame + 1) % SPINNER_FRAMES.length;
        this.scheduleRender();
      }, 100);
    }
  }

  /**
   * Register a stack to track
   */
  addStack(stackName: string, stackType: StackType, accountId: string, region: string, totalResources: number): void {
    const key = getStackKey(stackName, accountId, region);

    // Don't add duplicates
    if (this.stacks.has(key)) {
      return;
    }

    this.stacks.set(key, {
      stackName,
      stackType,
      accountId,
      region,
      completed: 0,
      total: totalResources,
      status: 'pending',
    });
    this.stackOrder.push(key);
  }

  /**
   * Update a stack's progress
   */
  updateStack(
    stackName: string,
    accountId: string,
    region: string,
    completed: number,
    status: StackProgressState['status'],
    cfnStatus?: string,
    latestResourceId?: string
  ): void {
    const key = getStackKey(stackName, accountId, region);
    const stack = this.stacks.get(key);
    if (stack) {
      stack.completed = completed;
      stack.status = status;
      if (cfnStatus) stack.cfnStatus = cfnStatus;
      if (latestResourceId) stack.latestResourceId = latestResourceId;
      this.scheduleRender();
    }
  }

  /**
   * Mark a stack as started
   */
  startStack(stackName: string, accountId: string, region: string): void {
    const key = getStackKey(stackName, accountId, region);
    const stack = this.stacks.get(key);
    if (stack) {
      stack.status = 'in_progress';
      stack.cfnStatus = 'STARTING';
      this.scheduleRender();
    }
  }

  /**
   * Mark a stack as complete
   */
  completeStack(stackName: string, accountId: string, region: string, success: boolean, failureReason?: string): void {
    const key = getStackKey(stackName, accountId, region);
    const stack = this.stacks.get(key);
    if (stack) {
      stack.status = success ? 'complete' : 'failed';
      stack.completed = success ? stack.total : stack.completed;
      if (failureReason) stack.failureReason = failureReason;
      this.scheduleRender();
    }
  }

  /**
   * Schedule a render (debounced to prevent too many updates)
   */
  private scheduleRender(): void {
    if (this.renderScheduled) return;

    const now = Date.now();
    const timeSinceLastRender = now - this.lastRenderTime;
    const minInterval = 50; // Minimum 50ms between renders

    if (timeSinceLastRender >= minInterval) {
      this.doRender();
    } else {
      this.renderScheduled = true;
      setTimeout(() => {
        this.renderScheduled = false;
        this.doRender();
      }, minInterval - timeSinceLastRender);
    }
  }

  /**
   * Finish and stop updates
   */
  finish(): void {
    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval);
      this.spinnerInterval = null;
    }
    if (this.isTTY) {
      // Show cursor again
      process.stdout.write('\x1b[?25h');
      if (this.useAltScreen) {
        // Leave alternate screen buffer
        process.stdout.write('\x1b[?1049l');
      }
    }
    // Final static render to main screen
    this.renderFinal();
  }

  /**
   * Render final state (no clearing, just print)
   */
  private renderFinal(): void {
    for (const key of this.stackOrder) {
      const stack = this.stacks.get(key);
      if (!stack) continue;
      console.log(this.formatStackLine(stack, false));
    }
  }

  /**
   * Get a short label for stack type
   */
  private getTypeLabel(stackType: StackType): string {
    switch (stackType) {
      case 'org': return 'ORG';
      case 'pipeline': return 'PIPE';
      case 'account': return 'ACCT';
      case 'stage': return 'STAGE';
    }
  }

  /**
   * Format a single stack line
   */
  private formatStackLine(stack: StackProgressState, withSpinner: boolean): string {
    const { accountId, region, stackName, stackType, completed, total, status, cfnStatus, latestResourceId, failureReason } = stack;

    // Status indicator
    let statusIndicator: string;
    let colorFn: (s: string) => string;

    switch (status) {
      case 'complete':
        statusIndicator = '✔';
        colorFn = chalk.green;
        break;
      case 'failed':
      case 'rollback':
        statusIndicator = '✖';
        colorFn = chalk.red;
        break;
      case 'in_progress':
        statusIndicator = withSpinner ? SPINNER_FRAMES[this.spinnerFrame] : '⋯';
        colorFn = chalk.cyanBright; // Brighter blue for better readability
        break;
      default: // pending
        statusIndicator = '○';
        colorFn = chalk.gray;
    }

    // Progress bar
    const percentage = total > 0 ? completed / total : 0;
    const filled = Math.round(this.barWidth * percentage);
    const empty = this.barWidth - filled;
    const bar = '█'.repeat(filled) + '░'.repeat(empty);

    // Stack type label (fixed width)
    const typeLabel = this.getTypeLabel(stackType).padEnd(5);

    // Full account ID and region
    const accountLabel = `${accountId} ${region.padEnd(12)}`;

    // Progress count
    const countLabel = `${completed}/${total}`;

    // Stack name - use dynamic width, no truncation since we calculated max
    const displayName = stackName.padEnd(this.maxStackNameLen);

    // Right side info - show CFN status, current resource, or failure reason
    let rightInfo = '';
    if (status === 'failed' || status === 'rollback') {
      // Show the CFN status and failure reason if available
      const statusText = cfnStatus || 'FAILED';
      if (failureReason && failureReason !== cfnStatus) {
        // Show both status and reason
        const maxLen = 50;
        const fullReason = `${statusText}: ${failureReason}`;
        rightInfo = fullReason.length > maxLen
          ? fullReason.slice(0, maxLen - 3) + '...'
          : fullReason;
      } else {
        rightInfo = statusText;
      }
    } else if (status === 'in_progress') {
      // Show CFN status and current resource
      const cfnStatusDisplay = cfnStatus || 'DEPLOYING';
      const resourceDisplay = latestResourceId
        ? (latestResourceId.length > 25 ? latestResourceId.slice(0, 22) + '...' : latestResourceId)
        : '';
      rightInfo = resourceDisplay ? `${cfnStatusDisplay} → ${resourceDisplay}` : cfnStatusDisplay;
    } else if (status === 'complete') {
      rightInfo = cfnStatus || 'COMPLETE';
    }

    // Build the full line
    const leftPart = `${statusIndicator} [${typeLabel}] ${accountLabel} ${displayName}`;
    const middlePart = `[${bar}] ${countLabel}`;
    const line = `${leftPart} ${middlePart} ${rightInfo}`;

    return colorFn(line);
  }

  /**
   * Perform the actual render
   */
  private doRender(): void {
    this.lastRenderTime = Date.now();

    if (!this.isTTY) return;

    // Move cursor to top-left
    process.stdout.write('\x1b[H');

    // Print header
    process.stdout.write(chalk.bold.underline('Deploying Stacks') + '\x1b[K\n\n');

    // Write all stack lines
    for (const key of this.stackOrder) {
      const stack = this.stacks.get(key);
      if (!stack) continue;
      // Write line and clear to end of line (in case previous line was longer)
      process.stdout.write(this.formatStackLine(stack, true) + '\x1b[K\n');
    }

    // Print summary line
    const completed = Array.from(this.stacks.values()).filter(s => s.status === 'complete').length;
    const failed = Array.from(this.stacks.values()).filter(s => s.status === 'failed' || s.status === 'rollback').length;
    const inProgress = Array.from(this.stacks.values()).filter(s => s.status === 'in_progress').length;
    const pending = Array.from(this.stacks.values()).filter(s => s.status === 'pending').length;

    process.stdout.write('\n');
    process.stdout.write(chalk.gray(`Progress: ${completed} complete, ${inProgress} in progress, ${pending} pending, ${failed} failed`) + '\x1b[K\n');

    this.hasRenderedOnce = true;
  }
}

// Global multi-stack progress instance
let globalProgress: MultiStackProgress | null = null;

export function getMultiStackProgress(): MultiStackProgress {
  if (!globalProgress) {
    globalProgress = new MultiStackProgress();
  }
  return globalProgress;
}

export function clearMultiStackProgress(): void {
  if (globalProgress) {
    globalProgress.finish();
    globalProgress = null;
  }
}

export function setVerbose(enabled: boolean): void {
  verboseMode = enabled;
}

export function isVerbose(): boolean {
  return verboseMode;
}

export function info(message: string): void {
  console.log(chalk.blue('ℹ'), message);
}

export function success(message: string): void {
  console.log(chalk.green('✔'), message);
}

export function warn(message: string): void {
  console.log(chalk.yellow('⚠'), message);
}

export function error(message: string): void {
  console.error(chalk.red('✖'), message);
}

export function verbose(message: string): void {
  if (verboseMode) {
    console.log(chalk.gray('  →'), chalk.gray(message));
  }
}

export function header(message: string): void {
  console.log();
  console.log(chalk.bold.underline(message));
  console.log();
}

export function table(rows: string[][]): void {
  if (rows.length === 0) return;

  const colWidths = rows[0].map((_, colIndex) =>
    Math.max(...rows.map(row => (row[colIndex] || '').length))
  );

  const separator = '─';
  const corner = '┼';
  const vertical = '│';

  const formatRow = (row: string[], isHeader = false): string => {
    const cells = row.map((cell, i) => ` ${cell.padEnd(colWidths[i])} `);
    const line = vertical + cells.join(vertical) + vertical;
    return isHeader ? chalk.bold(line) : line;
  };

  const horizontalLine = (char: string): string => {
    const segments = colWidths.map(w => char.repeat(w + 2));
    return char === '─' ? '├' + segments.join(corner) + '┤' : '┌' + segments.join('┬') + '┐';
  };

  const bottomLine = (): string => {
    const segments = colWidths.map(w => separator.repeat(w + 2));
    return '└' + segments.join('┴') + '┘';
  };

  console.log(horizontalLine('─').replace('├', '┌').replace('┤', '┐').replace(/┼/g, '┬'));
  console.log(formatRow(rows[0], true));
  console.log(horizontalLine('─'));

  for (let i = 1; i < rows.length; i++) {
    console.log(formatRow(rows[i]));
  }

  console.log(bottomLine());
}

export function newline(): void {
  console.log();
}
