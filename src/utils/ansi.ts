/**
 * Strip ANSI escape sequences from a string.
 */
export const stripAnsi = (input: string): string => input.replace(/\x1B\[[0-9;]*m/g, '');
