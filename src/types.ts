import { z } from 'zod';

// Configuration schema with Zod for validation
export const BuildTargetConfigSchema = z.object({
  enabled: z.boolean(),
  name: z.string().optional(), // Display name for notifications
  buildCommand: z.string(),
  watchPaths: z.array(z.string()),
  statusFile: z.string(),
  lockFile: z.string(),
  outputPath: z.string().optional(),
  bundleId: z.string().optional(),
  autoRelaunch: z.boolean().optional(),
  settlingDelay: z.number().default(1000),
  maxRetries: z.number().default(3),
  backoffMultiplier: z.number().default(2),
});

export const PoltergeistConfigSchema = z.object({
  cli: BuildTargetConfigSchema.optional(),
  macApp: BuildTargetConfigSchema.optional(),
  notifications: z.object({
    enabled: z.boolean().default(true),
    successSound: z.string().default('Glass'),
    failureSound: z.string().default('Basso'),
    buildStart: z.boolean().default(true),
    buildFailed: z.boolean().default(true),
    buildSuccess: z.boolean().default(true),
    minInterval: z.number().default(5000), // Minimum time between notifications in ms
  }).default({
    enabled: true,
    successSound: 'Glass',
    failureSound: 'Basso',
    buildStart: true,
    buildFailed: true,
    buildSuccess: true,
    minInterval: 5000,
  }),
  logging: z.object({
    file: z.string().default('.poltergeist.log'),
    level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  }).default({
    file: '.poltergeist.log',
    level: 'info',
  }),
});

export type BuildTargetConfig = z.infer<typeof BuildTargetConfigSchema>;
export type PoltergeistConfig = z.infer<typeof PoltergeistConfigSchema>;

export interface BuildStatus {
  status: 'idle' | 'building' | 'success' | 'failed';
  timestamp: string;
  gitHash: string;
  errorSummary: string;
  builder: string;
  buildTime?: number;
}

export interface FileChange {
  path: string;
  exists: boolean;
  new: boolean;
  size: number;
  mode: number;
}

export type BuildTarget = 'cli' | 'macApp';

export interface BuildResult {
  success: boolean;
  output: string;
  error?: string;
  duration: number;
  exitCode?: number;
}