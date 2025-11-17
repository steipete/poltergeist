/**
 * Unified build status management for Poltergeist
 * Consolidates build status validation, error handling, and result processing
 */

import type { BuildStatus } from '../types.js';

/**
 * Standardized build status values
 */
export enum BuildStatusType {
  SUCCESS = 'success',
  FAILED = 'failure',
  BUILDING = 'building',
  IDLE = 'idle',
  UNKNOWN = 'unknown',
}

export interface BuildMetrics {
  duration: number;
  exitCode?: number;
  output?: string;
  outputInfo?: string;
}

export interface BuildError {
  message: string;
  summary?: string;
  exitCode?: number;
  type?: 'compilation' | 'runtime' | 'configuration' | 'unknown';
}

/**
 * Centralized build status management and error handling
 *
 * Note: Uses static-only class for namespacing and API organization.
 * This provides clear boundaries and logical grouping of related functions.
 */
// biome-ignore lint/complexity/noStaticOnlyClass: Intentional design for API organization
export class BuildStatusManager {
  /**
   * Create a successful build status
   */
  public static createSuccessStatus(
    targetName: string,
    metrics: BuildMetrics,
    options: {
      gitHash?: string;
      builder?: string;
      buildTime?: number;
    } = {}
  ): BuildStatus {
    return {
      targetName,
      status: BuildStatusType.SUCCESS,
      timestamp: new Date().toISOString(),
      gitHash: options.gitHash || 'unknown',
      builder: options.builder || 'unknown',
      duration: metrics.duration,
      buildTime: options.buildTime || metrics.duration / 1000,
    };
  }

  /**
   * Create a failed build status with error details
   */
  public static createFailureStatus(
    targetName: string,
    error: BuildError,
    metrics: Partial<BuildMetrics>,
    options: {
      gitHash?: string;
      builder?: string;
    } = {}
  ): BuildStatus {
    return {
      targetName,
      status: BuildStatusType.FAILED,
      timestamp: new Date().toISOString(),
      error: error.message,
      errorSummary: error.summary,
      gitHash: options.gitHash || 'unknown',
      builder: options.builder || 'unknown',
      duration: metrics.duration || 0,
      buildTime: metrics.duration ? metrics.duration / 1000 : 0,
    };
  }

  /**
   * Create a building status
   */
  public static createBuildingStatus(
    targetName: string,
    options: {
      gitHash?: string;
      builder?: string;
    } = {}
  ): BuildStatus {
    return {
      targetName,
      status: BuildStatusType.BUILDING,
      timestamp: new Date().toISOString(),
      gitHash: options.gitHash || 'unknown',
      builder: options.builder || 'unknown',
      duration: 0,
      buildTime: 0,
    };
  }

  /**
   * Check if a build status represents success
   */
  public static isSuccess(status: BuildStatus | string): boolean {
    const statusValue = typeof status === 'string' ? status : status.status;
    return statusValue === BuildStatusType.SUCCESS;
  }

  /**
   * Check if a build status represents failure
   */
  public static isFailure(status: BuildStatus | string): boolean {
    const statusValue = typeof status === 'string' ? status : status.status;
    return statusValue === BuildStatusType.FAILED;
  }

  /**
   * Check if a build is currently in progress
   */
  public static isBuilding(status: BuildStatus | string): boolean {
    const statusValue = typeof status === 'string' ? status : status.status;
    return statusValue === BuildStatusType.BUILDING;
  }

  /**
   * Extract error summary from build output using common patterns
   */
  public static extractErrorSummary(errorOutput: string): string {
    if (!errorOutput) return 'Build failed';

    const lines = errorOutput
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    // Look for common error patterns in order of priority
    for (const line of lines) {
      // TypeScript errors
      if (line.includes('error TS')) {
        return line.trim();
      }

      // Swift compilation errors
      if (line.includes('error:') && !line.includes('warning:')) {
        return line.trim();
      }

      // General compilation errors
      if (line.toLowerCase().includes('compilation failed')) {
        return line.trim();
      }

      // Generic error patterns
      if (line.includes('Error:') || line.includes('ERROR:')) {
        return line.trim();
      }

      // Build tool specific errors
      if (line.includes('error:') || line.includes('Error building')) {
        return line.trim();
      }
    }

    // Fallback to first non-empty line or truncated output
    const firstLine = lines.find((line) => line.length > 0);
    return firstLine?.substring(0, 100) || errorOutput.substring(0, 100);
  }

  /**
   * Categorize error type based on content
   */
  public static categorizeError(errorOutput: string, _exitCode?: number): BuildError['type'] {
    if (!errorOutput) return 'unknown';

    const lowerOutput = errorOutput.toLowerCase();

    if (lowerOutput.includes('error ts') || lowerOutput.includes('compilation failed')) {
      return 'compilation';
    }

    if (lowerOutput.includes('runtime error') || lowerOutput.includes('segmentation fault')) {
      return 'runtime';
    }

    if (lowerOutput.includes('config') || lowerOutput.includes('configuration')) {
      return 'configuration';
    }

    return 'unknown';
  }

  /**
   * Create a BuildError object from raw error data
   */
  public static createError(
    errorMessage: string,
    exitCode?: number,
    rawOutput?: string
  ): BuildError {
    const summary = BuildStatusManager.extractErrorSummary(rawOutput || errorMessage);
    const type = BuildStatusManager.categorizeError(rawOutput || errorMessage, exitCode);

    return {
      message: errorMessage,
      summary: summary && summary !== 'Build failed' ? summary : undefined,
      exitCode,
      type,
    };
  }

  /**
   * Format build duration as human-readable string
   */
  public static formatDuration(durationMs: number): string {
    const seconds = durationMs / 1000;

    if (seconds < 1) {
      return `${durationMs.toFixed(0)}ms`;
    } else if (seconds < 60) {
      return `${seconds.toFixed(1)}s`;
    } else {
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = seconds % 60;
      return `${minutes}m ${remainingSeconds.toFixed(1)}s`;
    }
  }

  /**
   * Get error message with fallback logic
   */
  public static getErrorMessage(status: BuildStatus): string {
    if (status.errorSummary?.trim()) {
      return status.errorSummary;
    }

    const rawError = status.error;

    if (typeof rawError === 'string' && rawError.trim()) {
      return rawError;
    }

    if (rawError && typeof rawError === 'object') {
      if ('summary' in rawError && rawError.summary) return String(rawError.summary);
      if ('message' in rawError && rawError.message) return String(rawError.message);
    }

    return 'Build failed';
  }

  /**
   * Format build notification message
   */
  public static formatNotificationMessage(status: BuildStatus, outputInfo?: string): string {
    const duration = status.duration ? BuildStatusManager.formatDuration(status.duration) : null;

    if (BuildStatusManager.isSuccess(status)) {
      if (outputInfo) {
        return `Built: ${outputInfo}${duration ? ` in ${duration}` : ''}`;
      } else {
        return `Build completed${duration ? ` in ${duration}` : ''}`;
      }
    } else if (BuildStatusManager.isFailure(status)) {
      const errorMsg = BuildStatusManager.getErrorMessage(status);
      return `Build failed${duration ? ` after ${duration}` : ''}: ${errorMsg}`;
    } else {
      return `Build status: ${status.status}${duration ? ` (${duration})` : ''}`;
    }
  }

  /**
   * Interpret exit code meaning
   */
  public static interpretExitCode(exitCode: number): string {
    switch (exitCode) {
      case 0:
        return 'Success';
      case 1:
        return 'General error';
      case 2:
        return 'Misuse of shell builtins';
      case 126:
        return 'Command invoked cannot execute';
      case 127:
        return 'Command not found';
      case 128:
        return 'Invalid argument to exit';
      case 130:
        return 'Script terminated by Ctrl+C';
      default:
        if (exitCode > 128) {
          return `Terminated by signal ${exitCode - 128}`;
        }
        return `Unknown error (code ${exitCode})`;
    }
  }

  /**
   * Create BuildMetrics from timing and result data
   */
  public static createMetrics(
    startTime: number,
    endTime: number = Date.now(),
    exitCode?: number,
    output?: string,
    outputInfo?: string
  ): BuildMetrics {
    return {
      duration: endTime - startTime,
      exitCode,
      output,
      outputInfo,
    };
  }

  /**
   * Validate build status type
   */
  public static isValidStatus(status: string): status is BuildStatusType {
    return Object.values(BuildStatusType).includes(status as BuildStatusType);
  }

  /**
   * Get status display color for terminal output
   */
  public static getStatusColor(
    status: BuildStatus | string
  ): 'green' | 'red' | 'yellow' | 'blue' | 'gray' {
    const statusValue = typeof status === 'string' ? status : status.status;

    switch (statusValue) {
      case BuildStatusType.SUCCESS:
        return 'green';
      case BuildStatusType.FAILED:
        return 'red';
      case BuildStatusType.BUILDING:
        return 'yellow';
      case BuildStatusType.IDLE:
        return 'blue';
      default:
        return 'gray';
    }
  }
}
