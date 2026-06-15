#!/usr/bin/env node

import { Command } from "commander";
import {
  configurePolterCommand,
  getPolterDescription,
  parsePolterOptions,
  setupPolterErrorHandling,
} from "./cli-shared/polter-command.js";
import { PACKAGE_INFO } from "./cli/version.js";
import { runWrapperWithDefaults } from "./polter/runner.js";
import { isMainModule, isPolterEntrypoint } from "./utils/paths.js";

export { isBinaryFresh, resolveBinaryPath } from "./polter/binaries.js";
export { runWrapper } from "./polter/runner.js";

if (process.argv[1] && (isMainModule() || isPolterEntrypoint(process.argv[1]))) {
  const program = new Command();

  const polterCommand = program
    .name("polter")
    .description(getPolterDescription())
    .version(PACKAGE_INFO.version, "-v, --version", "output the version number")
    .argument("[target]", "Name of the target to run")
    .argument("[args...]", "Arguments to pass to the target executable")
    .helpOption(false)
    .option("-h, --help", "Show help for polter");

  configurePolterCommand(polterCommand);

  polterCommand.action(async (target: string | undefined, args: string[], options) => {
    const parsedOptions = parsePolterOptions(options);
    await runWrapperWithDefaults(target, args, parsedOptions);
  });

  setupPolterErrorHandling();

  program.parse();
}
