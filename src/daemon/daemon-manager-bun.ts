// Bun-specific daemon spawning logic
export async function spawnBunDaemon(
  execPath: string,
  argsFile: string,
  projectRoot: string,
  logFile: string | undefined,
  logger: any
): Promise<number> {
  const BunRuntime = (globalThis as any).Bun;

  // Create a promise to wait for daemon startup
  let daemonStarted = false;

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      if (!daemonStarted) {
        reject(new Error('Daemon startup timeout after 10 seconds'));
      }
    }, 10000);

    try {
      // Use Bun.spawn with IPC
      const proc = BunRuntime.spawn([execPath, '--daemon-mode', argsFile], {
        cwd: projectRoot,
        env: process.env,
        stdio: ['ignore', logFile || 'pipe', logFile || 'pipe'],
        ipc: (message: any) => {
          // Handle IPC messages from daemon
          logger.debug('Received IPC message from daemon:', message);
          if (message.type === 'started' && message.pid) {
            daemonStarted = true;
            clearTimeout(timeoutId);
            resolve(message.pid);
          } else if (message.type === 'error') {
            clearTimeout(timeoutId);
            reject(new Error(message.error || 'Daemon startup failed'));
          }
        },
      });

      const pid = proc.pid;
      if (!pid) {
        clearTimeout(timeoutId);
        reject(new Error('Failed to start daemon process - no PID returned'));
        return;
      }

      // Detach from parent
      proc.unref();

      // Fallback: resolve if process is confirmed running after a short delay
      setTimeout(() => {
        if (!daemonStarted && pid) {
          daemonStarted = true;
          clearTimeout(timeoutId);
          resolve(pid);
        }
      }, 2000);
    } catch (error) {
      clearTimeout(timeoutId);
      reject(error);
    }
  });
}
