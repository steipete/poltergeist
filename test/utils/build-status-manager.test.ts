import { describe, expect, it } from 'vitest';
import {
  BuildStatusManager,
  BuildStatusType,
} from '../../src/utils/build-status-manager.js';

describe('BuildStatusManager', () => {
  it('creates success, failure, and building statuses with defaults', () => {
    const success = BuildStatusManager.createSuccessStatus('api', { duration: 1200 });
    expect(success.status).toBe(BuildStatusType.SUCCESS);
    expect(success.duration).toBe(1200);
    expect(success.buildTime).toBeCloseTo(1.2, 5);

    const failure = BuildStatusManager.createFailureStatus(
      'ui',
      { message: 'Oops', summary: 'Compilation failed' },
      { duration: 500 }
    );
    expect(failure.status).toBe(BuildStatusType.FAILED);
    expect(failure.error).toBe('Oops');
    expect(failure.errorSummary).toBe('Compilation failed');

    const building = BuildStatusManager.createBuildingStatus('daemon');
    expect(building.status).toBe(BuildStatusType.BUILDING);
    expect(building.duration).toBe(0);
  });

  it('respects optional metadata when creating statuses', () => {
    const success = BuildStatusManager.createSuccessStatus(
      'lib',
      { duration: 500 },
      { gitHash: 'abc123', builder: 'daemon', buildTime: 0.25 }
    );
    expect(success.gitHash).toBe('abc123');
    expect(success.builder).toBe('daemon');
    expect(success.buildTime).toBe(0.25);

    const failure = BuildStatusManager.createFailureStatus(
      'lib',
      { message: 'boom' },
      { duration: 100 },
      { builder: 'daemon' }
    );
    expect(failure.builder).toBe('daemon');
    expect(failure.duration).toBe(100);
  });

  it('detects status helpers correctly', () => {
    const success = BuildStatusManager.createSuccessStatus('api', { duration: 0 });
    const failure = BuildStatusManager.createFailureStatus(
      'api',
      { message: 'fail' },
      {}
    );
    const building = BuildStatusManager.createBuildingStatus('api');

    expect(BuildStatusManager.isSuccess(success)).toBe(true);
    expect(BuildStatusManager.isFailure(failure)).toBe(true);
    expect(BuildStatusManager.isBuilding(building)).toBe(true);
    expect(BuildStatusManager.isSuccess(BuildStatusType.SUCCESS)).toBe(true);
  });

  it('extracts meaningful error summaries from compiler output', () => {
    const tsSummary = BuildStatusManager.extractErrorSummary(
      'error TS1234: Type mismatch\nMore context'
    );
    expect(tsSummary).toContain('TS1234');

    const swiftSummary = BuildStatusManager.extractErrorSummary('error: build failed');
    expect(swiftSummary).toBe('error: build failed');

    const generic = BuildStatusManager.extractErrorSummary('Error building target foo');
    expect(generic).toContain('Error building');

    const fallback = BuildStatusManager.extractErrorSummary('\n\nSomething\n');
    expect(fallback).toBe('Something');
  });

  it('categorizes error types based on output', () => {
    expect(
      BuildStatusManager.categorizeError('error TS1111: Cannot find name Foo')
    ).toBe('compilation');
    expect(BuildStatusManager.categorizeError('Runtime error in module')).toBe('runtime');
    expect(BuildStatusManager.categorizeError('Configuration missing')).toBe('configuration');
    expect(BuildStatusManager.categorizeError('Unknown crash')).toBe('unknown');
  });

  it('formats durations, notifications, exit codes, and validates status info', () => {
    expect(BuildStatusManager.formatDuration(450)).toBe('450ms');
    expect(BuildStatusManager.formatDuration(2400)).toBe('2.4s');
    expect(BuildStatusManager.formatDuration(65000)).toBe('1m 5.0s');

    const metrics = BuildStatusManager.createMetrics(0, 1500, 1, 'output', 'bin/app');
    expect(metrics.duration).toBe(1500);
    expect(metrics.outputInfo).toBe('bin/app');

    const success = BuildStatusManager.createSuccessStatus('api', { duration: 1500 });
    const failure = BuildStatusManager.createFailureStatus(
      'api',
      { message: 'Boom', summary: 'Error detail' },
      { duration: 2500 }
    );
    const pending = BuildStatusManager.createBuildingStatus('api');

    expect(BuildStatusManager.formatNotificationMessage(success, 'bin/api')).toContain(
      'Built: bin/api'
    );
    expect(BuildStatusManager.formatNotificationMessage(failure)).toContain('Build failed');
    expect(BuildStatusManager.formatNotificationMessage(pending)).toContain('Build status');

    expect(BuildStatusManager.getErrorMessage(failure)).toBe('Error detail');
    expect(BuildStatusManager.getErrorMessage(pending)).toBe('Build failed');

    expect(BuildStatusManager.interpretExitCode(0)).toBe('Success');
    expect(BuildStatusManager.interpretExitCode(127)).toContain('Command not found');
    expect(BuildStatusManager.interpretExitCode(130)).toContain('Ctrl+C');
    expect(BuildStatusManager.interpretExitCode(143)).toContain('signal 15');

    expect(BuildStatusManager.isValidStatus('success')).toBe(true);
    expect(BuildStatusManager.isValidStatus('bogus')).toBe(false);

    expect(BuildStatusManager.getStatusColor(success)).toBe('green');
    expect(BuildStatusManager.getStatusColor(failure)).toBe('red');
    expect(BuildStatusManager.getStatusColor(pending)).toBe('yellow');
    expect(BuildStatusManager.getStatusColor(BuildStatusType.IDLE)).toBe('blue');
    expect(BuildStatusManager.getStatusColor('unknown')).toBe('gray');
  });
});
