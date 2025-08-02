// Intelligent Build Queue with Priority Management

import type { 
  Target, 
  BuildRequest, 
  BuildSchedulingConfig,
  BuildStatus,
  TargetPriority 
} from './types.js';
import type { Logger } from './logger.js';
import type { BaseBuilder } from './builders/index.js';
import { PriorityEngine } from './priority-engine.js';

interface QueuedBuild extends BuildRequest {
  builder: BaseBuilder;
  startTime?: number;
  retryCount: number;
}

interface RunningBuild {
  request: QueuedBuild;
  promise: Promise<BuildStatus>;
  startTime: number;
}

export class IntelligentBuildQueue {
  private config: BuildSchedulingConfig;
  private logger: Logger;
  private priorityEngine: PriorityEngine;
  
  // Queue state
  private pendingQueue: QueuedBuild[] = [];
  private runningBuilds: Map<string, RunningBuild> = new Map();
  private pendingRebuilds: Set<string> = new Set();
  private targetBuilders: Map<string, BaseBuilder> = new Map();
  private targets: Map<string, Target> = new Map();
  
  // Statistics
  private queueStats = {
    totalBuilds: 0,
    successfulBuilds: 0,
    failedBuilds: 0,
    avgWaitTime: 0,
    avgBuildTime: 0
  };

  constructor(
    config: BuildSchedulingConfig,
    logger: Logger,
    priorityEngine: PriorityEngine
  ) {
    this.config = config;
    this.logger = logger;
    this.priorityEngine = priorityEngine;
  }

  /**
   * Register a target with its builder
   */
  public registerTarget(target: Target, builder: BaseBuilder): void {
    this.targetBuilders.set(target.name, builder);
    this.targets.set(target.name, target);
    this.logger.debug(`Registered target: ${target.name}`);
  }

  /**
   * Schedule builds for changed files
   */
  public async onFileChanged(files: string[], targets: Target[]): Promise<void> {
    // Record change events for priority calculation
    const changeEvents = this.priorityEngine.recordChange(files, targets);
    
    // Find affected targets
    const affectedTargets = new Set<Target>();
    for (const event of changeEvents) {
      for (const targetName of event.affectedTargets) {
        const target = targets.find(t => t.name === targetName);
        if (target) {
          affectedTargets.add(target);
        }
      }
    }

    this.logger.info(`File changes detected: ${files.length} files affected ${affectedTargets.size} targets`);

    // Schedule builds for affected targets
    for (const target of affectedTargets) {
      await this.scheduleTargetBuild(target, files);
    }

    // Process the queue
    this.processQueue();
  }

  /**
   * Schedule a build for a specific target
   */
  private async scheduleTargetBuild(target: Target, triggeringFiles: string[]): Promise<void> {
    const targetName = target.name;
    
    // If already building, mark for rebuild
    if (this.runningBuilds.has(targetName)) {
      this.pendingRebuilds.add(targetName);
      this.logger.debug(`Target ${targetName} already building, marked for rebuild`);
      return;
    }

    // Calculate priority
    const priority = this.priorityEngine.calculatePriority(target, triggeringFiles);
    
    // Check if already queued
    const existingIndex = this.pendingQueue.findIndex(req => req.target.name === targetName);
    
    if (existingIndex >= 0) {
      // Update existing request with new priority
      const existing = this.pendingQueue[existingIndex];
      existing.priority = priority.score;
      existing.triggeringFiles = [...new Set([...existing.triggeringFiles, ...triggeringFiles])];
      existing.timestamp = Date.now();
      
      // Re-sort queue by priority
      this.sortQueue();
      
      this.logger.debug(`Updated existing queue entry for ${targetName} with priority ${priority.score.toFixed(2)}`);
    } else {
      // Add new build request
      const builder = this.targetBuilders.get(targetName);
      if (!builder) {
        this.logger.error(`No builder registered for target: ${targetName}`);
        return;
      }

      const request: QueuedBuild = {
        target,
        priority: priority.score,
        timestamp: Date.now(),
        triggeringFiles,
        id: this.generateRequestId(),
        builder,
        retryCount: 0
      };

      this.pendingQueue.push(request);
      this.sortQueue();
      
      this.logger.info(`Queued build for ${targetName} with priority ${priority.score.toFixed(2)} (queue size: ${this.pendingQueue.length})`);
    }
  }

  /**
   * Process the build queue respecting parallelization limits
   */
  private processQueue(): void {
    while (
      this.pendingQueue.length > 0 && 
      this.runningBuilds.size < this.config.parallelization
    ) {
      const request = this.pendingQueue.shift()!;
      this.startBuild(request);
    }
  }

  /**
   * Start building a queued request
   */
  private async startBuild(request: QueuedBuild): Promise<void> {
    const targetName = request.target.name;
    const startTime = Date.now();
    
    this.logger.info(`Starting build for ${targetName} (priority: ${request.priority.toFixed(2)})`);
    
    try {
      // Create build promise
      const buildPromise = this.executeBuild(request);
      
      // Track running build
      const runningBuild: RunningBuild = {
        request,
        promise: buildPromise,
        startTime
      };
      
      this.runningBuilds.set(targetName, runningBuild);
      
      // Wait for completion
      const result = await buildPromise;
      
      // Handle completion
      this.handleBuildCompletion(targetName, result, startTime);
      
    } catch (error) {
      this.logger.error(`Build failed for ${targetName}: ${error}`);
      
      // Create failure status
      const failureResult: BuildStatus = {
        targetName,
        status: 'failure',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime
      };
      
      this.handleBuildCompletion(targetName, failureResult, startTime);
    }
  }

  /**
   * Execute the actual build
   */
  private async executeBuild(request: QueuedBuild): Promise<BuildStatus> {
    const { target, builder } = request;
    
    // Update state to building
    await builder.updateBuildStatus({
      targetName: target.name,
      status: 'building',
      timestamp: new Date().toISOString()
    });

    // Execute the build
    return await builder.build();
  }

  /**
   * Handle build completion
   */
  private handleBuildCompletion(
    targetName: string, 
    result: BuildStatus, 
    startTime: number
  ): void {
    // Remove from running builds
    this.runningBuilds.delete(targetName);
    
    // Record metrics
    this.priorityEngine.recordBuildResult(targetName, result);
    this.updateStats(result, startTime);
    
    // Check for pending rebuild
    if (this.pendingRebuilds.has(targetName)) {
      this.pendingRebuilds.delete(targetName);
      
      // Find target and reschedule
      const target = Array.from(this.targetBuilders.keys())
        .find(name => name === targetName);
      
      if (target) {
        const targetObj = this.findTargetByName(targetName);
        if (targetObj) {
          this.logger.info(`Rescheduling build for ${targetName} due to pending changes`);
          this.scheduleTargetBuild(targetObj, ['pending changes']);
        }
      }
    }
    
    this.logger.info(`Build completed for ${targetName}: ${result.status} (${result.duration}ms)`);
    
    // Continue processing queue
    this.processQueue();
  }

  /**
   * Get current queue status
   */
  public getQueueStatus(): {
    pending: { target: string; priority: number; timestamp: number }[];
    running: { target: string; startTime: number; duration: number }[];
    stats: typeof this.queueStats;
  } {
    const now = Date.now();
    
    return {
      pending: this.pendingQueue.map(req => ({
        target: req.target.name,
        priority: req.priority,
        timestamp: req.timestamp
      })),
      running: Array.from(this.runningBuilds.values()).map(build => ({
        target: build.request.target.name,
        startTime: build.startTime,
        duration: now - build.startTime
      })),
      stats: { ...this.queueStats }
    };
  }

  /**
   * Get priority information for debugging
   */
  public getPriorityInfo(): {
    focus: { target: string; percentage: number; multiplier: number }[];
    queue: { target: string; priority: number; timestamp: number }[];
  } {
    return {
      focus: this.priorityEngine.getFocusInfo(),
      queue: this.pendingQueue.map(req => ({
        target: req.target.name,
        priority: req.priority,
        timestamp: req.timestamp
      }))
    };
  }

  /**
   * Cancel all pending builds for a target
   */
  public cancelPendingBuilds(targetName: string): number {
    const initialLength = this.pendingQueue.length;
    this.pendingQueue = this.pendingQueue.filter(req => req.target.name !== targetName);
    const cancelled = initialLength - this.pendingQueue.length;
    
    if (cancelled > 0) {
      this.logger.info(`Cancelled ${cancelled} pending builds for ${targetName}`);
    }
    
    return cancelled;
  }

  /**
   * Clear all queued builds
   */
  public clearQueue(): void {
    const cancelled = this.pendingQueue.length;
    this.pendingQueue = [];
    this.pendingRebuilds.clear();
    
    this.logger.info(`Cleared queue (${cancelled} builds cancelled)`);
  }

  // Private helper methods

  private sortQueue(): void {
    this.pendingQueue.sort((a, b) => b.priority - a.priority);
  }

  private generateRequestId(): string {
    return `build-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private findTargetByName(targetName: string): Target | undefined {
    return this.targets.get(targetName);
  }

  private updateStats(result: BuildStatus, startTime: number): void {
    this.queueStats.totalBuilds++;
    
    if (result.status === 'success') {
      this.queueStats.successfulBuilds++;
    } else {
      this.queueStats.failedBuilds++;
    }

    if (result.duration) {
      // Update rolling average build time
      const alpha = 0.1; // Exponential moving average factor
      this.queueStats.avgBuildTime = 
        this.queueStats.avgBuildTime * (1 - alpha) + result.duration * alpha;
    }
  }
}