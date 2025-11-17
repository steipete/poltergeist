import { existsSync, readFileSync } from 'fs';
import { basename, join } from 'path';
import type { CMakeProbeError, CMakeTarget } from './cmake-analyzer.js';
import type { CommandRunner } from './command-runner.js';

export interface BuildQueryResult {
  targets: CMakeTarget[];
  generator?: string;
  buildDirectory: string;
  errors: CMakeProbeError[];
}

export async function queryBuildSystem(
  projectRoot: string,
  runner: CommandRunner,
  autoConfigure: boolean
): Promise<BuildQueryResult> {
  const errors: CMakeProbeError[] = [];

  const buildDirs = ['build', '_build', 'cmake-build-debug', 'cmake-build-release', 'out'];
  let buildDir: string | undefined;

  for (const dir of buildDirs) {
    const fullPath = join(projectRoot, dir);
    if (existsSync(join(fullPath, 'CMakeCache.txt'))) {
      buildDir = dir;
      break;
    }
  }

  if (!buildDir) {
    if (!autoConfigure) {
      throw new Error('No build directory found and autoConfigure disabled');
    }
    buildDir = 'build';
    try {
      await runner.run('cmake', ['-B', buildDir, '-S', '.'], { cwd: projectRoot });
    } catch (error) {
      errors.push({
        stage: 'configure',
        message: 'Failed to configure CMake project',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const buildPath = join(projectRoot, buildDir);
  const generator = parseGeneratorFromCache(buildPath);

  try {
    const { stdout } = await runner.run('cmake', ['--build', buildDir, '--target', 'help'], {
      cwd: projectRoot,
      allowNonZeroExit: true,
    });
    const targets = parseTargetList(stdout);
    return { targets, generator, buildDirectory: buildDir, errors };
  } catch (error) {
    errors.push({
      stage: 'query-targets',
      message: 'Failed to list targets via CMake',
      details: error instanceof Error ? error.message : String(error),
    });
    const targets = await parseTargetsFromBuildFiles(buildPath);
    return { targets, generator, buildDirectory: buildDir, errors };
  }
}

function parseGeneratorFromCache(buildPath: string): string | undefined {
  const cacheFile = join(buildPath, 'CMakeCache.txt');
  if (!existsSync(cacheFile)) return undefined;

  const content = readFileSync(cacheFile, 'utf-8');
  const match = content.match(/CMAKE_GENERATOR:INTERNAL=(.+)/);
  return match ? match[1] : undefined;
}

function parseTargetList(output: string): CMakeTarget[] {
  const targets: CMakeTarget[] = [];
  const lines = output.split('\n');
  let inTargetSection = false;

  for (const line of lines) {
    if (line.includes('The following are some of the valid targets')) {
      inTargetSection = true;
      continue;
    }

    if (inTargetSection && line.startsWith('... ')) {
      const targetName = line.substring(4).trim();
      if (targetName && !targetName.includes('/')) {
        targets.push({
          name: targetName,
          type: 'custom',
          sourceFiles: [],
          dependencies: [],
          includeDirectories: [],
        });
      }
    }
  }

  return targets;
}

async function parseTargetsFromBuildFiles(buildPath: string): Promise<CMakeTarget[]> {
  const targets: CMakeTarget[] = [];
  const ninjaFile = join(buildPath, 'build.ninja');
  if (existsSync(ninjaFile)) {
    const content = readFileSync(ninjaFile, 'utf-8');
    const targetMatches = content.matchAll(
      /^build ([^:]+): (?:C|CXX)_(?:EXECUTABLE|STATIC_LIBRARY|SHARED_LIBRARY)_LINKER/gm
    );

    for (const match of targetMatches) {
      const outputPath = match[1].trim();
      const name = basename(outputPath).replace(/\.(exe|a|so|dylib|lib|dll)$/, '');
      const isLibrary = outputPath.match(/\.(a|so|dylib|lib|dll)$/);

      targets.push({
        name,
        type: isLibrary ? 'static_library' : 'executable',
        outputPath,
        sourceFiles: [],
        dependencies: [],
        includeDirectories: [],
      });
    }
  }

  return targets;
}
