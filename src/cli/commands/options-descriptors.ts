import type { Command } from 'commander';
import type { CommandDescriptor } from './registry.js';

export const applyDescriptorOptions = (program: Command, descriptor: CommandDescriptor): Command => {
  const scoped = program;
  if (descriptor.options) {
    descriptor.options.forEach((opt) => {
      scoped.option(opt.flags, opt.description, opt.defaultValue as any);
    });
  }
  return scoped;
};
