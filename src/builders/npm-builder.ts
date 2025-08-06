// Builder for NPM/Node.js/TypeScript projects
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import type { NPMTarget } from '../types.js';
import { BaseBuilder } from './base-builder.js';

export class NPMBuilder extends BaseBuilder<NPMTarget> {
  private packageManager: 'npm' | 'yarn' | 'pnpm' | 'bun';
  private buildScript: string;

  constructor(target: NPMTarget, projectRoot: string, logger: any, stateManager: any) {
    super(target, projectRoot, logger, stateManager);
    this.packageManager = this.detectPackageManager();
    this.buildScript = target.buildScript || 'build';
  }

  private detectPackageManager(): 'npm' | 'yarn' | 'pnpm' | 'bun' {
    // If explicitly specified and not 'auto', use that
    if (this.target.packageManager && this.target.packageManager !== 'auto') {
      return this.target.packageManager;
    }

    // Auto-detect from lockfiles (order matters - prefer faster tools)
    if (existsSync(join(this.projectRoot, 'bun.lockb'))) {
      this.logger.info(`[${this.target.name}] Detected Bun from bun.lockb`);
      return 'bun';
    }
    if (existsSync(join(this.projectRoot, 'pnpm-lock.yaml'))) {
      this.logger.info(`[${this.target.name}] Detected pnpm from pnpm-lock.yaml`);
      return 'pnpm';
    }
    if (existsSync(join(this.projectRoot, 'yarn.lock'))) {
      this.logger.info(`[${this.target.name}] Detected Yarn from yarn.lock`);
      return 'yarn';
    }
    if (existsSync(join(this.projectRoot, 'package-lock.json'))) {
      this.logger.info(`[${this.target.name}] Detected npm from package-lock.json`);
      return 'npm';
    }

    // Default to npm
    this.logger.info(`[${this.target.name}] No lockfile found, defaulting to npm`);
    return 'npm';
  }

  public async validate(): Promise<void> {
    // Check if package.json exists
    const packageJsonPath = join(this.projectRoot, 'package.json');
    if (!existsSync(packageJsonPath)) {
      throw new Error(`Target ${this.target.name}: package.json not found in ${this.projectRoot}`);
    }

    // Check if package manager is available
    try {
      execSync(`${this.packageManager} --version`, { stdio: 'ignore' });
    } catch {
      throw new Error(
        `Target ${this.target.name}: ${this.packageManager} is not installed. ` +
        `Install via: ${this.getInstallInstructions()}`
      );
    }

    // Validate output paths are specified
    if (!this.target.outputPaths || this.target.outputPaths.length === 0) {
      throw new Error(`Target ${this.target.name}: outputPaths is required for npm targets`);
    }
  }

  private getInstallInstructions(): string {
    switch (this.packageManager) {
      case 'bun':
        return 'brew install oven-sh/bun/bun or curl -fsSL https://bun.sh/install | bash';
      case 'pnpm':
        return 'npm install -g pnpm or brew install pnpm';
      case 'yarn':
        return 'npm install -g yarn or brew install yarn';
      default:
        return 'Download from https://nodejs.org or brew install node';
    }
  }

  protected async preBuild(changedFiles: string[]): Promise<void> {
    // Check if package.json changed and auto-install is enabled
    const packageJsonChanged = changedFiles.some(f => f.endsWith('package.json'));
    const lockfileChanged = changedFiles.some(f => 
      f.endsWith('package-lock.json') || 
      f.endsWith('yarn.lock') || 
      f.endsWith('pnpm-lock.yaml') || 
      f.endsWith('bun.lockb')
    );

    if ((packageJsonChanged || lockfileChanged) && this.target.installOnChange !== false) {
      this.logger.info(`[${this.target.name}] Package files changed, running install...`);
      await this.runInstall();
    }
  }

  private async runInstall(): Promise<void> {
    const command = `${this.packageManager} install`;
    
    return new Promise((resolve, reject) => {
      this.logger.info(`[${this.target.name}] Running: ${command}`);
      
      try {
        execSync(command, {
          cwd: this.projectRoot,
          stdio: 'inherit',
          env: { ...process.env, ...this.target.environment }
        });
        this.logger.info(`[${this.target.name}] Install completed`);
        resolve();
      } catch (error) {
        reject(new Error(`Install failed: ${error}`));
      }
    });
  }

  protected async executeBuild(options: any): Promise<void> {
    const runCommand = this.packageManager === 'npm' ? 'npm run' : `${this.packageManager} run`;
    const command = `${runCommand} ${this.buildScript}`;
    
    return new Promise((resolve, reject) => {
      this.logger.info(`[${this.target.name}] Running: ${command}`);
      
      const startTime = Date.now();
      try {
        execSync(command, {
          cwd: this.projectRoot,
          stdio: options.captureLogs ? 'pipe' : 'inherit',
          env: { ...process.env, ...this.target.environment }
        });
        
        const duration = Date.now() - startTime;
        this.logger.info(`[${this.target.name}] Build completed in ${duration}ms`);
        resolve();
      } catch (error) {
        reject(new Error(`Build failed: ${error}`));
      }
    });
  }

  protected async postBuild(): Promise<void> {
    // Validate that all output paths exist
    if (this.target.outputPaths) {
      for (const outputPath of this.target.outputPaths) {
        const fullPath = join(this.projectRoot, outputPath);
        if (!existsSync(fullPath)) {
          throw new Error(`Expected output file not found: ${fullPath}`);
        }
        this.logger.info(`[${this.target.name}] Output verified: ${outputPath}`);
      }
    }
  }

  protected getBuilderName(): string {
    return `NPM-${this.packageManager}`;
  }

  public getOutputInfo(): string {
    // Return the first output path as primary output
    if (this.target.outputPaths && this.target.outputPaths.length > 0) {
      return join(this.projectRoot, this.target.outputPaths[0]);
    }
    return '';
  }
}