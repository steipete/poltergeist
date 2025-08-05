// Poltergeist v1.0 - Smart Watchman configuration with project detection

import { promises as fs } from 'fs';
import path from 'path';
import type { Logger } from './logger.js';
import type { PerformanceProfile, PoltergeistConfig, ProjectType } from './types.js';

/**
 * Project-specific exclusion sets optimized for each ecosystem
 */
export const PROJECT_TYPE_EXCLUSIONS = {
  swift: [
    // Swift Package Manager
    '.build',
    '**/.build/**',
    'Package.resolved',
    // Xcode
    'DerivedData',
    '**/DerivedData/**',
    '*.xcworkspace/xcuserdata',
    '*.xcodeproj/xcuserdata',
    '*.xcworkspace/xcshareddata/xcschemes',
    '*.xcodeproj/project.xcworkspace/xcuserdata',
    // Build artifacts
    '*.dSYM',
    '*.framework',
    '*.app',
    '*.ipa',
    // Swift-specific
    '*.swiftmodule',
    '*.swiftdoc',
    '*.swiftsourceinfo',
  ],

  node: [
    // Dependencies
    'node_modules',
    '**/node_modules/**',
    // Build outputs
    'dist',
    'build',
    'out',
    '.next',
    '.nuxt',
    'coverage',
    // Cache and temp
    '.cache',
    '.parcel-cache',
    '.nyc_output',
    'lib-cov',
    // Logs
    '*.log',
    'logs',
    'npm-debug.log*',
    'yarn-debug.log*',
    'yarn-error.log*',
    // Package managers
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
  ],

  rust: [
    // Cargo
    'target',
    '**/target/**',
    'Cargo.lock',
    // Build artifacts
    '*.rlib',
    '*.rmeta',
    '*.crate',
    // IDE
    '*.rs.bk',
  ],

  python: [
    // Python bytecode
    '__pycache__',
    '**/__pycache__/**',
    '*.pyc',
    '*.pyo',
    '*.pyd',
    // Virtual environments
    'venv',
    'env',
    '.venv',
    '.env',
    // Testing and coverage
    '.pytest_cache',
    '.coverage',
    'htmlcov',
    '.tox',
    // Type checking and linting
    '.mypy_cache',
    '.ruff_cache',
    '.pylint.d',
    // Distribution
    '*.egg-info',
    'dist',
    'build',
  ],

  cmake: [
    // Build directories
    'build',
    '_build',
    'out',
    'cmake-build-*',
    '**/CMakeFiles/**',
    // CMake generated files
    'CMakeCache.txt',
    '**/CMakeCache.txt',
    'cmake_install.cmake',
    '**/cmake_install.cmake',
    'Makefile',
    '**/Makefile',
    // Build artifacts
    '*.a',
    '*.so',
    '*.dylib',
    '*.dll',
    '*.lib',
    '*.exe',
    // IDE specific
    '.cmake',
    '**/.cmake/**',
    // CMake package directories
    '_deps',
    '**/_deps/**',
    // Testing directories
    'Testing',
    '**/Testing/**',
    // CPack generated
    '_CPack_Packages',
    '**/_CPack_Packages/**',
  ],

  mixed: [], // Will be populated by combining all types
} as const;

/**
 * Universal exclusions that apply to all project types
 */
export const UNIVERSAL_EXCLUSIONS = [
  // Version control
  '.git',
  '.svn',
  '.hg',
  '.bzr',
  // OS files
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini',
  // IDE and editors
  '.vscode',
  '.idea',
  '.cursor',
  '.vs',
  '*.swp',
  '*.swo',
  // Temporary files
  'tmp',
  'temp',
  '.tmp',
  '*.tmp',
  '*.temp',
  // Archives
  '*.zip',
  '*.tar',
  '*.gz',
  '*.rar',
  '*.7z',
] as const;

// Mixed project exclusions combining all types
const MIXED_EXCLUSIONS = [
  ...PROJECT_TYPE_EXCLUSIONS.swift,
  ...PROJECT_TYPE_EXCLUSIONS.node,
  ...PROJECT_TYPE_EXCLUSIONS.rust,
  ...PROJECT_TYPE_EXCLUSIONS.python,
  ...PROJECT_TYPE_EXCLUSIONS.cmake,
];

// Create extended exclusions object with mixed type
const EXTENDED_PROJECT_EXCLUSIONS = {
  ...PROJECT_TYPE_EXCLUSIONS,
  mixed: MIXED_EXCLUSIONS,
};

/**
 * Performance profiles with different exclusion strategies
 */
export const PERFORMANCE_PROFILES = {
  conservative: {
    description: 'Minimal exclusions, maximum file coverage',
    excludeOnlyEssential: true,
    maxExclusions: 20,
  },
  balanced: {
    description: 'Good balance of performance and coverage',
    excludeOnlyEssential: false,
    maxExclusions: 50,
  },
  aggressive: {
    description: 'Maximum performance, minimal file coverage',
    excludeOnlyEssential: false,
    maxExclusions: 100,
  },
} as const;

/**
 * Configuration error with helpful suggestions
 */
export class ConfigurationError extends Error {
  constructor(
    message: string,
    public readonly suggestion?: string,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

/**
 * Smart Watchman configuration manager - v1.0
 * Clean, modern, opinionated design for optimal performance
 */
export class WatchmanConfigManager {
  private projectRoot: string;
  private logger: Logger;
  private configPath: string;

  constructor(projectRoot: string, logger: Logger) {
    this.projectRoot = projectRoot;
    this.logger = logger;
    this.configPath = path.join(projectRoot, '.watchmanconfig');
  }

  /**
   * Detect project type based on files in project root
   */
  async detectProjectType(): Promise<ProjectType> {
    try {
      const files = await fs.readdir(this.projectRoot);
      const fileSet = new Set(files);

      // Check for Xcode projects first (highest priority for macOS/iOS development)
      const hasXcodeProject = files.some(f => f.endsWith('.xcodeproj') || f.endsWith('.xcworkspace'));
      if (hasXcodeProject) {
        this.logger.debug('Detected Xcode project (.xcodeproj/.xcworkspace found)');
        return 'swift';
      }

      // Check for definitive indicators in order of specificity
      if (fileSet.has('Package.swift')) {
        this.logger.debug('Detected Swift project (Package.swift found)');
        return 'swift';
      }

      if (fileSet.has('Cargo.toml')) {
        this.logger.debug('Detected Rust project (Cargo.toml found)');
        return 'rust';
      }

      if (fileSet.has('package.json')) {
        this.logger.debug('Detected Node.js project (package.json found)');
        return 'node';
      }

      if (
        fileSet.has('pyproject.toml') ||
        fileSet.has('requirements.txt') ||
        fileSet.has('setup.py')
      ) {
        this.logger.debug('Detected Python project (Python config files found)');
        return 'python';
      }

      if (fileSet.has('CMakeLists.txt')) {
        this.logger.debug('Detected CMake project (CMakeLists.txt found)');
        return 'cmake';
      }

      // Check for multiple project types
      const indicators = [
        hasXcodeProject || fileSet.has('Package.swift') ? 'swift' : null,
        fileSet.has('package.json') ? 'node' : null,
        fileSet.has('Cargo.toml') ? 'rust' : null,
        fileSet.has('pyproject.toml') || fileSet.has('requirements.txt') ? 'python' : null,
        fileSet.has('CMakeLists.txt') ? 'cmake' : null,
      ].filter(Boolean);

      if (indicators.length > 1) {
        this.logger.info(
          `Multiple project types detected: ${indicators.join(', ')}. Using 'mixed' type.`
        );
        return 'mixed';
      }

      this.logger.warn('Could not detect project type. Defaulting to mixed.');
      return 'mixed';
    } catch (error) {
      this.logger.error(`Error detecting project type: ${error}`);
      return 'mixed';
    }
  }

  /**
   * Generates optimized exclusion list based on project type and performance profile.
   * Combines universal patterns, project-specific patterns, and custom exclusions.
   * Applies performance limits and deduplication for optimal Watchman performance.
   */
  getOptimizedExclusions(
    projectType: ProjectType,
    profile: PerformanceProfile = 'balanced',
    customExclusions: string[] = []
  ): string[] {
    const universal = [...UNIVERSAL_EXCLUSIONS];
    const projectSpecific = [...EXTENDED_PROJECT_EXCLUSIONS[projectType]];
    const profileConfig = PERFORMANCE_PROFILES[profile];

    let exclusions = [...universal, ...projectSpecific, ...customExclusions];

    // Performance optimization: filter exclusions based on profile strategy
    if (profileConfig.excludeOnlyEssential) {
      // Conservative profile: keep only essential exclusions to maximize coverage
      exclusions = exclusions.filter(
        (pattern) =>
          pattern.includes('.git') ||
          pattern.includes('node_modules') ||
          pattern.includes('.build') ||
          pattern.includes('DerivedData')
      );
    }

    // Enforce maximum exclusions limit for Watchman performance
    if (exclusions.length > profileConfig.maxExclusions) {
      this.logger.warn(
        `Exclusion count (${exclusions.length}) exceeds profile limit (${profileConfig.maxExclusions}). ` +
          `Keeping most critical exclusions.`
      );
      exclusions = exclusions.slice(0, profileConfig.maxExclusions);
    }

    // Remove duplicates and sort for consistency
    exclusions = [...new Set(exclusions)].sort();

    this.logger.info(
      `Generated ${exclusions.length} exclusions for ${projectType} project with ${profile} profile`
    );

    return exclusions;
  }

  /**
   * Validate watch patterns with strict checking
   */
  /**
   * Normalize a watch pattern to be more lenient and user-friendly
   */
  normalizeWatchPattern(pattern: string): string {
    if (!pattern || typeof pattern !== 'string') {
      throw new ConfigurationError(
        'Watch pattern must be a non-empty string',
        'Use glob patterns like "**/*.swift" or "src/**/*.ts"',
        'INVALID_PATTERN'
      );
    }

    let normalized = pattern;

    // Auto-fix common patterns
    // Convert *.ext to **/*.ext for recursive matching (but not **/*.ext)
    if (/^\*\.[a-zA-Z0-9]+$/.test(pattern)) {
      normalized = `**/${pattern}`;
      this.logger.debug(
        `Normalized pattern "${pattern}" to "${normalized}" for recursive matching`
      );
    }
    // Convert ./*.ext to **/*.ext for better matching
    else if (/^\.\/\*\.[a-zA-Z0-9]+$/.test(pattern)) {
      normalized = `**/*${pattern.substring(3)}`;
      this.logger.debug(
        `Normalized pattern "${pattern}" to "${normalized}" for recursive matching`
      );
    }
    // Convert somedir/*.ext to somedir/**/*.ext (but not patterns already containing **)
    else if (/^[^/]+\/\*\.[a-zA-Z0-9]+$/.test(pattern) && !pattern.includes('**')) {
      const parts = pattern.split('/');
      normalized = `${parts[0]}/**/${parts[1]}`;
      this.logger.debug(
        `Normalized pattern "${pattern}" to "${normalized}" for recursive matching`
      );
    }
    // Remove trailing slash
    else if (pattern.endsWith('/')) {
      normalized = `${pattern.slice(0, -1)}/**`;
      this.logger.debug(
        `Normalized pattern "${pattern}" to "${normalized}" (removed trailing slash)`
      );
    }

    return normalized;
  }

  validateWatchPattern(pattern: string): void {
    if (!pattern || typeof pattern !== 'string') {
      throw new ConfigurationError(
        'Watch pattern must be a non-empty string',
        'Use glob patterns like "**/*.swift" or "src/**/*.ts"',
        'INVALID_PATTERN'
      );
    }

    // After normalization, only check for truly problematic patterns
    const problematicPatterns = ['.git/**', 'node_modules/**', '.build/**'];
    if (problematicPatterns.some((p) => pattern.includes(p))) {
      this.logger.warn(
        `Pattern "${pattern}" includes commonly excluded directory. ` +
          `Consider if this is intentional.`
      );
    }
  }

  /**
   * Generate comprehensive Watchman configuration
   */
  async generateWatchmanConfig(config: PoltergeistConfig): Promise<Record<string, unknown>> {
    const projectType = config.projectType;
    const watchmanConfig = config.watchman || {
      useDefaultExclusions: true,
      excludeDirs: [],
      projectType: config.projectType,
      maxFileEvents: 10000,
      recrawlThreshold: 5,
      settlingDelay: 1000,
    };
    const performanceProfile = config.performance?.profile || 'balanced';

    // Get optimized exclusions
    const exclusions = this.getOptimizedExclusions(
      projectType,
      performanceProfile,
      watchmanConfig.excludeDirs
    );

    // Process exclusion rules if provided
    const ruleExclusions: string[] = [];
    if (watchmanConfig.rules) {
      for (const rule of watchmanConfig.rules) {
        if (rule.enabled !== false && rule.action === 'ignore') {
          ruleExclusions.push(rule.pattern);
        }
      }
    }

    const allExclusions = [...exclusions, ...ruleExclusions];

    // Advanced Watchman configuration
    const watchmanFileConfig = {
      ignore_dirs: allExclusions,
      ignore_vcs: ['.git', '.svn', '.hg', '.bzr'],

      // Performance tuning
      idle_reap_age_seconds: 300,
      gc_age_seconds: 259200, // 3 days
      gc_interval_seconds: 86400, // 1 day

      // Limits based on project size
      max_files: watchmanConfig.maxFileEvents,

      // Settling behavior
      settle: watchmanConfig.settlingDelay,

      // Project-specific optimizations
      ...(projectType === 'swift' && {
        // Swift-specific optimizations
        defer: ['*.xcodeproj/**', '*.xcworkspace/**'],
      }),

      ...(projectType === 'node' && {
        // Node-specific optimizations
        defer: ['package-lock.json', 'yarn.lock'],
      }),
    };

    return watchmanFileConfig;
  }

  /**
   * Strict configuration validation - fail fast
   */
  validateConfiguration(config: PoltergeistConfig): void {
    // Validate watch patterns
    for (const target of config.targets) {
      for (const pattern of target.watchPaths) {
        this.validateWatchPattern(pattern);
      }
    }

    // Validate exclusion rules
    if (config.watchman?.rules) {
      for (const rule of config.watchman.rules) {
        this.validateWatchPattern(rule.pattern);
      }
    }

    this.logger.debug('✅ Configuration validation passed');
  }

  /**
   * Write configuration with metadata and validation
   */
  async writeConfig(
    watchmanConfig: Record<string, unknown>,
    config: PoltergeistConfig
  ): Promise<void> {
    try {
      const configWithMetadata = {
        ...watchmanConfig,
        // Add metadata for debugging
        _metadata: {
          generated_by: 'poltergeist',
          project_type: config.projectType,
          performance_profile: config.performance?.profile || 'balanced',
          generated_at: new Date().toISOString(),
          total_exclusions: Array.isArray(watchmanConfig.ignore_dirs)
            ? watchmanConfig.ignore_dirs.length
            : 0,
        },
      };

      const content = JSON.stringify(configWithMetadata, null, 2);
      await fs.writeFile(this.configPath, content, 'utf-8');

      this.logger.info(
        `✅ Generated .watchmanconfig with ${Array.isArray(watchmanConfig.ignore_dirs) ? watchmanConfig.ignore_dirs.length : 0} exclusions ` +
          `(${config.projectType} project, ${config.performance?.profile || 'balanced'} profile)`
      );
    } catch (error) {
      this.logger.error(`Failed to write .watchmanconfig: ${error}`);
      throw new ConfigurationError(
        'Failed to write Watchman configuration',
        'Check file permissions and disk space',
        'WRITE_FAILED'
      );
    }
  }

  /**
   * Ensure configuration is up to date
   */
  async ensureConfigUpToDate(config: PoltergeistConfig): Promise<void> {
    // Strict validation first
    this.validateConfiguration(config);

    // Generate new config
    const watchmanConfig = await this.generateWatchmanConfig(config);

    // Always write fresh configuration
    await this.writeConfig(watchmanConfig, config);

    // Log optimization summary
    this.logOptimizationSummary(config, watchmanConfig);
  }

  /**
   * Create exclusion expressions for subscriptions
   */
  createExclusionExpressions(config: PoltergeistConfig): Array<[string, string[]]> {
    const exclusions = this.getOptimizedExclusions(
      config.projectType,
      config.performance?.profile || 'balanced',
      config.watchman?.excludeDirs || []
    );

    // Limit subscription exclusions to prevent overly complex expressions
    // Use only the most critical exclusions for subscriptions
    const subscriptionLimit = 20;
    const criticalExclusions = exclusions.slice(0, subscriptionLimit);

    if (exclusions.length > subscriptionLimit) {
      this.logger.info(
        `Limiting subscription exclusions to ${subscriptionLimit} most critical (total: ${exclusions.length})`
      );
    }

    // Convert exclusions to proper Watchman expressions
    return criticalExclusions.map((exclusion) => {
      // Handle different exclusion patterns properly
      let pattern = exclusion;

      // If exclusion already has wildcards, use as-is
      // Otherwise, treat as directory and add /**
      if (!pattern.includes('*') && !pattern.includes('/')) {
        pattern = `**/${pattern}/**`;
      } else if (pattern.startsWith('**/*.')) {
        // For patterns like **/*.log, use as-is
        pattern = exclusion;
      } else if (!pattern.includes('**')) {
        // Add ** prefix if missing
        pattern = `**/${exclusion}/**`;
      }

      return ['not', ['match', pattern, 'wholename']] as [string, string[]];
    });
  }

  /**
   * Comprehensive optimization summary
   */
  private logOptimizationSummary(
    config: PoltergeistConfig,
    watchmanConfig: Record<string, unknown>
  ): void {
    const profile = config.performance?.profile || 'balanced';
    const projectType = config.projectType;
    const totalExclusions = Array.isArray(watchmanConfig.ignore_dirs)
      ? watchmanConfig.ignore_dirs.length
      : 0;
    const customExclusions = config.watchman?.excludeDirs?.length || 0;
    const ruleExclusions = config.watchman?.rules?.filter((r) => r.enabled !== false).length || 0;

    this.logger.info('🎯 Watchman Optimization Summary:');
    this.logger.info(`  • Project Type: ${projectType}`);
    this.logger.info(`  • Performance Profile: ${profile}`);
    this.logger.info(`  • Total Exclusions: ${totalExclusions}`);
    this.logger.info(`  • Custom Exclusions: ${customExclusions}`);
    if (ruleExclusions > 0) {
      this.logger.info(`  • Rule-based Exclusions: ${ruleExclusions}`);
    }
    this.logger.info(`  • Max File Events: ${config.watchman?.maxFileEvents || 10000}`);
    this.logger.info(`  • Recrawl Threshold: ${config.watchman?.recrawlThreshold || 5}`);

    if (config.performance?.autoOptimize) {
      this.logger.info('  • Auto-optimization: Enabled');
    }
  }

  /**
   * Generate suggested optimizations based on project analysis
   */
  async suggestOptimizations(): Promise<string[]> {
    const suggestions: string[] = [];

    try {
      // Analyze project structure
      const dirs = await fs.readdir(this.projectRoot, { withFileTypes: true });
      const directories = dirs.filter((d) => d.isDirectory()).map((d) => d.name);

      // Look for common unexcluded directories that should be excluded
      const commonProblematic = ['coverage', 'tmp', 'logs', 'cache', 'artifacts', 'reports'];

      for (const dir of commonProblematic) {
        if (directories.includes(dir)) {
          suggestions.push(`Consider excluding "${dir}" directory for better performance`);
        }
      }

      // Check for large directories that might benefit from exclusion
      for (const dir of directories) {
        if (dir.startsWith('test_') || dir.startsWith('tmp_') || dir.includes('backup')) {
          suggestions.push(`Consider excluding "${dir}" (appears to be temporary/test directory)`);
        }
      }
    } catch (error) {
      this.logger.debug(`Could not analyze project structure: ${error}`);
    }

    return suggestions;
  }
}
