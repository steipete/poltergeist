import { existsSync } from 'fs';
import { readdir, readFile } from 'fs/promises';
import path, { join } from 'path';
import type { PoltergeistConfig, ProjectType } from '../types.js';

// Helper function to find Xcode projects in directory
export async function findXcodeProjects(
  rootPath: string,
  maxDepth: number = 2
): Promise<Array<{ path: string; type: 'xcodeproj' | 'xcworkspace'; scheme?: string }>> {
  const projects: Array<{ path: string; type: 'xcodeproj' | 'xcworkspace'; scheme?: string }> = [];

  async function scan(dir: string, depth: number) {
    if (depth > maxDepth) return;

    try {
      const entries = await readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);

        if (entry.isDirectory()) {
          if (entry.name.endsWith('.xcworkspace')) {
            projects.push({ path: fullPath, type: 'xcworkspace' });
          } else if (entry.name.endsWith('.xcodeproj')) {
            const scheme = entry.name.replace('.xcodeproj', '');
            projects.push({ path: fullPath, type: 'xcodeproj', scheme });
          } else if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
            await scan(fullPath, depth + 1);
          }
        }
      }
    } catch (_error) {
      // Ignore permission errors
    }
  }

  await scan(rootPath, 0);
  return projects;
}

// Helper to guess bundle ID from project
export function guessBundleId(projectName: string, projectPath: string): string {
  // Common patterns
  const cleanName = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/ios$/, '');

  const isIOS =
    projectName.toLowerCase().includes('ios') || projectPath.toLowerCase().includes('/ios/');

  // Try to extract from common patterns
  if (projectPath.includes('vibetunnel')) {
    return projectPath.includes('ios')
      ? 'sh.vibetunnel.vibetunnel.ios'
      : 'sh.vibetunnel.vibetunnel';
  }

  return isIOS ? `com.example.${cleanName}.ios` : `com.example.${cleanName}`;
}

export interface DetectionSummary {
  name: string;
  type: string;
  reason: string;
}

export interface AugmentOptions {
  /** Allow auto-added targets (Makefile/Go/Python). Defaults to true. */
  allowAutoAdd?: boolean;
}

export async function augmentConfigWithDetectedTargets(
  projectRoot: string,
  config: PoltergeistConfig,
  options: AugmentOptions = {}
): Promise<DetectionSummary[]> {
  const summaries: DetectionSummary[] = [];
  if (options.allowAutoAdd === false) {
    return summaries;
  }

  const hasEnabledTarget = config.targets.some((target) => target.enabled !== false);
  if (hasEnabledTarget) {
    return summaries;
  }

  try {
    const dirEntries = await readdir(projectRoot, { withFileTypes: true });
    const entryMap = new Map(dirEntries.map((entry) => [entry.name.toLowerCase(), entry]));

    const resolveEntryName = (key: string): string => entryMap.get(key)?.name ?? key;

    if (entryMap.has('makefile')) {
      const makefileName = resolveEntryName('makefile');
      const makefilePath = join(projectRoot, makefileName);
      let targetName = 'app';
      let outputPath = './app';
      let buildCommand = 'make';

      try {
        const makefile = await readFile(makefilePath, 'utf-8');
        const targetMatch = makefile.match(/^\s*TARGET\s*[:=]\s*([^\s]+)\s*$/m);
        if (targetMatch) {
          targetName = targetMatch[1];
          outputPath = `./${targetName}`;
          buildCommand = `make ${targetName}`;
        }
      } catch {
        // Fallback to defaults if Makefile cannot be read
      }

      config.targets.push({
        name: targetName,
        type: 'executable',
        enabled: true,
        buildCommand,
        outputPath,
        watchPaths: ['**/*.c', '**/*.h', 'Makefile'],
      });
      summaries.push({ name: targetName, type: 'executable', reason: 'makefile' });
      return summaries;
    }

    const hasGoMod = entryMap.has('go.mod');
    const hasRootGoFile = dirEntries.some(
      (entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.go')
    );

    if (hasGoMod || hasRootGoFile) {
      const goTargets: Array<{ name: string; packagePath: string }> = [];
      const cmdEntry = entryMap.get('cmd');

      if (cmdEntry?.isDirectory()) {
        const cmdDirPath = join(projectRoot, cmdEntry.name);
        try {
          const cmdDirEntries = await readdir(cmdDirPath, { withFileTypes: true });
          for (const subEntry of cmdDirEntries) {
            if (!subEntry.isDirectory()) continue;
            const mainFilePath = join(cmdDirPath, subEntry.name, 'main.go');
            if (existsSync(mainFilePath)) {
              goTargets.push({
                name: subEntry.name,
                packagePath: `./cmd/${subEntry.name}`,
              });
            }
          }
        } catch {
          // Ignore read errors and fall back to root detection.
        }
      }

      if (goTargets.length === 0 && entryMap.has('main.go')) {
        goTargets.push({
          name: path.basename(projectRoot),
          packagePath: '.',
        });
      }

      if (goTargets.length > 0) {
        for (const target of goTargets) {
          config.targets.push({
            name: target.name,
            type: 'executable',
            enabled: true,
            buildCommand: `mkdir -p ./dist/bin && go build -o ./dist/bin/${target.name} ${target.packagePath}`,
            outputPath: `./dist/bin/${target.name}`,
            watchPaths: ['**/*.go', 'go.mod', 'go.sum'],
          });
          summaries.push({ name: target.name, type: 'executable', reason: 'go' });
        }
        return summaries;
      }
    }

    const hasPythonIndicator =
      entryMap.has('pyproject.toml') ||
      entryMap.has('requirements.txt') ||
      entryMap.has('setup.py');
    const hasPythonDirectory = dirEntries.some(
      (entry) => entry.isDirectory() && ['tests', 'src'].includes(entry.name.toLowerCase())
    );
    const hasPythonFile = dirEntries.some(
      (entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.py')
    );

    if (hasPythonIndicator || hasPythonDirectory || hasPythonFile) {
      config.targets.push({
        name: 'tests',
        type: 'executable',
        enabled: true,
        buildCommand: "python3 -m unittest discover -s tests -p '*.py' -v > test-results.txt 2>&1",
        outputPath: './test-results.txt',
        watchPaths: [
          '*.py',
          'src/**/*.py',
          'tests/**/*.py',
          'pyproject.toml',
          'requirements.txt',
          'setup.py',
        ],
      });
      summaries.push({ name: 'tests', type: 'executable', reason: 'python' });
    }
  } catch {
    // Ignore detection failures; config will remain minimal
  }

  return summaries;
}

// Helper function to generate default config for non-CMake projects
export function generateDefaultConfig(projectType: ProjectType): PoltergeistConfig {
  const baseConfig: PoltergeistConfig = {
    version: '1.0',
    projectType,
    targets: [],
  };

  // Add default targets based on project type
  switch (projectType) {
    case 'node':
      baseConfig.targets.push({
        name: 'dev',
        type: 'executable',
        enabled: true,
        buildCommand: 'pnpm run build',
        outputPath: './dist/index.js',
        watchPaths: ['src/**/*.ts', 'src/**/*.js', 'package.json'],
      });
      break;
    case 'rust':
      baseConfig.targets.push({
        name: 'debug',
        type: 'executable',
        enabled: true,
        buildCommand: 'cargo build',
        outputPath: './target/debug/app',
        watchPaths: ['src/**/*.rs', 'Cargo.toml'],
      });
      break;
    case 'python':
      baseConfig.targets.push({
        name: 'test',
        type: 'test',
        enabled: true,
        testCommand: 'python -m pytest',
        watchPaths: ['**/*.py', 'requirements.txt'],
      });
      break;
    case 'swift':
      baseConfig.targets.push({
        name: 'debug',
        type: 'executable',
        enabled: true,
        buildCommand: 'swift build',
        outputPath: '.build/debug/App',
        watchPaths: ['Sources/**/*.swift', 'Package.swift'],
      });
      break;
  }

  return baseConfig;
}
