// New type definitions for generic target system
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
  buildCommand: string;
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
  outputPath: string;
}

// App bundle target (macOS, iOS apps)
export interface AppBundleTarget extends BaseTarget {
  type: 'app-bundle';
  platform?: 'macos' | 'ios' | 'tvos' | 'watchos' | 'visionos';
  bundleId: string;
  autoRelaunch?: boolean;
  launchCommand?: string;
}

// Library target (static/dynamic libraries)
export interface LibraryTarget extends BaseTarget {
  type: 'library';
  outputPath: string;
  libraryType: 'static' | 'dynamic';
}

// Framework target (macOS/iOS frameworks)
export interface FrameworkTarget extends BaseTarget {
  type: 'framework';
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
  imageName: string;
  dockerfile?: string;
  context?: string;
  tags?: string[];
}

// Custom target (for extensibility)
export interface CustomTarget extends BaseTarget {
  type: 'custom';
  config: Record<string, unknown>;
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

// Configuration interface
export interface PoltergeistConfig {
  targets: Target[];
  notifications?: {
    enabled: boolean;
    successSound?: string;
    failureSound?: string;
  };
  logging?: {
    file: string;
    level: 'debug' | 'info' | 'warn' | 'error';
  };
  watchman?: {
    settlingDelay?: number;
  };
}

// Zod schemas for validation
export const BaseTargetSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['executable', 'app-bundle', 'library', 'framework', 'test', 'docker', 'custom']),
  enabled: z.boolean(),
  buildCommand: z.string(),
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
  outputPath: z.string(),
});

export const AppBundleTargetSchema = BaseTargetSchema.extend({
  type: z.literal('app-bundle'),
  platform: z.enum(['macos', 'ios', 'tvos', 'watchos', 'visionos']).optional(),
  bundleId: z.string(),
  autoRelaunch: z.boolean().optional(),
  launchCommand: z.string().optional(),
});

export const LibraryTargetSchema = BaseTargetSchema.extend({
  type: z.literal('library'),
  outputPath: z.string(),
  libraryType: z.enum(['static', 'dynamic']),
});

export const FrameworkTargetSchema = BaseTargetSchema.extend({
  type: z.literal('framework'),
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
  imageName: z.string(),
  dockerfile: z.string().optional(),
  context: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export const CustomTargetSchema = BaseTargetSchema.extend({
  type: z.literal('custom'),
  config: z.record(z.string(), z.any()),
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

export const PoltergeistConfigSchema = z.object({
  targets: z.array(TargetSchema),
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
  watchman: z
    .object({
      settlingDelay: z.number().optional(),
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

// Legacy compatibility types for migration
export type BuildTarget = string; // Now just the target name
export type BuildTargetConfig = Target; // Maps to new Target type

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
