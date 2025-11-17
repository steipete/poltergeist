import { spawn } from 'child_process';

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  allowNonZeroExit?: boolean;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface CommandRunner {
  run(command: string, args?: string[], options?: RunOptions): Promise<RunResult>;
}

export class ChildProcessRunner implements CommandRunner {
  async run(command: string, args: string[] = [], options: RunOptions = {}): Promise<RunResult> {
    const { cwd, env, allowNonZeroExit = false } = options;
    return new Promise<RunResult>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        env,
        shell: false,
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        const exitCode = code ?? 0;
        if (exitCode !== 0 && !allowNonZeroExit) {
          reject(new Error(`Command failed: ${command} ${args.join(' ')}\n${stderr}`));
          return;
        }
        resolve({ stdout, stderr, exitCode });
      });

      child.on('error', (error) => {
        reject(error);
      });
    });
  }
}
