// Poltergeist v1.0 - Clean, simple types
// Testing queue management and build deduplication
import { z } from 'zod';

/**
 * Supported target types for different build outputs:
 * - executable: CLI tools, binaries, standalone applications
 * - app-bundle: macOS/iOS/tvOS/watchOS apps with bundle structure
 * - library: Static or dynamic libraries
 * - framework: Apple frameworks for macOS/iOS platforms
 * - test: Test suites and testing targets
 * - docker: Container images and Docker builds
 * - custom: User-defined targets with custom build logic
 */
export type TargetType =
  | 'executable'
  | 'app-bundle'
  | 'library'
  | 'framework'
  | 'test'
  | 'docker'
  | 'custom'
  | 'npm'
  | 'cmake-executable'
  | 'cmake-library'
  | 'cmake-custom';

export type PostBuildRunCondition = 'success' | 'failure' | 'always';

export interface PostBuildCommandConfig {
  name: string;
  command: string;
  runOn?: PostBuildRunCondition | PostBuildRunCondition[];
  formatter?: string;
  timeoutSeconds?: number;
  env?: Record<string, string>;
  cwd?: string;
  maxLines?: number;
}

// Base target interface
export interface BaseTarget {
  name: string;
  type: TargetType;
  enabled?: boolean; // Defaults to true
  buildCommand?: string;
  watchPaths: string[];
  settlingDelay?: number;
  environment?: Record<string, string>;
  maxRetries?: number;
  backoffMultiplier?: number;
  debounceInterval?: number;
  icon?: string; // Path to icon file for notifications
  postBuild?: PostBuildCommandConfig[];
  logChannels?: string[];
  /** Optional logical group used for panel tree rendering. */
  group?: string;
}

// Executable target (CLI tools, binaries)
export interface ExecutableTarget extends BaseTarget {
  type: 'executable';
  buildCommand: string;
  outputPath: string;
  autoRun?: ExecutableAutoRunConfig;
}

export interface ExecutableAutoRunConfig {
  enabled?: boolean;
  command?: string;
  args?: string[];
  restartSignal?: string;
  restartDelayMs?: number;
  env?: Record<string, string>;
}

// App bundle target (macOS, iOS apps)
export interface AppBundleTarget extends BaseTarget {
  type: 'app-bundle';
  buildCommand: string;
  platform?: 'macos' | 'ios' | 'tvos' | 'watchos' | 'visionos';
  bundleId: string;
  autoRelaunch?: boolean;
  launchCommand?: string;
}

// Library target (static/dynamic libraries)
export interface LibraryTarget extends BaseTarget {
  type: 'library';
  buildCommand: string;
  outputPath: string;
  libraryType: 'static' | 'dynamic';
}

// Framework target (macOS/iOS frameworks)
export interface FrameworkTarget extends BaseTarget {
  type: 'framework';
  buildCommand: string;
  outputPath: string;
  platform?: 'macos' | 'ios' | 'tvos' | 'watchos' | 'visionos';
}

// Test target
export interface TestTarget extends BaseTarget {
  type: 'test';
  testCommand: string;
  coverageFile?: string;
}

// Docker target
export interface DockerTarget extends BaseTarget {
  type: 'docker';
  buildCommand: string;
  imageName: string;
  dockerfile?: string;
  context?: string;
  tags?: string[];
}

// Custom target (for extensibility)
export interface CustomTarget extends BaseTarget {
  type: 'custom';
  buildCommand: string;
  config?: Record<string, unknown>;
}

// NPM target (Node.js/TypeScript projects)
export interface NPMTarget extends BaseTarget {
  type: 'npm';
  buildScript?: string; // default: 'build'
  packageManager?: 'npm' | 'yarn' | 'pnpm' | 'bun' | 'auto'; // default: 'auto' (detect from lockfiles)
  outputPaths?: string[]; // required for validation
  installOnChange?: boolean; // default: true when package.json changes
}

// CMake-specific target types
export interface CMakeExecutableTarget extends BaseTarget {
  type: 'cmake-executable';
  generator?: string;
  buildType?: 'Debug' | 'Release' | 'RelWithDebInfo' | 'MinSizeRel';
  cmakeArgs?: string[];
  targetName: string; // CMake target name (may differ from Poltergeist name)
  outputPath?: string;
  parallel?: boolean;
}

export interface CMakeLibraryTarget extends BaseTarget {
  type: 'cmake-library';
  generator?: string;
  buildType?: 'Debug' | 'Release' | 'RelWithDebInfo' | 'MinSizeRel';
  cmakeArgs?: string[];
  targetName: string;
  libraryType: 'static' | 'shared';
  outputPath?: string;
  parallel?: boolean;
}

export interface CMakeCustomTarget extends BaseTarget {
  type: 'cmake-custom';
  generator?: string;
  buildType?: 'Debug' | 'Release' | 'RelWithDebInfo' | 'MinSizeRel';
  cmakeArgs?: string[];
  targetName: string;
  parallel?: boolean;
}

/**
 * Union type encompassing all supported target types.
 * Each target type has specific properties for its build requirements.
 * Used throughout the system for type-safe target handling.
 */
export type Target =
  | ExecutableTarget
  | AppBundleTarget
  | LibraryTarget
  | FrameworkTarget
  | TestTarget
  | DockerTarget
  | CustomTarget
  | NPMTarget
  | CMakeExecutableTarget
  | CMakeLibraryTarget
  | CMakeCustomTarget;

// Project types for smart defaults
export type ProjectType = 'swift' | 'node' | 'rust' | 'python' | 'cmake' | 'mixed';

// Performance profiles
export type PerformanceProfile = 'conservative' | 'balanced' | 'aggressive';

// Watchman exclusion rule
export interface ExclusionRule {
  pattern: string;
  action: 'ignore';
  reason: string;
  enabled?: boolean;
}

// Performance configuration
export interface PerformanceConfig {
  profile: PerformanceProfile;
  autoOptimize: boolean;
  metrics: {
    enabled: boolean;
    reportInterval: number;
  };
}

// Watchman configuration
export interface WatchmanConfig {
  useDefaultExclusions: boolean;
  excludeDirs: string[];
  projectType?: ProjectType;
  maxFileEvents: number;
  recrawlThreshold: number;
  settlingDelay: number;
  rules?: ExclusionRule[];
}

// File change classification
export type ChangeType = 'direct' | 'shared' | 'generated';

// File change event
export interface ChangeEvent {
  file: string;
  timestamp: number;
  affectedTargets: string[];
  changeType: ChangeType;
  impactWeight: number;
}

// Target priority information
export interface TargetPriority {
  target: string;
  score: number;
  lastDirectChange: number;
  directChangeFrequency: number;
  focusMultiplier: number;
  avgBuildTime: number;
  successRate: number;
  recentChanges: ChangeEvent[];
}

// Build request with priority
export interface BuildRequest {
  target: Target;
  priority: number;
  timestamp: number;
  triggeringFiles: string[];
  id: string;
}

/**
 * Configuration for intelligent build scheduling and prioritization.
 * Controls how builds are queued, prioritized, and executed concurrently.
 */
export interface BuildSchedulingConfig {
  /** Number of concurrent builds (1-10, default: 2) */
  parallelization: number;
  prioritization: {
    /** Enable intelligent priority scoring */
    enabled: boolean;
    /** Time window for focus detection in ms (default: 300000 = 5min) */
    focusDetectionWindow: number;
    /** Priority score decay period in ms (default: 1800000 = 30min) */
    priorityDecayTime: number;
    /** Timeout scaling factor for build timeouts (default: 2.0) */
    buildTimeoutMultiplier: number;
  };
}

/**
 * Main Poltergeist configuration interface for v1.0 schema.
 * Defines all aspects of file watching, build scheduling, and notifications.
 * Validates against strict schema to prevent configuration errors.
 */
export interface PoltergeistConfig {
  /** Configuration schema version (must be '1.0') */
  version: '1.0';
  /** Project type for intelligent defaults and optimizations */
  projectType: ProjectType;
  /** Array of build targets to watch and build */
  targets: Target[];
  /** Optional status scripts to surface in the panel */
  statusScripts?: StatusScriptConfig[];
  /** Optional custom summaries to surface alongside AI/Git */
  summaryScripts?: SummaryScriptConfig[];
  /** Watchman file watching configuration */
  watchman?: WatchmanConfig;
  /** Performance optimization settings */
  performance?: PerformanceConfig;
  /** Build queue and prioritization settings */
  buildScheduling?: BuildSchedulingConfig;
  /** macOS notification preferences */
  notifications?: {
    enabled?: boolean;
    successSound?: string;
    failureSound?: string;
  };
  /** Logging configuration */
  logging?: {
    file?: string;
    level: 'debug' | 'info' | 'warn' | 'error';
  };
}

export interface StatusScriptConfig {
  label: string;
  command: string;
  targets?: string[];
  cooldownSeconds?: number;
  timeoutSeconds?: number;
  maxLines?: number;
  formatter?: 'auto' | 'none' | 'swift' | 'ts';
}

export type SummaryPlacement = 'summary' | 'row';

export interface SummaryScriptConfig {
  /**
   * Display label for the summary tab/row.
   */
  label: string;
  /**
   * Command to run. Should print one summary item per line.
   */
  command: string;
  /**
   * Where to surface this summary:
   *  - 'summary' (default) adds a tab next to AI/Git in the Summary row
   *  - 'row' adds a dedicated row immediately below the Summary row
   */
  placement?: SummaryPlacement;
  /**
   * Minimum seconds between reruns (default: 1800 = 30 minutes).
   */
  refreshSeconds?: number;
  timeoutSeconds?: number;
  maxLines?: number;
  formatter?: 'auto' | 'none' | 'swift' | 'ts';
}

// Zod schemas for validation
export const BaseTargetSchema = z.object({
  name: z.string().min(1),
  type: z.enum([
    'executable',
    'app-bundle',
    'library',
    'framework',
    'test',
    'docker',
    'custom',
    'npm',
    'cmake-executable',
    'cmake-library',
    'cmake-custom',
  ]),
  enabled: z.boolean().default(true),
  buildCommand: z.string().optional(),
  watchPaths: z.array(z.string()),
  settlingDelay: z.number().optional(),
  environment: z.record(z.string(), z.string()).optional(),
  maxRetries: z.number().optional(),
  backoffMultiplier: z.number().optional(),
  debounceInterval: z.number().optional(),
  icon: z.string().optional(),
  group: z.string().optional(),
  logChannels: z.array(z.string()).optional(),
  postBuild: z
    .array(
      z.object({
        name: z.string().min(1),
        command: z.string().min(1),
        runOn: z
          .union([
            z.enum(['success', 'failure', 'always']),
            z.array(z.enum(['success', 'failure', 'always'])),
          ])
          .optional(),
        formatter: z.string().optional(),
        timeoutSeconds: z.number().optional(),
        env: z.record(z.string(), z.string()).optional(),
        cwd: z.string().optional(),
        maxLines: z.number().optional(),
      })
    )
    .optional(),
});

export const ExecutableTargetSchema = BaseTargetSchema.extend({
  type: z.literal('executable'),
  buildCommand: z.string(),
  outputPath: z.string(),
  autoRun: z
    .object({
      enabled: z.boolean().optional(),
      command: z.string().optional(),
      args: z.array(z.string()).optional(),
      restartSignal: z.string().optional(),
      restartDelayMs: z.number().optional(),
      env: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
});

export const AppBundleTargetSchema = BaseTargetSchema.extend({
  type: z.literal('app-bundle'),
  buildCommand: z.string(),
  platform: z.enum(['macos', 'ios', 'tvos', 'watchos', 'visionos']).optional(),
  bundleId: z.string(),
  autoRelaunch: z.boolean().optional(),
  launchCommand: z.string().optional(),
});

export const LibraryTargetSchema = BaseTargetSchema.extend({
  type: z.literal('library'),
  buildCommand: z.string(),
  outputPath: z.string(),
  libraryType: z.enum(['static', 'dynamic']),
});

export const FrameworkTargetSchema = BaseTargetSchema.extend({
  type: z.literal('framework'),
  buildCommand: z.string(),
  outputPath: z.string(),
  platform: z.enum(['macos', 'ios', 'tvos', 'watchos', 'visionos']).optional(),
});

export const TestTargetSchema = BaseTargetSchema.extend({
  type: z.literal('test'),
  testCommand: z.string(),
  coverageFile: z.string().optional(),
});

export const DockerTargetSchema = BaseTargetSchema.extend({
  type: z.literal('docker'),
  buildCommand: z.string(),
  imageName: z.string(),
  dockerfile: z.string().optional(),
  context: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export const CustomTargetSchema = BaseTargetSchema.extend({
  type: z.literal('custom'),
  buildCommand: z.string(),
  config: z.record(z.string(), z.any()).optional(),
});

export const NPMTargetSchema = BaseTargetSchema.extend({
  type: z.literal('npm'),
  buildScript: z.string().optional(),
  packageManager: z.enum(['npm', 'yarn', 'pnpm', 'bun', 'auto']).optional(),
  outputPaths: z.array(z.string()).optional(),
  installOnChange: z.boolean().optional(),
});

export const CMakeExecutableTargetSchema = BaseTargetSchema.extend({
  type: z.literal('cmake-executable'),
  generator: z.string().optional(),
  buildType: z.enum(['Debug', 'Release', 'RelWithDebInfo', 'MinSizeRel']).optional(),
  cmakeArgs: z.array(z.string()).optional(),
  targetName: z.string(),
  outputPath: z.string().optional(),
  parallel: z.boolean().optional(),
});

export const CMakeLibraryTargetSchema = BaseTargetSchema.extend({
  type: z.literal('cmake-library'),
  generator: z.string().optional(),
  buildType: z.enum(['Debug', 'Release', 'RelWithDebInfo', 'MinSizeRel']).optional(),
  cmakeArgs: z.array(z.string()).optional(),
  targetName: z.string(),
  libraryType: z.enum(['static', 'shared']),
  outputPath: z.string().optional(),
  parallel: z.boolean().optional(),
});

export const CMakeCustomTargetSchema = BaseTargetSchema.extend({
  type: z.literal('cmake-custom'),
  generator: z.string().optional(),
  buildType: z.enum(['Debug', 'Release', 'RelWithDebInfo', 'MinSizeRel']).optional(),
  cmakeArgs: z.array(z.string()).optional(),
  targetName: z.string(),
  parallel: z.boolean().optional(),
});

export const TargetSchema = z.discriminatedUnion('type', [
  ExecutableTargetSchema,
  AppBundleTargetSchema,
  LibraryTargetSchema,
  FrameworkTargetSchema,
  TestTargetSchema,
  DockerTargetSchema,
  CustomTargetSchema,
  NPMTargetSchema,
  CMakeExecutableTargetSchema,
  CMakeLibraryTargetSchema,
  CMakeCustomTargetSchema,
]);

export const ExclusionRuleSchema = z.object({
  pattern: z.string(),
  action: z.literal('ignore'),
  reason: z.string(),
  enabled: z.boolean().default(true),
});

export const PerformanceConfigSchema = z.object({
  profile: z.enum(['conservative', 'balanced', 'aggressive']).default('balanced'),
  autoOptimize: z.boolean().default(true),
  metrics: z.object({
    enabled: z.boolean().default(true),
    reportInterval: z.number().default(300),
  }),
});

export const WatchmanConfigSchema = z.object({
  useDefaultExclusions: z.boolean().default(true),
  excludeDirs: z.array(z.string()).default([]),
  projectType: z.enum(['swift', 'node', 'rust', 'python', 'cmake', 'mixed']).optional(),
  maxFileEvents: z.number().default(10000),
  recrawlThreshold: z.number().default(5),
  settlingDelay: z.number().default(1000),
  rules: z.array(ExclusionRuleSchema).optional(),
});

export const BuildSchedulingConfigSchema = z.object({
  parallelization: z.number().min(1).max(10).default(2),
  prioritization: z.object({
    enabled: z.boolean().default(true),
    focusDetectionWindow: z.number().default(300000), // 5 minutes
    priorityDecayTime: z.number().default(1800000), // 30 minutes
    buildTimeoutMultiplier: z.number().default(2.0),
  }),
});

export const StatusScriptConfigSchema = z.object({
  label: z.string().min(1),
  command: z.string().min(1),
  targets: z.array(z.string()).optional(),
  cooldownSeconds: z.number().min(1).default(60),
  timeoutSeconds: z.number().min(1).default(30),
  maxLines: z.number().min(1).max(10).default(1),
  formatter: z.enum(['auto', 'none', 'swift', 'ts']).optional().default('auto'),
});

export const SummaryScriptConfigSchema = z.object({
  label: z.string().min(1),
  command: z.string().min(1),
  placement: z.enum(['summary', 'row']).optional().default('summary'),
  refreshSeconds: z.number().min(30).default(1800),
  timeoutSeconds: z.number().min(1).default(30),
  maxLines: z.number().min(1).max(50).default(10),
  formatter: z.enum(['auto', 'none', 'swift', 'ts']).optional().default('auto'),
});

export const PoltergeistConfigSchema = z.object({
  version: z.literal('1.0'),
  projectType: z.enum(['swift', 'node', 'rust', 'python', 'cmake', 'mixed']),
  targets: z.array(TargetSchema),
  statusScripts: z.array(StatusScriptConfigSchema).optional(),
  summaryScripts: z.array(SummaryScriptConfigSchema).optional(),
  watchman: WatchmanConfigSchema.optional(),
  performance: PerformanceConfigSchema.optional(),
  buildScheduling: BuildSchedulingConfigSchema.optional(),
  notifications: z
    .object({
      enabled: z.boolean().optional().default(true),
      successSound: z.string().optional(),
      failureSound: z.string().optional(),
    })
    .optional(),
  logging: z
    .object({
      file: z.string().optional(),
      level: z.enum(['debug', 'info', 'warn', 'error']),
    })
    .optional(),
});

// Build status interface
export interface BuildStatus {
  targetName?: string;
  status: 'success' | 'failure' | 'building' | 'idle' | 'failed';
  timestamp: string;
  error?: string;
  errorSummary?: string;
  duration?: number;
  buildTime?: number;
  git?: string;
  gitHash?: string;
  builder?: string;
}

// CLI options
export interface CLIOptions {
  target?: string;
  all?: boolean;
  verbose?: boolean;
  config?: string;
}

// Build result interface
export interface BuildResult {
  success: boolean;
  output: string;
  error?: string;
  duration: number;
  exitCode?: number;
}

// File change interface (from watchman)
export interface FileChange {
  path: string;
  exists: boolean;
  new?: boolean;
  size?: number;
  mode?: number;
}
