/**
 * Strip ANSI escape sequences from a string.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: pattern needs the ANSI escape byte
const ansiEscapePattern = /\u001B\[[0-9;]*m/g;

export const stripAnsi = (input: string): string => input.replace(ansiEscapePattern, '');
