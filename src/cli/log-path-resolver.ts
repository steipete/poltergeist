import { existsSync } from 'fs';
import path from 'path';
import type { PoltergeistConfig, Target } from '../types.js';
import { FileSystemUtils } from '../utils/filesystem.js';
import { DEFAULT_LOG_CHANNEL, sanitizeLogChannel } from '../utils/log-channels.js';

export interface ResolveLogPathOptions {
  config: PoltergeistConfig;
  projectRoot: string;
  targetName?: string;
  channel?: string;
}

export interface ResolvedLogPath {
  logFile?: string;
  target?: string;
  usedFallback: boolean;
  channel: string;
}

export const resolveLogPath = (input: ResolveLogPathOptions): ResolvedLogPath => {
  const channel = sanitizeLogChannel(input.channel ?? DEFAULT_LOG_CHANNEL);
  const { config, projectRoot } = input;
  let target = input.targetName;

  const res: ResolvedLogPath = {
    logFile: undefined,
    target,
    usedFallback: false,
    channel,
  };

  if (!target) {
    const enabledTargets = config.targets.filter((t) => t.enabled !== false);
    if (enabledTargets.length === 1) {
      target = enabledTargets[0].name;
    }
  }

  // Try target-specific log file if configured
  const targetConfig: Target | undefined = target
    ? config.targets.find((t) => t.name === target)
    : undefined;

  const resolveConfigLogPath = (): string | undefined => {
    if (!targetConfig) return undefined;
    if ('logPath' in targetConfig && typeof (targetConfig as any).logPath === 'string') {
      return (targetConfig as any).logPath as string;
    }
    if ('outputPath' in targetConfig && targetConfig.outputPath)
      return `${targetConfig.outputPath}.log`;
    return undefined;
  };

  const candidateLogFiles: Array<string | undefined> = [];

  const targetLogPath = resolveConfigLogPath();
  if (target && targetLogPath) {
    candidateLogFiles.push(
      targetLogPath.startsWith('~/')
        ? targetLogPath.replace('~', process.env.HOME || '')
        : path.isAbsolute(targetLogPath)
          ? targetLogPath
          : path.join(projectRoot, targetLogPath)
    );
  }

  if (target) {
    candidateLogFiles.push(FileSystemUtils.getLogFilePath(projectRoot, target, channel));
    candidateLogFiles.push(path.join(projectRoot, `${target}.log`));
    candidateLogFiles.push(path.join(projectRoot, `.poltergeist-${target}.log`));
  }

  // Global fallbacks
  candidateLogFiles.push(
    config.logging?.file ? path.resolve(projectRoot, config.logging.file) : undefined
  );
  candidateLogFiles.push(path.join(projectRoot, '.poltergeist.log'));

  const uniqueCandidates = candidateLogFiles
    .filter((filePath): filePath is string => typeof filePath === 'string' && filePath.length > 0)
    .filter((filePath, index, self) => self.indexOf(filePath) === index);

  const found = uniqueCandidates.find((file) => existsSync(file));

  res.logFile = found;
  res.target = target;
  res.usedFallback = Boolean(found && target && found !== targetLogPath);

  return res;
};
