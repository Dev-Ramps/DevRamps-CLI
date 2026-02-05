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
 * Stack status for multi-stack progress display
 */
export interface StackProgressState {
  stackName: string;
  accountId: string;
  region: string;
  completed: number;
  total: number;
  status: 'pending' | 'in_progress' | 'complete' | 'failed' | 'rollback';
  latestEvent?: string;
  latestResourceId?: string;
}

// Spinner frames for in-progress indication
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * Multi-stack progress display for parallel deployments
 */
export class MultiStackProgress {
  private stacks: Map<string, StackProgressState> = new Map();
  private stackOrder: string[] = [];
  private lastLineCount = 0;
  private isTTY: boolean;
  private spinnerFrame = 0;
  private spinnerInterval: ReturnType<typeof setInterval> | null = null;
  private barWidth = 20;

  constructor() {
    this.isTTY = process.stdout.isTTY ?? false;
    if (this.isTTY) {
      // Start spinner animation
      this.spinnerInterval = setInterval(() => {
        this.spinnerFrame = (this.spinnerFrame + 1) % SPINNER_FRAMES.length;
        this.render();
      }, 80);
    }
  }

  /**
   * Register a stack to track
   */
  addStack(stackName: string, accountId: string, region: string, totalResources: number): void {
    this.stacks.set(stackName, {
      stackName,
      accountId,
      region,
      completed: 0,
      total: totalResources,
      status: 'pending',
    });
    this.stackOrder.push(stackName);
    this.render();
  }

  /**
   * Update a stack's progress
   */
  updateStack(
    stackName: string,
    completed: number,
    status: StackProgressState['status'],
    latestEvent?: string,
    latestResourceId?: string
  ): void {
    const stack = this.stacks.get(stackName);
    if (stack) {
      stack.completed = completed;
      stack.status = status;
      if (latestEvent) stack.latestEvent = latestEvent;
      if (latestResourceId) stack.latestResourceId = latestResourceId;
      this.render();
    }
  }

  /**
   * Mark a stack as started
   */
  startStack(stackName: string): void {
    const stack = this.stacks.get(stackName);
    if (stack) {
      stack.status = 'in_progress';
      this.render();
    }
  }

  /**
   * Mark a stack as complete
   */
  completeStack(stackName: string, success: boolean): void {
    const stack = this.stacks.get(stackName);
    if (stack) {
      stack.status = success ? 'complete' : 'failed';
      stack.completed = success ? stack.total : stack.completed;
      this.render();
    }
  }

  /**
   * Clear the display
   */
  private clear(): void {
    if (!this.isTTY) return;
    for (let i = 0; i < this.lastLineCount; i++) {
      process.stdout.write('\x1b[A\x1b[2K');
    }
    this.lastLineCount = 0;
  }

  /**
   * Finish and stop updates
   */
  finish(): void {
    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval);
      this.spinnerInterval = null;
    }
    this.clear();
    // Final render
    this.renderFinal();
  }

  /**
   * Render final state (no clearing, just print)
   */
  private renderFinal(): void {
    for (const stackName of this.stackOrder) {
      const stack = this.stacks.get(stackName);
      if (!stack) continue;
      console.log(this.formatStackLine(stack, false));
    }
  }

  /**
   * Format a single stack line
   */
  private formatStackLine(stack: StackProgressState, withSpinner: boolean): string {
    const { accountId, region, stackName, completed, total, status, latestEvent, latestResourceId } = stack;

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
        colorFn = chalk.blue;
        break;
      default:
        statusIndicator = '○';
        colorFn = chalk.gray;
    }

    // Progress bar
    const percentage = total > 0 ? completed / total : 0;
    const filled = Math.round(this.barWidth * percentage);
    const empty = this.barWidth - filled;
    const bar = '█'.repeat(filled) + '░'.repeat(empty);

    // Account/region label
    const accountLabel = `[${accountId} - ${region}]`;

    // Progress count
    const countLabel = `(${completed}/${total})`;

    // Latest event (truncate if needed)
    let eventLabel = '';
    if (latestEvent && latestResourceId) {
      const maxEventLen = 30;
      const resourceIdTrunc = latestResourceId.length > 20
        ? latestResourceId.slice(0, 17) + '...'
        : latestResourceId;
      eventLabel = ` ${latestEvent} ${resourceIdTrunc}`;
      if (eventLabel.length > maxEventLen) {
        eventLabel = eventLabel.slice(0, maxEventLen - 3) + '...';
      }
    }

    // Build the line
    const line = `${statusIndicator} ${accountLabel} ${stackName} [${bar}] ${countLabel}${eventLabel}`;
    return colorFn(line);
  }

  /**
   * Render all stack progress bars
   */
  private render(): void {
    if (!this.isTTY) return;

    this.clear();

    const lines: string[] = [];
    for (const stackName of this.stackOrder) {
      const stack = this.stacks.get(stackName);
      if (!stack) continue;
      lines.push(this.formatStackLine(stack, true));
    }

    // Write all lines
    for (const line of lines) {
      process.stdout.write(line + '\n');
    }
    this.lastLineCount = lines.length;
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
