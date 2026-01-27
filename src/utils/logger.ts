/**
 * Logging utility with verbose mode support
 */

import chalk from 'chalk';

let verboseMode = false;

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
