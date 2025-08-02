// Priority Scoring Engine for Intelligent Build Scheduling

import type { 
  Target, 
  ChangeEvent, 
  TargetPriority, 
  BuildSchedulingConfig,
  BuildStatus 
} from './types.js';
import type { Logger } from './logger.js';

export class PriorityEngine {
  private config: BuildSchedulingConfig;
  private logger: Logger;
  private changeHistory: ChangeEvent[] = [];
  private targetMetrics: Map<string, {
    buildTimes: number[];
    buildSuccesses: number;
    buildAttempts: number;
  }> = new Map();

  constructor(config: BuildSchedulingConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
  }

  /**
   * Calculate priority score for a target based on recent activity
   */
  public calculatePriority(target: Target, affectedFiles: string[]): TargetPriority {
    const now = Date.now();
    const focusWindow = this.config.prioritization.focusDetectionWindow;
    const recentHistory = this.getRecentHistory(focusWindow);
    
    // Analyze changes for this target
    const targetChanges = this.getTargetChanges(target.name, recentHistory);
    const directChanges = targetChanges.filter(c => c.changeType === 'direct');
    
    // Calculate base metrics
    const lastDirectChange = directChanges.length > 0 
      ? Math.max(...directChanges.map(c => c.timestamp)) 
      : 0;
    const directChangeFrequency = directChanges.length;
    const focusMultiplier = this.calculateFocusMultiplier(target.name, recentHistory);
    const avgBuildTime = this.getAverageBuildTime(target.name);
    const successRate = this.getBuildSuccessRate(target.name);

    // Calculate priority score
    let score = this.calculateBaseScore(directChanges, affectedFiles, now);
    score *= focusMultiplier;
    score *= (0.5 + successRate * 0.5); // Build success factor
    
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
      recentChanges: targetChanges
    };

    this.logger.debug(`Priority for ${target.name}: ${score.toFixed(2)} (focus: ${focusMultiplier.toFixed(2)}x, success: ${(successRate * 100).toFixed(1)}%)`);
    
    return priority;
  }

  /**
   * Record a file change event
   */
  public recordChange(files: string[], targets: Target[]): ChangeEvent[] {
    const now = Date.now();
    const events: ChangeEvent[] = [];

    for (const file of files) {
      const affectedTargets = this.getAffectedTargets(file, targets);
      const changeType = this.classifyChange(file, affectedTargets);
      const impactWeight = this.calculateImpactWeight(file, changeType);

      const event: ChangeEvent = {
        file,
        timestamp: now,
        affectedTargets: affectedTargets.map(t => t.name),
        changeType,
        impactWeight
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
        buildAttempts: 0
      });
    }

    const metrics = this.targetMetrics.get(targetName)!;
    
    if (buildStatus.duration) {
      metrics.buildTimes.push(buildStatus.duration);
      // Keep only last 10 build times
      if (metrics.buildTimes.length > 10) {
        metrics.buildTimes.shift();
      }
    }

    metrics.buildAttempts++;
    if (buildStatus.status === 'success') {
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
    const targets = new Set(recentHistory.flatMap(h => h.affectedTargets));
    
    return Array.from(targets).map(target => {
      const targetChanges = this.getTargetChanges(target, recentHistory);
      const percentage = (targetChanges.length / recentHistory.length) * 100;
      const multiplier = this.calculateFocusMultiplier(target, recentHistory);
      
      return { target, percentage, multiplier };
    }).sort((a, b) => b.percentage - a.percentage);
  }

  // Private methods

  private calculateBaseScore(directChanges: ChangeEvent[], affectedFiles: string[], now: number): number {
    let score = 0;
    
    // Base score from direct changes (100 points each)
    score += directChanges.length * 100;
    
    // Recency bonus (0-50 points based on how recent)
    if (directChanges.length > 0) {
      const mostRecent = Math.max(...directChanges.map(c => c.timestamp));
      const recencyMinutes = (now - mostRecent) / (1000 * 60);
      const recencyBonus = Math.max(0, 50 - recencyMinutes * 5); // Decay over 10 minutes
      score += recencyBonus;
    }

    // Current file trigger bonus
    const currentChanges = affectedFiles.length;
    score += currentChanges * 25; // 25 points per current file

    return score;
  }

  private calculateFocusMultiplier(targetName: string, recentHistory: ChangeEvent[]): number {
    if (recentHistory.length === 0) return 1.0;

    const targetChanges = this.getTargetChanges(targetName, recentHistory);
    const percentage = (targetChanges.length / recentHistory.length) * 100;

    if (percentage >= 80) return 2.0;      // Strong focus
    if (percentage >= 50) return 1.5;      // Moderate focus  
    if (percentage >= 30) return 1.2;      // Weak focus
    return 1.0;                            // No focus
  }

  private getAffectedTargets(file: string, targets: Target[]): Target[] {
    return targets.filter(target => 
      target.watchPaths.some(pattern => 
        this.matchesPattern(file, pattern)
      )
    );
  }

  private matchesPattern(file: string, pattern: string): boolean {
    // Simple glob matching - convert to regex
    const regexPattern = pattern
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '.');
    
    try {
      return new RegExp(regexPattern).test(file);
    } catch {
      return false;
    }
  }

  private classifyChange(file: string, affectedTargets: Target[]): 'direct' | 'shared' | 'generated' {
    // Check if it's a generated file
    if (file.includes('Version.swift') || 
        file.includes('.generated.') || 
        file.includes('/build/') ||
        file.includes('/.build/')) {
      return 'generated';
    }

    // Direct change affects only one target
    if (affectedTargets.length === 1) {
      return 'direct';
    }

    // Shared change affects multiple targets
    return 'shared';
  }

  private calculateImpactWeight(file: string, changeType: 'direct' | 'shared' | 'generated'): number {
    switch (changeType) {
      case 'direct': return 1.0;
      case 'shared': return 0.7;
      case 'generated': return 0.3;
    }
  }

  private getTargetChanges(targetName: string, history: ChangeEvent[]): ChangeEvent[] {
    return history.filter(event => 
      event.affectedTargets.includes(targetName)
    );
  }

  private getRecentHistory(windowMs: number): ChangeEvent[] {
    const cutoff = Date.now() - windowMs;
    return this.changeHistory.filter(event => event.timestamp > cutoff);
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
    this.changeHistory = this.changeHistory.filter(event => 
      event.timestamp > cutoff
    );
  }
}