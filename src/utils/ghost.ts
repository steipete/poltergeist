/**
 * Ghost emoji helper for consistent branding across Poltergeist
 *
 * The ghost color indicates the message type:
 * - Cyan: Brand identity (headers, main UI)
 * - Green: Success messages
 * - Yellow: Warning messages
 * - Red: Error messages
 * - Gray: Info/debug messages
 */

import chalk from 'chalk';

/**
 * Semantic ghost emoji colors for different message types
 */
export const ghost = {
  /**
   * Brand ghost (cyan) - Use for headers and main branding
   */
  brand: () => chalk.cyan('👻'),

  /**
   * Success ghost (green) - Use for successful operations
   */
  success: () => chalk.green('👻'),

  /**
   * Warning ghost (yellow) - Use for warnings and cautions
   */
  warning: () => chalk.yellow('👻'),

  /**
   * Error ghost (red) - Use for errors and failures
   */
  error: () => chalk.red('👻'),

  /**
   * Info ghost (gray) - Use for informational and debug messages
   */
  info: () => chalk.gray('👻'),

  /**
   * Plain ghost (no color) - Use when color would be redundant
   */
  plain: () => '👻',
} as const;

/**
 * Format a Poltergeist message with appropriate ghost color
 * @param type - The message type determining ghost color
 * @param message - The message content (without [Poltergeist] prefix)
 * @returns Formatted message with colored ghost and [Poltergeist] prefix
 */
export function poltergeistMessage(type: keyof typeof ghost, message: string): string {
  return `${ghost[type]()} [Poltergeist] ${message}`;
}
