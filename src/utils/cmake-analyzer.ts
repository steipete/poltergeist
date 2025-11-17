// CMake project analyzer for auto-detection
import { existsSync, readFileSync } from 'fs';
import { glob } from 'glob';
import { dirname, join } from 'path';
import type {
  CMakeCustomTarget,
  CMakeExecutableTarget,
  CMakeLibraryTarget,
  Target,
} from '../types.js';
import { queryBuildSystem } from './cmake-build-query.js';
import { parseCMakeFiles } from './cmake-parser.js';
import { optimizeWatchPatterns } from './cmake-patterns.js';
import type { CommandRunner } from './command-runner.js';
import { ChildProcessRunner } from './command-runner.js';

export interface CMakeTarget {
  name: string;
  type: 'executable' | 'static_library' | 'shared_library' | 'custom';
  outputPath?: string;
  dependencies: string[];
  sourceFiles: string[];
  includeDirectories: string[];
}

export interface CMakePreset {
  name: string;
  displayName?: string;
  generator?: string;
  binaryDir?: string;
  cacheVariables?: Record<string, string>;
}

export interface CMakeAnalysis {
  targets: CMakeTarget[];
  generator?: string;
  buildTypes: string[];
  presets?: CMakePreset[];
  sourceDirectories: string[];
  language: 'cpp' | 'c' | 'mixed';
  buildDirectory?: string;
  errors?: CMakeProbeError[];
}

export interface CMakeProbeError {
  stage: 'configure' | 'query-targets' | 'parse-cache' | 'detect-build-dir';
  message: string;
  details?: string;
}

export class CMakeProjectAnalyzer {
  private projectRoot: string;
  private commandRunner: CommandRunner;
  private readonly parseCMake: typeof parseCMakeFiles;
  private readonly buildQuery: typeof queryBuildSystem;

  constructor(
    projectRoot: string,
    commandRunner: CommandRunner = new ChildProcessRunner(),
    deps: {
      parseCMakeFiles?: typeof parseCMakeFiles;
      queryBuildSystem?: typeof queryBuildSystem;
    } = {}
  ) {
    this.projectRoot = projectRoot;
    this.commandRunner = commandRunner;
    this.parseCMake = deps.parseCMakeFiles ?? parseCMakeFiles;
    this.buildQuery = deps.queryBuildSystem ?? queryBuildSystem;
  }

  async analyzeProject(options: { autoConfigure?: boolean } = {}): Promise<CMakeAnalysis> {
    const autoConfigure = options.autoConfigure ?? true;
    const hasCMakeLists = existsSync(join(this.projectRoot, 'CMakeLists.txt'));
    if (!hasCMakeLists) {
      throw new Error('No CMakeLists.txt found in project root');
    }

    // Parse CMakeLists.txt files
    const parsedTargets = await this.parseCMake(this.projectRoot);

    // Try to query build system if configured
    let buildSystemTargets: CMakeTarget[] = [];
    let generator: string | undefined;
    let buildDirectory: string | undefined;
    const errors: CMakeProbeError[] = [];

    try {
      const buildInfo = await this.buildQuery(this.projectRoot, this.commandRunner, autoConfigure);
      buildSystemTargets = buildInfo.targets;
      generator = buildInfo.generator;
      buildDirectory = buildInfo.buildDirectory;
      errors.push(...(buildInfo.errors ?? []));
    } catch (error) {
      errors.push({
        stage: 'query-targets',
        message: 'Could not query build system; falling back to parsed targets',
        details: error instanceof Error ? error.message : String(error),
      });
    }

    // Merge targets, preferring build system info
    const targets = this.mergeTargets(parsedTargets, buildSystemTargets);

    // Detect project language
    const language = await this.detectLanguage();

    // Parse presets if available
    const presets = await this.parsePresets();

    // Find source directories
    const sourceDirectories = await this.findSourceDirectories();

    return {
      targets,
      generator,
      buildTypes: ['Debug', 'Release', 'RelWithDebInfo', 'MinSizeRel'],
      presets,
      sourceDirectories,
      language,
      buildDirectory,
      errors: errors.length > 0 ? errors : undefined,
    };
  }
  private mergeTargets(parsed: CMakeTarget[], buildSystem: CMakeTarget[]): CMakeTarget[] {
    const merged = new Map<string, CMakeTarget>();

    // Start with parsed targets
    for (const target of parsed) {
      merged.set(target.name, target);
    }

    // Override with build system info if available
    for (const target of buildSystem) {
      const existing = merged.get(target.name);
      if (existing) {
        // Merge, preferring build system info
        merged.set(target.name, {
          ...existing,
          ...target,
          sourceFiles: target.sourceFiles.length > 0 ? target.sourceFiles : existing.sourceFiles,
        });
      } else {
        merged.set(target.name, target);
      }
    }

    return Array.from(merged.values());
  }

  private async detectLanguage(): Promise<'cpp' | 'c' | 'mixed'> {
    const sourceFiles = await glob('**/*.{c,cpp,cxx,cc,h,hpp,hxx}', {
      cwd: this.projectRoot,
      ignore: ['build/**', '_build/**', 'out/**', '**/CMakeFiles/**'],
    });

    let hasC = false;
    let hasCpp = false;

    for (const file of sourceFiles) {
      if (file.match(/\.(c|h)$/i)) hasC = true;
      if (file.match(/\.(cpp|cxx|cc|hpp|hxx)$/i)) hasCpp = true;
      if (hasC && hasCpp) return 'mixed';
    }

    return hasCpp ? 'cpp' : 'c';
  }

  private async parsePresets(): Promise<CMakePreset[]> {
    const presetsFile = join(this.projectRoot, 'CMakePresets.json');
    if (!existsSync(presetsFile)) return [];

    try {
      const content = readFileSync(presetsFile, 'utf-8');
      const json = JSON.parse(content);

      return (json.configurePresets || []).map((preset: Record<string, unknown>) => ({
        name: preset.name,
        displayName: preset.displayName,
        generator: preset.generator,
        binaryDir: preset.binaryDir,
        cacheVariables: preset.cacheVariables,
      }));
    } catch (error) {
      console.warn('Failed to parse CMakePresets.json:', error);
      return [];
    }
  }

  private async findSourceDirectories(): Promise<string[]> {
    const dirs = new Set<string>();

    const sourcePatterns = ['src', 'source', 'lib', 'include', 'Sources'];
    for (const pattern of sourcePatterns) {
      const matches = await glob(`**/${pattern}`, {
        cwd: this.projectRoot,
        ignore: ['build/**', '_build/**', 'out/**'],
      });

      matches.forEach((dir) => {
        dirs.add(dir);
      });
    }

    // Also find directories containing source files
    const sourceFiles = await glob('**/*.{c,cpp,cxx,cc,h,hpp,hxx}', {
      cwd: this.projectRoot,
      ignore: ['build/**', '_build/**', 'out/**', '**/CMakeFiles/**'],
    });

    sourceFiles.forEach((file) => {
      const dir = dirname(file);
      if (dir !== '.') dirs.add(dir);
    });

    return Array.from(dirs).sort();
  }

  generateWatchPatterns(analysis: CMakeAnalysis): string[] {
    const patterns: string[] = ['**/CMakeLists.txt', 'cmake/**/*.cmake'];

    // Add presets if they exist
    if (analysis.presets && analysis.presets.length > 0) {
      patterns.push('CMakePresets.json');
      patterns.push('CMakeUserPresets.json');
    }

    // Add source patterns based on language
    if (analysis.language === 'cpp' || analysis.language === 'mixed') {
      patterns.push('**/*.{cpp,cxx,cc,hpp,h,hxx}');
    }
    if (analysis.language === 'c' || analysis.language === 'mixed') {
      patterns.push('**/*.{c,h}');
    }

    // Add specific directories if found
    for (const dir of analysis.sourceDirectories) {
      const ext =
        analysis.language === 'c'
          ? '{c,h}'
          : analysis.language === 'cpp'
            ? '{cpp,cxx,cc,hpp,h,hxx}'
            : '{c,cpp,cxx,cc,h,hpp,hxx}';
      patterns.push(`${dir}/**/*.${ext}`);
    }

    // Remove duplicates and optimize
    const unique = [...new Set(patterns)];
    return optimizeWatchPatterns(unique);
  }

  generatePoltergeistTargets(analysis: CMakeAnalysis): Target[] {
    return analysis.targets.map((target) => {
      const baseConfig = {
        name: target.name,
        watchPaths: this.generateTargetWatchPatterns(target, analysis),
        settlingDelay: 1000,
      };

      if (target.type === 'executable') {
        const config: CMakeExecutableTarget = {
          ...baseConfig,
          type: 'cmake-executable',
          targetName: target.name,
          outputPath: target.outputPath,
          generator: analysis.generator,
          buildType: 'Debug',
          parallel: true,
        };
        return config;
      } else if (target.type === 'static_library' || target.type === 'shared_library') {
        const config: CMakeLibraryTarget = {
          ...baseConfig,
          type: 'cmake-library',
          targetName: target.name,
          libraryType: target.type === 'shared_library' ? 'shared' : 'static',
          outputPath: target.outputPath,
          generator: analysis.generator,
          buildType: 'Debug',
          parallel: true,
        };
        return config;
      } else {
        const config: CMakeCustomTarget = {
          ...baseConfig,
          type: 'cmake-custom',
          targetName: target.name,
          generator: analysis.generator,
          buildType: 'Debug',
          parallel: true,
        };
        return config;
      }
    });
  }

  generateTargetWatchPatterns(target: CMakeTarget, analysis: CMakeAnalysis): string[] {
    const patterns: string[] = ['**/CMakeLists.txt'];

    // Add source files for this target
    if (target.sourceFiles.length > 0) {
      const dirs = new Set(target.sourceFiles.map((f) => dirname(f)).filter((d) => d !== '.'));
      dirs.forEach((dir) => {
        patterns.push(`${dir}/**/*.{c,cpp,cxx,cc,h,hpp,hxx}`);
      });
    } else {
      // Fallback to general patterns with all C/C++ extensions
      patterns.push('**/CMakeLists.txt');
      patterns.push('cmake/**/*.cmake');
      patterns.push('**/*.{c,cpp,cxx,cc,h,hpp,hxx}');

      // Add specific source directories
      for (const dir of analysis.sourceDirectories) {
        patterns.push(`${dir}/**/*.{c,cpp,cxx,cc,h,hpp,hxx}`);
      }
    }
    // Optimize patterns using brace expansion
    const optimized = optimizeWatchPatterns([...new Set(patterns)]);
    return optimized;
  }
}

// Export alias for compatibility with tests
export { CMakeProjectAnalyzer as CMakeAnalyzer };
