/**
 * Path utilities that work with both regular execution and Bun compiled binaries
 * Provides __dirname and __filename equivalents without using import.meta.url
 * which breaks bytecode compilation
 */

import { dirname } from 'path';

/**
 * Get the directory name of the current module
 * Works around import.meta.url issues in Bun compiled binaries
 */
export function getDirname(): string {
  // In Bun compiled binaries, __dirname is available
  if (typeof __dirname !== 'undefined') {
    return __dirname;
  }

  // Try to use import.meta.url if available (non-compiled mode)
  // We wrap this in eval to prevent static analysis issues
  try {
    // biome-ignore lint/security/noGlobalEval: Required for Bun bytecode compilation compatibility
    const metaUrl = eval('import.meta.url');
    if (metaUrl) {
      return dirname(metaUrl.replace('file://', ''));
    }
  } catch {
    // import.meta not available
  }

  // Fallback to process.cwd() for compiled binaries
  return process.cwd();
}

/**
 * Get the filename of the current module
 * Works around import.meta.url issues in Bun compiled binaries
 */
export function getFilename(): string {
  // In Bun compiled binaries, __filename is available
  if (typeof __filename !== 'undefined') {
    return __filename;
  }

  // Try to use import.meta.url if available (non-compiled mode)
  try {
    // biome-ignore lint/security/noGlobalEval: Required for Bun bytecode compilation compatibility
    const metaUrl = eval('import.meta.url');
    if (metaUrl) {
      return metaUrl.replace('file://', '');
    }
  } catch {
    // import.meta not available
  }

  // Fallback to process.argv[1] for compiled binaries
  return process.argv[1] || 'unknown';
}

/**
 * Check if the current module is the main entry point
 * Works around import.meta.main issues in Bun compiled binaries
 */
export function isMainModule(): boolean {
  // Check various conditions to determine if this is the main module

  // For Node.js compatibility
  if (typeof require !== 'undefined' && require.main === module) {
    return true;
  }

  // Try import.meta.main if available
  try {
    // biome-ignore lint/security/noGlobalEval: Required for Bun bytecode compilation compatibility
    const metaMain = eval('import.meta.main');
    if (typeof metaMain === 'boolean') {
      return metaMain;
    }
  } catch {
    // import.meta not available
  }

  // Check if the filename matches process.argv[1]
  const filename = getFilename();
  const mainFile = process.argv[1];

  if (mainFile && filename) {
    // Handle various file extensions and path formats
    return (
      mainFile === filename ||
      mainFile.endsWith(filename) ||
      filename.endsWith(mainFile) ||
      mainFile.replace(/\.(js|ts)$/, '') === filename.replace(/\.(js|ts)$/, '')
    );
  }

  return false;
}

/**
 * Detect if running as a Bun compiled executable
 */
export function isCompiledBinary(): boolean {
  // Check for Bun's virtual filesystem paths
  if (process.argv[0]?.includes('/$bunfs/')) {
    return true;
  }

  // Check if process.execPath points to our binary (not 'bun')
  if (process.execPath && !process.execPath.endsWith('bun')) {
    return true;
  }

  // Check for the absence of import.meta (indicates compilation)
  try {
    // biome-ignore lint/security/noGlobalEval: Required for Bun bytecode compilation compatibility
    eval('import.meta.url');
    return false;
  } catch {
    // If import.meta is not available, likely compiled
    return true;
  }
}
