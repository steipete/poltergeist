/**
 * CLI output formatter for consistent help displays across Poltergeist tools
 */

import chalk from 'chalk';

export interface CommandInfo {
  name: string;
  aliases?: string[];
  description: string;
  args?: string;
}

export interface CommandGroup {
  title: string;
  commands: CommandInfo[];
}

export interface OptionInfo {
  flags: string;
  description: string;
}

export interface ExampleInfo {
  command: string;
  description?: string;
}

/**
 * Format the main header with ghost emoji and colored title
 */
export function header(title: string, tagline: string): string {
  return `👻 ${chalk.cyan(`${title} - ${tagline}`)}`;
}

/**
 * Format a section title (e.g., USAGE, COMMANDS, OPTIONS)
 */
export function sectionTitle(title: string): string {
  return chalk.yellow(title.toUpperCase());
}

/**
 * Format the usage section
 */
export function usage(programName: string, usageText: string): string {
  const lines = [sectionTitle('Usage'), `  $ ${programName} ${usageText}`];
  return lines.join('\n');
}

/**
 * Format a single command with optional aliases
 */
export function formatCommand(cmd: CommandInfo, padTo: number = 25): string {
  const names = cmd.aliases ? `${cmd.name}, ${cmd.aliases.join(', ')}` : cmd.name;
  const fullName = cmd.args ? `${names} ${cmd.args}` : names;
  return `  ${fullName.padEnd(padTo)} ${chalk.gray(cmd.description)}`;
}

/**
 * Format grouped commands
 */
export function commandGroups(groups: CommandGroup[]): string {
  const lines: string[] = [sectionTitle('Commands')];

  for (const group of groups) {
    if (group.title) {
      lines.push(`  ${chalk.white(group.title)}`);
    }

    // Calculate max width for alignment
    const maxWidth = Math.max(
      ...group.commands.map((cmd) => {
        const names = cmd.aliases ? `${cmd.name}, ${cmd.aliases.join(', ')}` : cmd.name;
        const fullName = cmd.args ? `${names} ${cmd.args}` : names;
        return fullName.length;
      })
    );

    const padTo = Math.min(maxWidth + 2, 30);

    for (const cmd of group.commands) {
      lines.push(formatCommand(cmd, padTo));
    }

    lines.push(''); // Empty line after each group
  }

  return lines.join('\n').trimEnd();
}

/**
 * Format simple command list (no groups)
 */
export function commands(commandList: CommandInfo[]): string {
  const lines: string[] = [sectionTitle('Commands')];

  // Calculate max width for alignment
  const maxWidth = Math.max(
    ...commandList.map((cmd) => {
      const names = cmd.aliases ? `${cmd.name}, ${cmd.aliases.join(', ')}` : cmd.name;
      const fullName = cmd.args ? `${names} ${cmd.args}` : names;
      return fullName.length;
    })
  );

  const padTo = Math.min(maxWidth + 2, 30);

  for (const cmd of commandList) {
    lines.push(formatCommand(cmd, padTo));
  }

  return lines.join('\n');
}

/**
 * Format options section
 */
export function options(optionList: OptionInfo[]): string {
  const lines: string[] = [sectionTitle('Options')];

  // Calculate max width for alignment
  const maxWidth = Math.max(...optionList.map((opt) => opt.flags.length));
  const padTo = Math.min(maxWidth + 2, 30);

  for (const opt of optionList) {
    lines.push(`  ${opt.flags.padEnd(padTo)} ${chalk.gray(opt.description)}`);
  }

  return lines.join('\n');
}

/**
 * Format examples section
 */
export function examples(programName: string, exampleList: ExampleInfo[]): string {
  const lines: string[] = [sectionTitle('Examples')];

  for (const example of exampleList) {
    lines.push(`  $ ${programName} ${example.command}`);
    if (example.description) {
      lines.push(`    ${chalk.gray(example.description)}`);
    }
  }

  return lines.join('\n');
}

/**
 * Format a complete help display
 */
export function formatHelp(config: {
  title: string;
  tagline: string;
  programName: string;
  usage: string;
  commands?: CommandInfo[];
  commandGroups?: CommandGroup[];
  options: OptionInfo[];
  examples?: ExampleInfo[];
  additionalSections?: { title: string; content: string }[];
}): string {
  const sections: string[] = [];

  // Header
  sections.push(header(config.title, config.tagline));
  sections.push(''); // blank line

  // Usage
  sections.push(usage(config.programName, config.usage));
  sections.push('');

  // Commands (either grouped or simple)
  if (config.commandGroups && config.commandGroups.length > 0) {
    sections.push(commandGroups(config.commandGroups));
    sections.push('');
  } else if (config.commands && config.commands.length > 0) {
    sections.push(commands(config.commands));
    sections.push('');
  }

  // Additional sections (like Available Targets for polter)
  if (config.additionalSections) {
    for (const section of config.additionalSections) {
      sections.push(sectionTitle(section.title));
      sections.push(section.content);
      sections.push('');
    }
  }

  // Options
  sections.push(options(config.options));

  // Examples
  if (config.examples && config.examples.length > 0) {
    sections.push('');
    sections.push(examples(config.programName, config.examples));
  }

  return sections.join('\n');
}

/**
 * Format a target item with status for polter
 */
export function formatTarget(
  name: string,
  status: 'success' | 'building' | 'failed' | 'not-running' | 'unknown',
  outputPath?: string
): string {
  let statusIcon = '';
  let statusText = '';

  switch (status) {
    case 'success':
      statusIcon = chalk.green('✓');
      statusText = chalk.gray(' (ready)');
      break;
    case 'building':
      statusIcon = chalk.yellow('⟳');
      statusText = chalk.yellow(' (building...)');
      break;
    case 'failed':
      statusIcon = chalk.red('✗');
      statusText = chalk.red(' (failed)');
      break;
    case 'not-running':
      statusIcon = chalk.gray('○');
      statusText = chalk.gray(' (poltergeist not running)');
      break;
    default:
      statusIcon = chalk.gray('?');
      statusText = chalk.gray(' (unknown)');
  }

  const lines = [`  ${statusIcon} ${chalk.bold(name)}${statusText}`];
  if (outputPath) {
    lines.push(chalk.gray(`    Output: ${outputPath}`));
  }

  return lines.join('\n');
}

/**
 * Format footer note
 */
export function footer(message: string): string {
  return chalk.gray(message);
}

// For backward compatibility, export as namespace
export const CLIFormatter = {
  header,
  sectionTitle,
  usage,
  formatCommand,
  commandGroups,
  commands,
  options,
  examples,
  formatHelp,
  formatTarget,
  footer,
};
