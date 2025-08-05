// Priority Scoring Engine for Intelligent Build Scheduling

import type { Logger } from './logger.js';
import type {
  BuildSchedulingConfig,
  BuildStatus,
  ChangeEvent,
  Target,
  TargetPriority,
} from './types.js';
import { BuildStatusManager } from './utils/build-status-manager.js';
import picomatch from './utils/glob-matcher.js';

export class PriorityEngine {
  private config: BuildSchedulingConfig;
  private logger: Logger;
  private changeHistory: ChangeEvent[] = [];
  private targetMetrics: Map<
    string,
    {
      buildTimes: number[];
      buildSuccesses: number;
      buildAttempts: number;
    }
  > = new Map();

  constructor(config: BuildSchedulingConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
  }

  /**
   * Calculates dynamic priority score for build scheduling based on:
   * - Recent file change frequency (base score with exponential decay)
   * - Focus detection (developer attention patterns over time)
   * - Build success rate (reliability factor 0.5-1.0x)
   * - Build time penalties (for serial execution mode)
   *
   * Higher scores indicate higher priority in the build queue.
   * Score typically ranges from 0-500+ depending on activity.
   */
  public calculatePriority(target: Target, affectedFiles: string[]): TargetPriority {
    const now = Date.now();
    const focusWindow = this.config.prioritization.focusDetectionWindow;
    const recentHistory = this.getRecentHistory(focusWindow);

    // Analyze changes for this target
    const targetChanges = this.getTargetChanges(target.name, recentHistory);
    const directChanges = targetChanges.filter((c) => c.changeType === 'direct');

    // Calculate base metrics for priority algorithm
    const lastDirectChange =
      directChanges.length > 0 ? Math.max(...directChanges.map((c) => c.timestamp)) : 0;
    const directChangeFrequency = directChanges.length;
    const focusMultiplier = this.calculateFocusMultiplier(target.name, recentHistory);
    const avgBuildTime = this.getAverageBuildTime(target.name);
    const successRate = this.getBuildSuccessRate(target.name);

    // Calculate priority score using weighted algorithm:
    // 1. Base score from file changes (with exponential decay)
    // 2. Focus multiplier (1.0x - 2.0x based on developer attention)
    // 3. Success rate factor (50% base + 50% based on build reliability)
    let score = this.calculateBaseScore(directChanges, affectedFiles, now);
    score *= focusMultiplier;
    score *= 0.5 + successRate * 0.5; // Ensures minimum 50% weight even for failing builds

    // Apply build time penalty in serial mode
    if (this.config.parallelization === 1 && avgBuildTime > 30000) {
      score *= 0.8;
      this.logger.debug(`Applied build time penalty to ${target.name}: ${avgBuildTime}ms > 30s`);
    }

    const priority: TargetPriority = {
      target: target.name,
      score,
      lastDirectChange,
      directChangeFrequency,
      focusMultiplier,
      avgBuildTime,
      successRate,
      recentChanges: targetChanges,
    };

    this.logger.debug(
      `Priority for ${target.name}: ${score.toFixed(2)} (focus: ${focusMultiplier.toFixed(2)}x, success: ${(successRate * 100).toFixed(1)}%)`
    );

    return priority;
  }

  /**
   * Record a file change event
   */
  public recordChange(files: string[], targets: Target[]): ChangeEvent[] {
    const now = Date.now();
    const events: ChangeEvent[] = [];

    // Return empty if no targets provided
    if (targets.length === 0) {
      this.logger.debug('No targets provided, skipping change recording');
      return events;
    }

    for (const file of files) {
      // Filter out malformed file paths
      if (!file || file.trim().length === 0 || file.includes('//')) {
        this.logger.debug(`Skipping malformed file path: "${file}"`);
        continue;
      }

      const affectedTargets = this.getAffectedTargets(file, targets);

      // Skip files that don't affect any targets
      if (affectedTargets.length === 0) {
        this.logger.debug(`File ${file} doesn't affect any targets, skipping`);
        continue;
      }

      const changeType = this.classifyChange(file, affectedTargets);
      const impactWeight = this.calculateImpactWeight(file, changeType);

      const event: ChangeEvent = {
        file: file.trim(),
        timestamp: now,
        affectedTargets: affectedTargets.map((t) => t.name),
        changeType,
        impactWeight,
      };

      events.push(event);
      this.changeHistory.push(event);
    }

    // Clean old history
    this.cleanOldHistory();

    this.logger.debug(`Recorded ${events.length} change events`);
    return events;
  }

  /**
   * Record build completion for metrics
   */
  public recordBuildResult(targetName: string, buildStatus: BuildStatus): void {
    if (!this.targetMetrics.has(targetName)) {
      this.targetMetrics.set(targetName, {
        buildTimes: [],
        buildSuccesses: 0,
        buildAttempts: 0,
      });
    }

    const metrics = this.targetMetrics.get(targetName);
    if (!metrics) return;

    if (buildStatus.duration) {
      metrics.buildTimes.push(buildStatus.duration);
      // Keep only last 10 build times
      if (metrics.buildTimes.length > 10) {
        metrics.buildTimes.shift();
      }
    }

    metrics.buildAttempts++;
    if (BuildStatusManager.isSuccess(buildStatus)) {
      metrics.buildSuccesses++;
    }

    // Keep rolling window of last 20 attempts
    if (metrics.buildAttempts > 20) {
      const ratio = metrics.buildSuccesses / metrics.buildAttempts;
      metrics.buildAttempts = 20;
      metrics.buildSuccesses = Math.round(ratio * 20);
    }
  }

  /**
   * Get focus pattern information for debugging
   */
  public getFocusInfo(): { target: string; percentage: number; multiplier: number }[] {
    const recentHistory = this.getRecentHistory(this.config.prioritization.focusDetectionWindow);
    const targets = new Set(recentHistory.flatMap((h) => h.affectedTargets));

    return Array.from(targets)
      .map((target) => {
        const targetChanges = this.getTargetChanges(target, recentHistory);
        const percentage = (targetChanges.length / recentHistory.length) * 100;
        const multiplier = this.calculateFocusMultiplier(target, recentHistory);

        return { target, percentage, multiplier };
      })
      .sort((a, b) => b.percentage - a.percentage);
  }

  // Private methods

  /**
   * Calculates base priority score using exponential decay formula:
   * - Direct changes: 100 points each * decay_factor
   * - Recency bonus: 50 points * decay_factor
   * - Current files: 25 points each (no decay)
   *
   * Decay factor = e^(-age_ms / decay_time) ensures recent changes
   * have higher priority than older ones.
   */
  private calculateBaseScore(
    directChanges: ChangeEvent[],
    affectedFiles: string[],
    now: number
  ): number {
    let score = 0;

    // Base score from direct changes (100 points each) with decay
    if (directChanges.length > 0) {
      const mostRecent = Math.max(...directChanges.map((c) => c.timestamp));
      const ageMs = now - mostRecent;
      const decayTime = this.config.prioritization.priorityDecayTime;

      // Apply exponential decay: score decreases as changes get older
      // Formula: e^(-age_ms / decay_time_ms)
      const decayFactor = Math.exp(-ageMs / decayTime);
      score += directChanges.length * 100 * decayFactor;

      // Recency bonus rewards recent activity (also decayed)
      const recencyBonus = 50 * decayFactor;
      score += recencyBonus;
    }

    // Current file trigger bonus (no decay for immediate triggers)
    const currentChanges = affectedFiles.length;
    score += currentChanges * 25; // 25 points per current file

    return score;
  }

  /**
   * Calculates focus multiplier based on developer attention patterns.
   * Analyzes what percentage of recent changes affected this target:
   * - 80%+ activity: 2.0x (strong focus)
   * - 50%+ activity: 1.5x (moderate focus)
   * - 30%+ activity: 1.2x (weak focus)
   * - <30% activity: 1.0x (no focus)
   */
  private calculateFocusMultiplier(targetName: string, recentHistory: ChangeEvent[]): number {
    if (recentHistory.length === 0) return 1.0;

    // Apply decay filtering for focus calculation too
    const now = Date.now();
    const decayTime = this.config.prioritization.priorityDecayTime;
    const validHistory = recentHistory.filter((event) => {
      const ageMs = now - event.timestamp;
      return ageMs <= decayTime; // Use same decay time for focus calculation
    });

    if (validHistory.length === 0) return 1.0;

    const targetChanges = this.getTargetChanges(targetName, validHistory);
    const percentage = (targetChanges.length / validHistory.length) * 100;

    if (percentage >= 80) return 2.0; // Strong focus
    if (percentage >= 50) return 1.5; // Moderate focus
    if (percentage >= 30) return 1.2; // Weak focus
    return 1.0; // No focus
  }

  private getAffectedTargets(file: string, targets: Target[]): Target[] {
    return targets.filter((target) =>
      target.watchPaths.some((pattern) => picomatch(pattern)(file))
    );
  }

  /**
   * Classifies file changes to determine impact weight:
   * - direct: affects single target (weight: 1.0)
   * - shared: affects multiple targets (weight: 0.7)
   * - generated: build artifacts, auto-generated files (weight: 0.3)
   */
  private classifyChange(
    file: string,
    affectedTargets: Target[]
  ): 'direct' | 'shared' | 'generated' {
    // Check if it's a generated file
    if (
      file.includes('Version.swift') ||
      file.includes('.generated.') ||
      file.includes('/build/') ||
      file.includes('/.build/')
    ) {
      return 'generated';
    }

    // Direct change affects only one target
    if (affectedTargets.length === 1) {
      return 'direct';
    }

    // Shared change affects multiple targets
    return 'shared';
  }

  private calculateImpactWeight(
    _file: string,
    changeType: 'direct' | 'shared' | 'generated'
  ): number {
    switch (changeType) {
      case 'direct':
        return 1.0;
      case 'shared':
        return 0.7;
      case 'generated':
        return 0.3;
    }
  }

  private getTargetChanges(targetName: string, history: ChangeEvent[]): ChangeEvent[] {
    return history.filter((event) => event.affectedTargets.includes(targetName));
  }

  private getRecentHistory(windowMs: number): ChangeEvent[] {
    const cutoff = Date.now() - windowMs;
    return this.changeHistory.filter((event) => event.timestamp > cutoff);
  }

  private getAverageBuildTime(targetName: string): number {
    const metrics = this.targetMetrics.get(targetName);
    if (!metrics || metrics.buildTimes.length === 0) {
      return 0;
    }

    const sum = metrics.buildTimes.reduce((a, b) => a + b, 0);
    return sum / metrics.buildTimes.length;
  }

  private getBuildSuccessRate(targetName: string): number {
    const metrics = this.targetMetrics.get(targetName);
    if (!metrics || metrics.buildAttempts === 0) {
      return 1.0; // Assume success for unknown targets
    }

    return metrics.buildSuccesses / metrics.buildAttempts;
  }

  private cleanOldHistory(): void {
    const cutoff = Date.now() - this.config.prioritization.priorityDecayTime;
    this.changeHistory = this.changeHistory.filter((event) => event.timestamp > cutoff);
  }
}
