import type { Command } from 'commander';

/**
 * Shared configuration for the polter command
 * Used by both standalone polter and poltergeist subcommand
 */

export interface PolterOption {
  flag: string;
  description: string;
  defaultValue?: string | boolean;
}

export interface ParsedPolterOptions {
  timeout: number;
  force: boolean;
  noWait: boolean;
  verbose: boolean;
  showLogs: boolean;
  logLines: number;
  help?: boolean;
}

/**
 * Definition of all polter command options
 */
export const POLTER_OPTIONS: PolterOption[] = [
  {
    flag: '-t, --timeout <ms>',
    description: 'Build wait timeout in milliseconds',
    defaultValue: '300000',
  },
  {
    flag: '-f, --force',
    description: 'Run even if build failed',
    defaultValue: false,
  },
  {
    flag: '-n, --no-wait',
    description: "Don't wait for builds, fail if building",
  },
  {
    flag: '--verbose',
    description: 'Show detailed status information',
    defaultValue: false,
  },
  {
    flag: '--no-logs',
    description: 'Disable build log streaming during progress',
  },
  {
    flag: '--log-lines <number>',
    description: 'Number of log lines to show',
    defaultValue: '5',
  },
];

/**
 * Parse raw command options into structured format
 */
export function parsePolterOptions(options: any): ParsedPolterOptions {
  return {
    timeout: Number.parseInt(options.timeout, 10),
    force: options.force,
    noWait: !options.wait, // --no-wait sets wait=false
    verbose: options.verbose,
    showLogs: options.logs !== false, // --no-logs sets logs=false
    logLines: Number.parseInt(options.logLines, 10),
    help: options.help,
  };
}

/**
 * Configure a Commander command with polter options
 */
export function configurePolterCommand(command: Command): Command {
  // Add each option to the command
  for (const option of POLTER_OPTIONS) {
    if (option.defaultValue !== undefined) {
      command.option(option.flag, option.description, option.defaultValue);
    } else {
      command.option(option.flag, option.description);
    }
  }
  
  // Allow unknown options to be passed through to the target
  command.allowUnknownOption();
  
  return command;
}

/**
 * Get the command description for help text
 */
export function getPolterDescription(): string {
  return 'Execute fresh binaries managed by Poltergeist';
}

/**
 * Shared unhandled rejection handler for polter commands
 */
export function setupPolterErrorHandling(): void {
  process.on('unhandledRejection', (reason) => {
    console.error('👻 [Poltergeist] Unhandled promise rejection:');
    console.error(`   ${reason}`);
    console.error('\n   This is likely a bug. Please report it with:');
    console.error('   • Your poltergeist.config.json');
    console.error('   • The command you ran');
    console.error('   • Your environment (OS, Node version)');
    process.exit(1);
  });
}