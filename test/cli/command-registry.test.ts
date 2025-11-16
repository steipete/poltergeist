import { describe, expect, it } from 'vitest';
import { COMMAND_DESCRIPTORS } from '../../src/cli/commands/registry.js';
import { collectRegisteredNames, expandDescriptorNames } from './registry-utils.js';

describe('command registry', () => {
  it('covers all registered commands', () => {
    const registered = Array.from(collectRegisteredNames()).sort();
    const described = expandDescriptorNames(COMMAND_DESCRIPTORS).sort();
    expect(described).toEqual(registered);
  });
});
