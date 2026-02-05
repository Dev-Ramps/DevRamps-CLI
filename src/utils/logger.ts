/**
 * Logging utility with verbose mode support
 */

import chalk from 'chalk';

let verboseMode = false;

/**
 * Get terminal height, with a fallback
 */
function getTerminalHeight(): number {
  return process.stdout.rows || 24;
}

/**
 * Track current line position for terminal buffer management
 */
let linesOutputSinceProgress = 0;

/**
 * Ensure there's always a buffer row before the bottom of the terminal
 */
function ensureBottomBuffer(): void {
  const termHeight = getTerminalHeight();
  // Reserve 2 rows: one for the progress bar, one for buffer
  const maxContentRows = termHeight - 2;

  if (linesOutputSinceProgress >= maxContentRows) {
    // We're getting close to the bottom, add some space
    process.stdout.write('\n');
    linesOutputSinceProgress = 0;
  }
}

/**
 * Progress bar for tracking deployment progress
 */
export class ProgressBar {
  private current = 0;
  private total = 0;
  private label: string;
  private barWidth = 30;
  private lastLineCount = 0;
  private eventLines: string[] = [];
  private maxVisibleEvents = 5;

  constructor(label: string, total: number) {
    this.label = label;
    this.total = total;
    this.render();
  }

  /**
   * Update progress and re-render
   */
  update(current: number, eventMessage?: string): void {
    this.current = current;
    if (eventMessage) {
      this.eventLines.push(eventMessage);
      // Keep only the most recent events
      if (this.eventLines.length > this.maxVisibleEvents) {
        this.eventLines.shift();
      }
    }
    this.render();
  }

  /**
   * Add an event message without changing progress
   */
  addEvent(message: string): void {
    this.eventLines.push(message);
    if (this.eventLines.length > this.maxVisibleEvents) {
      this.eventLines.shift();
    }
    this.render();
  }

  /**
   * Clear the progress bar from the terminal
   */
  clear(): void {
    // Move up and clear all lines we've written
    for (let i = 0; i < this.lastLineCount; i++) {
      process.stdout.write('\x1b[A\x1b[2K');
    }
    this.lastLineCount = 0;
  }

  /**
   * Finish and clear the progress bar
   */
  finish(): void {
    this.clear();
  }

  /**
   * Render the progress bar
   */
  private render(): void {
    // Clear previous output
    this.clear();

    const lines: string[] = [];

    // Add event lines
    for (const event of this.eventLines) {
      lines.push(event);
    }

    // Build progress bar
    const percentage = this.total > 0 ? this.current / this.total : 0;
    const filled = Math.round(this.barWidth * percentage);
    const empty = this.barWidth - filled;

    const bar = chalk.green('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
    const count = chalk.cyan(`${this.current}/${this.total}`);
    const labelText = chalk.bold(this.label);

    lines.push(`${labelText} ${bar} ${count} resources`);

    // Add empty line for bottom buffer
    lines.push('');

    // Write all lines
    for (const line of lines) {
      process.stdout.write(line + '\n');
    }

    this.lastLineCount = lines.length;
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
