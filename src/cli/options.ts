import type { Command } from 'commander';

export const applyConfigOption = (cmd: Command): Command =>
  cmd.option('-c, --config <path>', 'Path to config file');

export const applyTargetOption = (cmd: Command): Command =>
  cmd.option('-t, --target <name>', 'Target to build (omit to build all enabled targets)');

export const applyLogLevelOptions = (cmd: Command): Command =>
  cmd
    .option('--verbose', 'Enable verbose logging (same as --log-level debug)')
    .option('--log-level <level>', 'Set log level (debug, info, warn, error)');
