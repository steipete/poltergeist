// Poltergeist v1.0 - Clean, simple types
import { z } from 'zod';

// Target types
export type TargetType =
  | 'executable'
  | 'app-bundle'
  | 'library'
  | 'framework'
  | 'test'
  | 'docker'
  | 'custom';

// Base target interface
export interface BaseTarget {
  name: string;
  type: TargetType;
  enabled: boolean;
  buildCommand?: string;
  watchPaths: string[];
  settlingDelay?: number;
  environment?: Record<string, string>;
  maxRetries?: number;
  backoffMultiplier?: number;
  debounceInterval?: number;
  icon?: string; // Path to icon file for notifications
}

// Executable target (CLI tools, binaries)
export interface ExecutableTarget extends BaseTarget {
  type: 'executable';
  buildCommand: string;
  outputPath: string;
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

// Union type for all targets
export type Target =
  | ExecutableTarget
  | AppBundleTarget
  | LibraryTarget
  | FrameworkTarget
  | TestTarget
  | DockerTarget
  | CustomTarget;

// Project types for smart defaults
export type ProjectType = 'swift' | 'node' | 'rust' | 'python' | 'mixed';

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
  projectType: ProjectType;
  maxFileEvents: number;
  recrawlThreshold: number;
  settlingDelay: number;
  rules?: ExclusionRule[];
}

// Main configuration interface - Version 1.0
export interface PoltergeistConfig {
  version: '1.0';
  projectType: ProjectType;
  targets: Target[];
  watchman: WatchmanConfig;
  performance?: PerformanceConfig;
  notifications?: {
    enabled: boolean;
    successSound?: string;
    failureSound?: string;
  };
  logging?: {
    file: string;
    level: 'debug' | 'info' | 'warn' | 'error';
  };
}

// Zod schemas for validation
export const BaseTargetSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['executable', 'app-bundle', 'library', 'framework', 'test', 'docker', 'custom']),
  enabled: z.boolean(),
  buildCommand: z.string().optional(),
  watchPaths: z.array(z.string()),
  settlingDelay: z.number().optional(),
  environment: z.record(z.string(), z.string()).optional(),
  maxRetries: z.number().optional(),
  backoffMultiplier: z.number().optional(),
  debounceInterval: z.number().optional(),
  icon: z.string().optional(),
});

export const ExecutableTargetSchema = BaseTargetSchema.extend({
  type: z.literal('executable'),
  buildCommand: z.string(),
  outputPath: z.string(),
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

export const TargetSchema = z.discriminatedUnion('type', [
  ExecutableTargetSchema,
  AppBundleTargetSchema,
  LibraryTargetSchema,
  FrameworkTargetSchema,
  TestTargetSchema,
  DockerTargetSchema,
  CustomTargetSchema,
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
  projectType: z.enum(['swift', 'node', 'rust', 'python', 'mixed']),
  maxFileEvents: z.number().default(10000),
  recrawlThreshold: z.number().default(5),
  settlingDelay: z.number().default(1000),
  rules: z.array(ExclusionRuleSchema).optional(),
});

export const PoltergeistConfigSchema = z.object({
  version: z.literal('1.0'),
  projectType: z.enum(['swift', 'node', 'rust', 'python', 'mixed']),
  targets: z.array(TargetSchema),
  watchman: WatchmanConfigSchema,
  performance: PerformanceConfigSchema.optional(),
  notifications: z
    .object({
      enabled: z.boolean(),
      successSound: z.string().optional(),
      failureSound: z.string().optional(),
    })
    .optional(),
  logging: z
    .object({
      file: z.string(),
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