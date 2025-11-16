import chalk from 'chalk';
import type { StatusObject } from '../status/types.js';

export function formatStatus(status: string): string {
  switch (status) {
    case 'success':
      return chalk.green('✅ Success');
    case 'failure':
      return chalk.red('❌ Failed');
    case 'building':
      return chalk.yellow('🔨 Building');
    case 'watching':
      return chalk.blue('👀 Watching');
    default:
      return chalk.gray(status);
  }
}

export function printBuildLockHints(targetName: string): void {
  const writer = process.stdout.isTTY ? console.error : console.log;
  writer(chalk.yellow(`⚠️  Build already running for '${targetName}'.`));
  writer(`   Attach logs: poltergeist logs ${targetName} -f`);
  writer(`   Wait for result: poltergeist wait ${targetName}`);
  writer(`   Force rebuild: poltergeist build ${targetName} --force`);
}

export function formatTargetStatus(name: string, status: unknown, verbose?: boolean): void {
  const statusObj = status as StatusObject;
  console.log(chalk.cyan(`Target: ${name}`));
  console.log(`  Status: ${formatStatus(statusObj.status || 'unknown')}`);

  const formatShortDuration = (ms?: number): string | undefined => {
    if (!ms || ms <= 0) {
      return undefined;
    }
    if (ms < 1000) {
      return `${ms}ms`;
    }
    const totalSeconds = Math.round(ms / 1000);
    if (totalSeconds < 60) {
      return `${totalSeconds}s`;
    }
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (seconds === 0) {
      return `${minutes}m`;
    }
    return `${minutes}m ${seconds}s`;
  };

  // Process information
  if (statusObj.process) {
    const { pid, hostname, isActive, lastHeartbeat } = statusObj.process;
    if (isActive) {
      console.log(`  Process: ${chalk.green(`Running (PID: ${pid} on ${hostname})`)}`);
      const heartbeatAge = lastHeartbeat ? Date.now() - new Date(lastHeartbeat).getTime() : 0;
      const heartbeatStatus =
        heartbeatAge < 30000 ? chalk.green('✓ Active') : chalk.yellow('⚠ Stale');
      console.log(`  Heartbeat: ${heartbeatStatus} (${Math.round(heartbeatAge / 1000)}s ago)`);

      // Show uptime in verbose mode
      if (verbose && statusObj.process.startTime) {
        const uptime = Date.now() - new Date(statusObj.process.startTime).getTime();
        const uptimeMinutes = Math.floor(uptime / 60000);
        const uptimeSeconds = Math.floor((uptime % 60000) / 1000);
        console.log(`  Uptime: ${uptimeMinutes}m ${uptimeSeconds}s`);
      }
    } else {
      console.log(`  Process: ${chalk.gray('Not running')}`);
    }
  } else if (statusObj.pid) {
    // Legacy format
    console.log(`  Process: ${chalk.green(`Running (PID: ${statusObj.pid})`)}`);
  } else {
    console.log(`  Process: ${chalk.gray('Not running')}`);
  }

  // Build information
  if (statusObj.lastBuild) {
    console.log(`  Last Build: ${new Date(statusObj.lastBuild.timestamp).toLocaleString()}`);
    console.log(`  Build Status: ${formatStatus(statusObj.lastBuild.status)}`);

    // Show build command if building
    if (statusObj.lastBuild.status === 'building' && statusObj.buildCommand) {
      console.log(`  Command: ${statusObj.buildCommand}`);
    }

    if (statusObj.lastBuild.duration) {
      console.log(`  Build Time: ${statusObj.lastBuild.duration}ms`);
    }

    // Show elapsed time and estimate if building
    if (statusObj.lastBuild.status === 'building') {
      const elapsed = Date.now() - new Date(statusObj.lastBuild.timestamp).getTime();
      const elapsedSec = Math.round(elapsed / 1000);
      let timeInfo = `  Elapsed: ${elapsedSec}s`;

      // Add estimate if we have build statistics
      if (statusObj.buildStats?.averageDuration) {
        const avgSec = Math.round(statusObj.buildStats.averageDuration / 1000);
        const remainingSec = Math.max(0, avgSec - elapsedSec);
        timeInfo += ` / ~${avgSec}s (${remainingSec}s remaining)`;
      }

      console.log(timeInfo);
    }

    if (statusObj.lastBuild.gitHash) {
      console.log(`  Git Hash: ${statusObj.lastBuild.gitHash}`);
    }
    if (statusObj.lastBuild.builder) {
      console.log(`  Builder: ${statusObj.lastBuild.builder}`);
    }
    if (statusObj.lastBuild.errorSummary) {
      console.log(`  Error: ${chalk.red(statusObj.lastBuild.errorSummary)}`);
    } else if (statusObj.lastBuild.error) {
      console.log(`  Error: ${chalk.red(statusObj.lastBuild.error)}`);
    }

    // Show verbose build details
    if (verbose) {
      if (statusObj.lastBuild.exitCode !== undefined) {
        console.log(`  Exit Code: ${statusObj.lastBuild.exitCode}`);
      }
      if (statusObj.buildCommand) {
        console.log(`  Build Command: ${chalk.gray(statusObj.buildCommand)}`);
      }
    }
  }

  // App information
  if (statusObj.appInfo) {
    if (statusObj.appInfo.bundleId) {
      console.log(`  Bundle ID: ${statusObj.appInfo.bundleId}`);
    }
    if (statusObj.appInfo.outputPath) {
      console.log(`  Output: ${statusObj.appInfo.outputPath}`);
    }
    if (statusObj.appInfo.iconPath) {
      console.log(`  Icon: ${statusObj.appInfo.iconPath}`);
    }
  }

  // Build statistics (verbose mode)
  if (verbose && statusObj.buildStats) {
    console.log(chalk.gray('  Build Statistics:'));
    if (statusObj.buildStats.averageDuration) {
      console.log(
        `    Average Duration: ${Math.round(statusObj.buildStats.averageDuration / 1000)}s`
      );
    }
    if (statusObj.buildStats.minDuration !== undefined) {
      console.log(`    Min Duration: ${Math.round(statusObj.buildStats.minDuration / 1000)}s`);
    }
    if (statusObj.buildStats.maxDuration !== undefined) {
      console.log(`    Max Duration: ${Math.round(statusObj.buildStats.maxDuration / 1000)}s`);
    }
    if (statusObj.buildStats.successfulBuilds && statusObj.buildStats.successfulBuilds.length > 0) {
      console.log(`    Recent Successful Builds:`);
      statusObj.buildStats.successfulBuilds.slice(0, 3).forEach((build) => {
        const timestamp = new Date(build.timestamp).toLocaleTimeString();
        const duration = Math.round(build.duration / 1000);
        console.log(`      - ${timestamp}: ${duration}s`);
      });
    }
  }

  if (statusObj.postBuild?.length) {
    console.log('  Post-build tasks:');
    statusObj.postBuild.forEach((result) => {
      const summary =
        result.summary || `${result.name}: ${result.status ?? 'pending'}`.replace(/\s+/g, ' ');
      const duration = formatShortDuration(result.durationMs);
      const exitInfo = result.exitCode !== undefined ? chalk.dim(` (exit ${result.exitCode})`) : '';
      console.log(`    - ${summary}${duration ? chalk.dim(` [${duration}]`) : ''}${exitInfo}`);
      result.lines?.slice(0, 3).forEach((line) => {
        console.log(chalk.gray(`      ${line}`));
      });
    });
  }

  // Pending files
  if (statusObj.pendingFiles !== undefined && statusObj.pendingFiles > 0) {
    console.log(`  Pending Files: ${chalk.yellow(statusObj.pendingFiles)}`);
  }

  // Show agent instructions if not in TTY and building
  if (!process.stdout.isTTY && statusObj.lastBuild?.status === 'building') {
    console.log();
    if (statusObj.buildStats?.averageDuration) {
      const avgSec = Math.round(statusObj.buildStats.averageDuration / 1000);
      const recommendedTimeout = avgSec + 30; // Add 30s buffer
      console.log(`Use 'poltergeist wait ${name}' (timeout: ${recommendedTimeout}s recommended)`);
    } else {
      console.log(`Use 'poltergeist wait ${name}'`);
    }
    console.log(`Or 'poltergeist logs ${name} -f' for detailed output.`);
    console.log(`DO NOT run build commands manually unless build fails.`);
  }
}
