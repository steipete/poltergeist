import { createPoltergeist } from '../factories.js';
import type { Logger } from '../logger.js';
import type { PoltergeistConfig } from '../types.js';
import { PanelApp } from './panel-app.js';
import { StatusPanelController } from './panel-controller.js';

interface RunPanelOptions {
  config: PoltergeistConfig;
  projectRoot: string;
  configPath?: string;
  logger: Logger;
  gitSummaryMode?: 'ai' | 'list';
}

export async function runStatusPanel(options: RunPanelOptions): Promise<void> {
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    console.error(
      'Poltergeist panel requires an interactive terminal (TTY). Run this command directly in a terminal window.'
    );
    console.error('Fallback: use "poltergeist status --verbose" for a non-interactive summary.');
    return;
  }

  // Default: keep the main screen so mouse scroll keeps working; opt-in via POLTERGEIST_PANEL_ALT=1
  const useAltBuffer = process.env.POLTERGEIST_PANEL_ALT === '1';

  const enterAlternateBuffer = () => {
    if (!useAltBuffer) return;
    process.stdout.write('\x1b[?1049h'); // Switch to alt buffer
    process.stdout.write('\x1b[?25l'); // Hide cursor
  };

  const clearScreen = () => {
    process.stdout.write('\x1b[2J\x1b[H');
  };

  const leaveAlternateBuffer = () => {
    if (!useAltBuffer) return;
    process.stdout.write('\x1b[?25h'); // Show cursor
    process.stdout.write('\x1b[?1049l'); // Restore main buffer
  };

  enterAlternateBuffer();
  clearScreen();

  const poltergeist = createPoltergeist(
    options.config,
    options.projectRoot,
    options.logger,
    options.configPath
  );
  const controller = new StatusPanelController({
    config: options.config,
    projectRoot: options.projectRoot,
    logger: options.logger,
    fetchStatus: () => poltergeist.getStatus(),
    gitSummaryMode: options.gitSummaryMode,
  });

  await controller.start();
  const panel = new PanelApp({ controller, logger: options.logger });

  try {
    await panel.start();
  } finally {
    panel.dispose();
    controller.dispose();
    leaveAlternateBuffer();
  }
}
