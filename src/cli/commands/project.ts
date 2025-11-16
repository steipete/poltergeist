import { existsSync, writeFileSync } from 'fs';
import path, { join } from 'path';
import chalk from 'chalk';
import type { Command } from 'commander';
import { augmentConfigWithDetectedTargets, findXcodeProjects, generateDefaultConfig, guessBundleId } from '../init-helpers.js';
import { loadConfigOrExit, exitWithError } from '../shared.js';
import { createLogger } from '../../logger.js';
import { WatchmanConfigManager } from '../../watchman-config.js';
import { CMakeProjectAnalyzer } from '../../utils/cmake-analyzer.js';
import { FileSystemUtils } from '../../utils/filesystem.js';
import { ghost, poltergeistMessage } from '../../utils/ghost.js';
import type { AppBundleTarget, PoltergeistConfig, ProjectType, Target } from '../../types.js';
import { instantiateStateManager } from '../loaders.js';
import { applyConfigOption } from '../options.js';

export const registerProjectCommands = (program: Command): void => {
  program
    .command('init')
    .description('Initialize Poltergeist configuration for your project')
    .option('--cmake', 'Initialize for CMake project')
    .option('--auto', 'Auto-detect project type')
    .option('--preset <name>', 'Use specific CMake preset')
    .option('--generator <gen>', 'CMake generator to use')
    .option('--build-dir <dir>', 'Build directory', 'build')
    .option('--dry-run', 'Show what would be generated without creating config')
    .option('--no-auto-add', 'Skip auto-adding inferred targets when none are enabled')
    .action(async (options) => {
      const projectRoot = process.cwd();
      const configPath = join(projectRoot, 'poltergeist.config.json');
      const initLogger = createLogger();
      const watchmanManager = new WatchmanConfigManager(projectRoot, initLogger);

      if (existsSync(configPath) && !options.dryRun) {
        exitWithError(
          '❌ poltergeist.config.json already exists!\nRemove it first or use --dry-run to preview changes.'
        );
      }

      console.log(chalk.gray(poltergeistMessage('info', 'Initializing configuration...')));

      let projectType: ProjectType;

      if (options.cmake) {
        projectType = 'cmake';
      } else if (options.auto) {
        projectType = await watchmanManager.detectProjectType();
        console.log(chalk.blue(`Auto-detected project type: ${projectType}`));
      } else {
        projectType = await watchmanManager.detectProjectType();
        console.log(chalk.blue(`Auto-detected project type: ${projectType}`));
      }

      let config!: PoltergeistConfig;

      if (projectType === 'cmake') {
        try {
          const analyzer = new CMakeProjectAnalyzer(projectRoot);
          console.log(chalk.gray('Analyzing CMake project...'));
          const analysis = await analyzer.analyzeProject();

          console.log(chalk.green(`✅ Found ${analysis.targets.length} CMake targets`));
          if (analysis.generator) {
            console.log(chalk.blue(`📊 Generator: ${analysis.generator}`));
          }

          const targets = analyzer.generatePoltergeistTargets(analysis);

          config = {
            version: '1.0',
            projectType: 'cmake',
            targets,
            watchman: {
              excludeDirs: [analysis.buildDirectory || 'build'],
            },
            notifications: {
              successSound: 'Glass',
              failureSound: 'Basso',
            },
          } as PoltergeistConfig;

          if (options.generator) {
            targets.forEach((target) => {
              if ('generator' in target && target.generator !== undefined) {
                target.generator = options.generator;
              }
            });
          }
        } catch (error) {
          exitWithError(`Failed to analyze CMake project: ${error}`);
        }
      } else {
        if (projectType === 'swift' || projectType === 'mixed') {
          const xcodeProjects = await findXcodeProjects(projectRoot);

          if (xcodeProjects.length > 0) {
            console.log(chalk.green(`✅ Found ${xcodeProjects.length} Xcode project(s)`));

            const targets: Target[] = [];
            const usedNames = new Set<string>();

            for (const project of xcodeProjects) {
              const projectDir = path.dirname(project.path);
              const projectName = path.basename(project.path, path.extname(project.path));
              const relativeDir = path.relative(projectRoot, projectDir) || '.';
              const isIOS =
                projectName.toLowerCase().includes('ios') || project.path.toLowerCase().includes('/ios/');

              const targetName =
                projectName
                  .toLowerCase()
                  .replace(/[^a-z0-9]/g, '')
                  .replace(/ios$/, '') || 'app';

              let finalTargetName = isIOS ? `${targetName}-ios` : targetName;
              let suffix = 2;
              while (usedNames.has(finalTargetName)) {
                finalTargetName = isIOS ? `${targetName}${suffix}-ios` : `${targetName}${suffix}`;
                suffix++;
              }
              usedNames.add(finalTargetName);

              const buildScript = existsSync(path.join(projectDir, 'scripts', 'build.sh'));
              const buildCommand = buildScript
                ? `cd ${relativeDir} && ./scripts/build.sh --configuration Debug`
                : project.type === 'xcworkspace'
                  ? `cd ${relativeDir} && xcodebuild -workspace ${path.basename(project.path)} -scheme ${project.scheme || projectName} -configuration Debug build`
                  : `cd ${relativeDir} && xcodebuild -project ${path.basename(project.path)} -scheme ${project.scheme || projectName} -configuration Debug build`;

              const target: AppBundleTarget = {
                name: finalTargetName,
                type: 'app-bundle',
                buildCommand,
                bundleId: guessBundleId(projectName, project.path),
                watchPaths: [
                  `${relativeDir}/**/*.swift`,
                  `${relativeDir}/**/*.xcodeproj/**`,
                  `${relativeDir}/**/*.xcconfig`,
                  `${relativeDir}/**/*.entitlements`,
                  `${relativeDir}/**/*.plist`,
                ],
                environment: {
                  CONFIGURATION: 'Debug',
                },
              };

              if (isIOS) {
                target.enabled = false;
              }

              targets.push(target);
            }

            config = {
              version: '1.0',
              projectType: 'swift',
              targets,
            };
          } else {
            config = generateDefaultConfig(projectType);
          }
        } else {
          config = generateDefaultConfig(projectType);
        }
      }

      const detectedTargets = await augmentConfigWithDetectedTargets(projectRoot, config, {
        allowAutoAdd: options.autoAdd !== false,
      });

      const configJson = JSON.stringify(config, null, 2);

      if (options.dryRun) {
        console.log(chalk.yellow('\n--dry-run mode, would create:'));
        console.log(chalk.gray('poltergeist.config.json:'));
        console.log(configJson);
        if (detectedTargets.length > 0) {
          console.log(
            chalk.gray(
              `Auto-detected targets (not written): ${detectedTargets
                .map((t) => `${t.name} (${t.reason})`)
                .join(', ')}`
            )
          );
        }
      } else {
        writeFileSync(configPath, configJson, 'utf-8');
        console.log(chalk.green('✅ Created poltergeist.config.json'));
        if (detectedTargets.length > 0) {
          console.log(
            chalk.gray(
              `Auto-added targets: ${detectedTargets
                .map((t) => `${t.name} (${t.reason})`)
                .join(', ')}`
            )
          );
        }

        console.log(chalk.blue('\n📋 For AI Agent Integration (Claude, Cursor, etc.):'));
        console.log(chalk.gray('  Consider adding a CLAUDE.md file with instructions like:'));
        console.log(chalk.gray('  • NEVER manually run build commands when Poltergeist is running'));
        console.log(chalk.gray('  • ALWAYS use "polter <target>" to ensure fresh builds'));
        console.log(chalk.gray('  • Poltergeist automatically detects changes and rebuilds'));
        console.log(chalk.gray('  This helps AI agents work better with your project!'));

        console.log(chalk.blue(`\nNext steps:`));
        console.log(chalk.gray('  1. Review and adjust the configuration as needed'));
        console.log(chalk.gray('  2. Run "poltergeist haunt" to start watching'));
      }
    });

  const listCmd = program
    .command('list')
    .description('List all configured targets')
    .action(async (options) => {
      const { config } = await loadConfigOrExit(options.config);

      console.log(chalk.cyan(`${ghost.brand()} Configured Targets`));
      console.log(chalk.gray('═'.repeat(50)));

      if (config.targets.length === 0) {
        console.log(chalk.gray('No targets configured'));
      } else {
        config.targets.forEach((target) => {
          const status = target.enabled ? chalk.green('✓') : chalk.red('✗');
          console.log(`${status} ${chalk.cyan(target.name)} (${target.type})`);
          console.log(`  Build: ${target.buildCommand}`);
          console.log(`  Watch: ${target.watchPaths.join(', ')}`);

          if (target.type === 'executable' && 'outputPath' in target) {
            console.log(`  Output: ${target.outputPath}`);
          } else if (target.type === 'app-bundle' && 'bundleId' in target) {
            console.log(`  Bundle ID: ${target.bundleId}`);
            if (target.platform) {
              console.log(`  Platform: ${target.platform}`);
            }
          }
          console.log();
        });
      }
    });

  applyConfigOption(listCmd);

  program
    .command('clean')
    .description('Clean up stale state files')
    .option('-a, --all', 'Remove all state files, not just stale ones')
    .option('-d, --days <number>', 'Remove state files older than N days', '7')
    .option('--dry-run', 'Show what would be removed without actually removing')
    .option('--json', 'Output a JSON summary (non-dry-run only removes files)')
    .action(async (options) => {
      try {
        console.log(chalk.gray(poltergeistMessage('info', 'Cleaning up state files...')));

        const { StateManager } = await import('../../state.js');
        const stateFiles = await StateManager.listAllStates();

        if (stateFiles.length === 0) {
          console.log(chalk.green('No state files found'));
          return;
        }

        const logger = createLogger();
        const msPerDay = 24 * 60 * 60 * 1000;
        const daysThreshold = Number.parseInt(options.days, 10);
        const ageThreshold = Date.now() - daysThreshold * msPerDay;
        const fallbackProjectRoot = FileSystemUtils.findProjectRoot(process.cwd()) || process.cwd();
        let removedCount = 0;
        let candidateCount = 0;
        const jsonReport: Array<Record<string, unknown>> = [];

        if (process.env.POLTERGEIST_DEBUG_CLEAN === 'true') {
          console.log('CLEAN files', JSON.stringify(stateFiles));
        }

        const deriveTargetName = (fileName: string): string => {
          const hashedPattern = /^(.*?)-([0-9a-f]{8})-(.+)\.state$/i;
          const match = fileName.match(hashedPattern);
          if (match) {
            return match[3];
          }
          return fileName.replace(/\.state$/i, '');
        };

        const readStateForFile = async (manager: any, file: string, targetName: string): Promise<any> => {
          let state = await manager.readState(targetName);
          if (!state) {
            const fallbackName = file.replace(/\.state$/i, '');
            if (fallbackName && fallbackName !== targetName) {
              state = await manager.readState(fallbackName);
            }
          }
          return state;
        };

        const stateManager = await instantiateStateManager(fallbackProjectRoot, logger);

        for (const file of stateFiles) {
          const targetName = deriveTargetName(file);
          const state = await readStateForFile(stateManager, file, targetName);

          if (!state) {
            continue;
          }

          if (process.env.POLTERGEIST_DEBUG_CLEAN === 'true') {
            console.log(
              'CLEAN state',
              JSON.stringify(
                {
                  file,
                  targetName,
                  process: state.process,
                  options,
                },
                null,
                2
              )
            );
          }

          let shouldRemove = false;
          let reason = '';

          if (options.all) {
            shouldRemove = true;
            reason = 'all files';
          } else if (!state.process?.isActive) {
            const heartbeat = state.process?.lastHeartbeat
              ? new Date(state.process.lastHeartbeat).getTime()
              : undefined;
            if (heartbeat !== undefined && heartbeat < ageThreshold) {
              shouldRemove = true;
              reason = `inactive for ${daysThreshold}+ days`;
            }
          }

          if (!shouldRemove) {
            continue;
          }

          candidateCount++;

          const actionLabel = options.dryRun ? 'Would remove' : 'Removing';
          const message = `${actionLabel}: ${file}`;
          console.log(options.dryRun ? chalk.blue(message) : chalk.yellow(message));
          console.log(`    Project: ${state.projectName || 'unknown'}`);
          console.log(`    Target: ${state.target || targetName}`);

          if (state.process?.lastHeartbeat) {
            const heartbeatMs = new Date(state.process.lastHeartbeat).getTime();
            if (!Number.isNaN(heartbeatMs)) {
              const ageDays = Math.round((Date.now() - heartbeatMs) / msPerDay);
              console.log(`    Age: ${ageDays} days`);
            }
          }

          console.log(`    Reason: ${reason}`);
          console.log();

          if (!options.dryRun) {
            const removalKey = state.target || targetName;
            await stateManager.removeState(removalKey);
            removedCount++;
          }

          jsonReport.push({
            file,
            project: state.projectName || 'unknown',
            target: state.target || targetName,
            reason,
          });
        }

        if (options.dryRun) {
          console.log(chalk.blue(`Would remove ${candidateCount} state file(s)`));
        } else {
          console.log(
            chalk.green(poltergeistMessage('success', `Removed ${removedCount} state file(s)`))
          );
          if (options.json) {
            console.log(
              JSON.stringify(
                { removed: removedCount, candidates: candidateCount, files: jsonReport },
                null,
                2
              )
            );
          }
        }
      } catch (error) {
        if (process.env.POLTERGEIST_DEBUG_CLEAN === 'true') {
          console.error('CLEAN command failed:', error);
        }
        throw error;
      }
    });
};
