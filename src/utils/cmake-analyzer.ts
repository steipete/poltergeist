// CMake project analyzer for auto-detection
import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { glob } from 'glob';
import { basename, dirname, join, relative } from 'path';
import type {
  CMakeCustomTarget,
  CMakeExecutableTarget,
  CMakeLibraryTarget,
  Target,
} from '../types.js';

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
}

export class CMakeProjectAnalyzer {
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  async analyzeProject(): Promise<CMakeAnalysis> {
    const hasCMakeLists = existsSync(join(this.projectRoot, 'CMakeLists.txt'));
    if (!hasCMakeLists) {
      throw new Error('No CMakeLists.txt found in project root');
    }

    // Parse CMakeLists.txt files
    const parsedTargets = await this.parseCMakeFiles();

    // Try to query build system if configured
    let buildSystemTargets: CMakeTarget[] = [];
    let generator: string | undefined;
    let buildDirectory: string | undefined;

    try {
      const buildInfo = await this.queryBuildSystem();
      buildSystemTargets = buildInfo.targets;
      generator = buildInfo.generator;
      buildDirectory = buildInfo.buildDirectory;
    } catch (error) {
      console.warn('Could not query build system, using parsed targets only');
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
    };
  }

  private async parseCMakeFiles(): Promise<CMakeTarget[]> {
    const targets: CMakeTarget[] = [];
    const cmakeFiles = await glob(['CMakeLists.txt', '**/CMakeLists.txt'], {
      cwd: this.projectRoot,
      ignore: ['build/**', '_build/**', 'out/**', '**/CMakeFiles/**'],
    });

    for (const file of cmakeFiles) {
      const content = readFileSync(join(this.projectRoot, file), 'utf-8');
      const filePath = join(this.projectRoot, file);
      const fileDir = dirname(filePath);

      // Parse add_executable
      const execMatches = content.matchAll(
        /add_executable\s*\(\s*([\w-]+)(?:\s+WIN32)?(?:\s+MACOSX_BUNDLE)?(?:\s+([^)]+))?\s*\)/gm
      );
      for (const match of execMatches) {
        const name = match[1];
        const sources = match[2] ? this.parseSourceList(match[2], fileDir) : [];
        targets.push({
          name,
          type: 'executable',
          sourceFiles: sources,
          dependencies: [],
          includeDirectories: [],
        });
      }

      // Parse add_library
      const libMatches = content.matchAll(
        /add_library\s*\(\s*([\w-]+)(?:\s+(STATIC|SHARED|MODULE|INTERFACE|OBJECT))?(?:\s+([^)]+))?\s*\)/gm
      );
      for (const match of libMatches) {
        const name = match[1];
        const libType = match[2] || 'STATIC';
        const sources =
          libType !== 'INTERFACE' && match[3] ? this.parseSourceList(match[3], fileDir) : [];

        targets.push({
          name,
          type: libType === 'SHARED' ? 'shared_library' : 'static_library',
          sourceFiles: sources,
          dependencies: [],
          includeDirectories: [],
        });
      }

      // Parse add_custom_target
      const customMatches = content.matchAll(/add_custom_target\s*\(\s*([\w-]+)/gm);
      for (const match of customMatches) {
        targets.push({
          name: match[1],
          type: 'custom',
          sourceFiles: [],
          dependencies: [],
          includeDirectories: [],
        });
      }
    }

    return targets;
  }

  private parseSourceList(sourceString: string, baseDir: string): string[] {
    // Clean up the source string
    const cleaned = sourceString
      .replace(/\s+/g, ' ')
      .replace(/^\s+|\s+$/g, '')
      .replace(/\$\{[^}]+\}/g, '') // Remove variables for now
      .trim();

    if (!cleaned) return [];

    // Split by whitespace, handling quoted paths
    const sources = cleaned.match(/("[^"]+"|[^\s]+)/g) || [];

    return sources
      .map((s) => s.replace(/^"|"$/g, ''))
      .filter((s) => s && !s.startsWith('$'))
      .map((s) => {
        // Make relative paths absolute based on CMakeLists.txt location
        if (!s.startsWith('/') && !s.includes('${')) {
          return relative(this.projectRoot, join(baseDir, s));
        }
        return s;
      })
      .filter((s) => s.match(/\.(c|cpp|cxx|cc|h|hpp|hxx)$/i));
  }

  private async queryBuildSystem(): Promise<{
    targets: CMakeTarget[];
    generator?: string;
    buildDirectory: string;
  }> {
    // Try common build directories
    const buildDirs = ['build', '_build', 'cmake-build-debug', 'cmake-build-release', 'out'];
    let buildDir: string | undefined;

    for (const dir of buildDirs) {
      const fullPath = join(this.projectRoot, dir);
      if (existsSync(join(fullPath, 'CMakeCache.txt'))) {
        buildDir = dir;
        break;
      }
    }

    if (!buildDir) {
      // Configure if no build directory exists
      buildDir = 'build';
      await this.configureCMake(buildDir);
    }

    const buildPath = join(this.projectRoot, buildDir);

    // Parse CMakeCache.txt for generator info
    const generator = this.parseGeneratorFromCache(buildPath);

    // Query targets
    try {
      const { stdout } = this.execCommand(`cmake --build ${buildDir} --target help`, {
        cwd: this.projectRoot,
      });

      const targets = this.parseTargetList(stdout);
      return { targets, generator, buildDirectory: buildDir };
    } catch (error) {
      // Fallback: try to list targets from Makefile or build.ninja
      const targets = await this.parseTargetsFromBuildFiles(buildPath);
      return { targets, generator, buildDirectory: buildDir };
    }
  }

  private async configureCMake(buildDir: string): Promise<void> {
    const generator = this.selectOptimalGenerator();
    const args = ['-B', buildDir, '-S', '.'];

    if (generator) {
      args.push('-G', generator);
    }

    try {
      this.execCommand(`cmake ${args.join(' ')}`, { cwd: this.projectRoot });
    } catch (error) {
      console.warn('Failed to configure CMake project:', error);
    }
  }

  private selectOptimalGenerator(): string | undefined {
    // Check for available generators
    if (this.hasCommand('ninja')) return 'Ninja';
    if (process.platform === 'win32') return 'Visual Studio 17 2022';
    if (process.platform === 'darwin' && this.hasCommand('xcodebuild')) return 'Xcode';
    return 'Unix Makefiles';
  }

  private hasCommand(command: string): boolean {
    try {
      execSync(`which ${command}`, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  private parseGeneratorFromCache(buildPath: string): string | undefined {
    const cacheFile = join(buildPath, 'CMakeCache.txt');
    if (!existsSync(cacheFile)) return undefined;

    const content = readFileSync(cacheFile, 'utf-8');
    const match = content.match(/CMAKE_GENERATOR:INTERNAL=(.+)/);
    return match ? match[1] : undefined;
  }

  private parseTargetList(output: string): CMakeTarget[] {
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
          // Basic target detection from help output
          targets.push({
            name: targetName,
            type: 'custom', // Will be refined later
            sourceFiles: [],
            dependencies: [],
            includeDirectories: [],
          });
        }
      }
    }

    return targets;
  }

  private async parseTargetsFromBuildFiles(buildPath: string): Promise<CMakeTarget[]> {
    const targets: CMakeTarget[] = [];

    // Try to parse build.ninja
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

      matches.forEach((dir) => dirs.add(dir));
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
    return this.optimizeWatchPatterns(unique);
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

  private generateTargetWatchPatterns(target: CMakeTarget, analysis: CMakeAnalysis): string[] {
    const patterns: string[] = ['**/CMakeLists.txt'];

    // Add source files for this target
    if (target.sourceFiles.length > 0) {
      const dirs = new Set(target.sourceFiles.map((f) => dirname(f)).filter((d) => d !== '.'));
      dirs.forEach((dir) => {
        patterns.push(`${dir}/**/*.{c,cpp,cxx,cc,h,hpp,hxx}`);
      });
    } else {
      // Fallback to general patterns
      patterns.push(...this.generateWatchPatterns(analysis));
    }

    // Optimize patterns using brace expansion
    const optimized = this.optimizeWatchPatterns([...new Set(patterns)]);
    return optimized;
  }

  /**
   * Optimize watch patterns by consolidating paths using brace expansion
   * Example: ["foo/bar/**/*.c", "foo/baz/**/*.c"] => ["foo/{bar,baz}/**/*.c"]
   */
  private optimizeWatchPatterns(patterns: string[]): string[] {
    // First pass: group patterns by their structure
    const groups = new Map<string, string[]>();
    const standalone: string[] = [];
    
    patterns.forEach((pattern) => {
      // Skip patterns that already use brace expansion
      if (pattern.includes('{')) {
        standalone.push(pattern);
        return;
      }
      
      // Try to find the common prefix and suffix
      const parts = pattern.split('/');
      let found = false;
      
      // Look for patterns with the same structure but different directory names
      for (let i = 1; i < parts.length - 1; i++) {
        const prefix = parts.slice(0, i).join('/');
        const suffix = parts.slice(i + 1).join('/');
        const key = `${prefix}|${suffix}`;
        
        // Check if this creates a meaningful group
        if (suffix.includes('**') || suffix.includes('*')) {
          if (!groups.has(key)) {
            groups.set(key, []);
          }
          groups.get(key)!.push(parts[i]);
          found = true;
          break;
        }
      }
      
      if (!found) {
        standalone.push(pattern);
      }
    });
    
    // Second pass: build optimized patterns
    const optimized: string[] = [];
    
    // Add standalone patterns
    optimized.push(...standalone);
    
    // Add grouped patterns
    groups.forEach((dirs, key) => {
      if (dirs.length === 1) {
        // Only one directory, reconstruct the original
        const [prefix, suffix] = key.split('|');
        optimized.push(`${prefix}/${dirs[0]}/${suffix}`);
      } else {
        // Multiple directories, use brace expansion
        const [prefix, suffix] = key.split('|');
        const uniqueDirs = [...new Set(dirs)].sort();
        optimized.push(`${prefix}/{${uniqueDirs.join(',')}}/${suffix}`);
      }
    });
    
    // Remove duplicates that might have been covered by parent patterns
    const filtered = optimized.filter((pattern, index) => {
      // Check if this pattern is redundant
      for (let i = 0; i < optimized.length; i++) {
        if (i !== index && this.isPatternRedundant(pattern, optimized[i])) {
          return false;
        }
      }
      return true;
    });
    
    return filtered.sort();
  }
  
  /**
   * Check if pattern1 is redundant given pattern2 exists
   */
  private isPatternRedundant(pattern1: string, pattern2: string): boolean {
    // If pattern2 already covers pattern1's directory at a higher level
    if (pattern2.includes('/**/*') && pattern1.includes('/**/*')) {
      const base1 = pattern1.substring(0, pattern1.indexOf('/**/*'));
      const base2 = pattern2.substring(0, pattern2.indexOf('/**/*'));
      
      // If pattern1 is a subdirectory of pattern2
      if (base1.startsWith(base2 + '/')) {
        return true;
      }
    }
    return false;
  }

  private execCommand(command: string, options: { cwd: string }): { stdout: string } {
    try {
      const stdout = execSync(command, {
        ...options,
        encoding: 'utf-8',
        stdio: 'pipe',
      });
      return { stdout };
    } catch (error: unknown) {
      throw new Error(
        `Command failed: ${command}\n${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
