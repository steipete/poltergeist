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

export class CLIFormatter {
  /**
   * Format the main header with ghost emoji and colored title
   */
  static header(title: string, tagline: string): string {
    return `👻 ${chalk.cyan(`${title} - ${tagline}`)}`;
  }

  /**
   * Format a section title (e.g., USAGE, COMMANDS, OPTIONS)
   */
  static sectionTitle(title: string): string {
    return chalk.yellow(title.toUpperCase());
  }

  /**
   * Format the usage section
   */
  static usage(programName: string, usage: string): string {
    const lines = [
      this.sectionTitle('Usage'),
      `  $ ${programName} ${usage}`,
    ];
    return lines.join('\n');
  }

  /**
   * Format a single command with optional aliases
   */
  static formatCommand(cmd: CommandInfo, padTo: number = 25): string {
    const names = cmd.aliases ? `${cmd.name}, ${cmd.aliases.join(', ')}` : cmd.name;
    const fullName = cmd.args ? `${names} ${cmd.args}` : names;
    return `  ${fullName.padEnd(padTo)} ${chalk.gray(cmd.description)}`;
  }

  /**
   * Format grouped commands
   */
  static commandGroups(groups: CommandGroup[]): string {
    const lines: string[] = [this.sectionTitle('Commands')];
    
    for (const group of groups) {
      if (group.title) {
        lines.push(`  ${chalk.white(group.title)}`);
      }
      
      // Calculate max width for alignment
      const maxWidth = Math.max(...group.commands.map(cmd => {
        const names = cmd.aliases ? `${cmd.name}, ${cmd.aliases.join(', ')}` : cmd.name;
        const fullName = cmd.args ? `${names} ${cmd.args}` : names;
        return fullName.length;
      }));
      
      const padTo = Math.min(maxWidth + 2, 30);
      
      for (const cmd of group.commands) {
        lines.push(this.formatCommand(cmd, padTo));
      }
      
      lines.push(''); // Empty line after each group
    }
    
    return lines.join('\n').trimEnd();
  }

  /**
   * Format simple command list (no groups)
   */
  static commands(commands: CommandInfo[]): string {
    const lines: string[] = [this.sectionTitle('Commands')];
    
    // Calculate max width for alignment
    const maxWidth = Math.max(...commands.map(cmd => {
      const names = cmd.aliases ? `${cmd.name}, ${cmd.aliases.join(', ')}` : cmd.name;
      const fullName = cmd.args ? `${names} ${cmd.args}` : names;
      return fullName.length;
    }));
    
    const padTo = Math.min(maxWidth + 2, 30);
    
    for (const cmd of commands) {
      lines.push(this.formatCommand(cmd, padTo));
    }
    
    return lines.join('\n');
  }

  /**
   * Format options section
   */
  static options(options: OptionInfo[]): string {
    const lines: string[] = [this.sectionTitle('Options')];
    
    // Calculate max width for alignment
    const maxWidth = Math.max(...options.map(opt => opt.flags.length));
    const padTo = Math.min(maxWidth + 2, 30);
    
    for (const opt of options) {
      lines.push(`  ${opt.flags.padEnd(padTo)} ${chalk.gray(opt.description)}`);
    }
    
    return lines.join('\n');
  }

  /**
   * Format examples section
   */
  static examples(programName: string, examples: ExampleInfo[]): string {
    const lines: string[] = [this.sectionTitle('Examples')];
    
    for (const example of examples) {
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
  static formatHelp(config: {
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
    sections.push(this.header(config.title, config.tagline));
    sections.push(''); // blank line
    
    // Usage
    sections.push(this.usage(config.programName, config.usage));
    sections.push('');
    
    // Commands (either grouped or simple)
    if (config.commandGroups && config.commandGroups.length > 0) {
      sections.push(this.commandGroups(config.commandGroups));
      sections.push('');
    } else if (config.commands && config.commands.length > 0) {
      sections.push(this.commands(config.commands));
      sections.push('');
    }
    
    // Additional sections (like Available Targets for polter)
    if (config.additionalSections) {
      for (const section of config.additionalSections) {
        sections.push(this.sectionTitle(section.title));
        sections.push(section.content);
        sections.push('');
      }
    }
    
    // Options
    sections.push(this.options(config.options));
    
    // Examples
    if (config.examples && config.examples.length > 0) {
      sections.push('');
      sections.push(this.examples(config.programName, config.examples));
    }
    
    return sections.join('\n');
  }

  /**
   * Format a target item with status for polter
   */
  static formatTarget(
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
  static footer(message: string): string {
    return chalk.gray(message);
  }
}