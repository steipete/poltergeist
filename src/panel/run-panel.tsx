import { render } from 'ink';
import { createPoltergeist } from '../factories.js';
import type { PoltergeistConfig } from '../types.js';
import type { Logger } from '../logger.js';
import { StatusPanelController } from './panel-controller.js';
import { PanelApp } from './panel-app.js';

interface RunPanelOptions {
  config: PoltergeistConfig;
  projectRoot: string;
  configPath?: string;
  logger: Logger;
}

export async function runStatusPanel(options: RunPanelOptions): Promise<void> {
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    console.error(
      'Poltergeist panel requires an interactive terminal (TTY). Run this command directly in a terminal window.'
    );
    console.error('Fallback: use "poltergeist status --verbose" for a non-interactive summary.');
    return;
  }

  const poltergeist = createPoltergeist(options.config, options.projectRoot, options.logger, options.configPath);
  const controller = new StatusPanelController({
    config: options.config,
    projectRoot: options.projectRoot,
    logger: options.logger,
    fetchStatus: () => poltergeist.getStatus(),
  });

  await controller.start();

  const ink = render(<PanelApp controller={controller} />);

  try {
    await ink.waitUntilExit();
  } finally {
    controller.dispose();
  }
}
