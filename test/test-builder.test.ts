import { describe, expect, test, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { TestBuilder } from '../src/builders/test-builder.js';
import { BuilderFactory } from '../src/builders/index.js';
import { createLogger } from '../src/logger.js';
import type { TestTarget } from '../src/types.js';

const logger = createLogger();
const projectRoot = process.cwd();
const stateManager = {
  initializeState: () => Promise.resolve(undefined),
  updateBuildStatus: () => Promise.resolve(undefined),
  updateAppInfo: () => Promise.resolve(undefined),
  updateBuildError: () => Promise.resolve(undefined),
  forceUnlock: () => Promise.resolve(false),
  isLocked: () => Promise.resolve(false),
} as any;

describe('TestBuilder', () => {
  let outputFile: string;
  let target: TestTarget;

  beforeEach(() => {
    outputFile = path.join(os.tmpdir(), `poltergeist-test-builder-${Date.now()}.txt`);
    target = {
      name: 'unit-tests',
      type: 'test',
      enabled: true,
      testCommand: "node -e \"const fs=require('fs');fs.writeFileSync(process.env.TEST_OUTPUT,'ran')\"",
      watchPaths: ['src/**/*.ts'],
      environment: {
        TEST_OUTPUT: outputFile,
      },
    };
    if (fs.existsSync(outputFile)) {
      fs.unlinkSync(outputFile);
    }
  });

  afterEach(() => {
    if (fs.existsSync(outputFile)) {
      fs.unlinkSync(outputFile);
    }
  });

  test('executes provided test command', async () => {
    const builder = new TestBuilder(target, projectRoot, logger, stateManager);
    await builder.build(['src/foo.ts']);

    expect(fs.existsSync(outputFile)).toBe(true);
    expect(fs.readFileSync(outputFile, 'utf8')).toBe('ran');
  });

  test('builder factory returns TestBuilder for test targets', () => {
    const builder = BuilderFactory.createBuilder(target, projectRoot, logger, stateManager);
    expect(builder).toBeInstanceOf(TestBuilder);
  });
});
