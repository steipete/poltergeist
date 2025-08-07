import { describe, expect, it } from 'vitest';
import { Command } from 'commander';
import {
  POLTER_OPTIONS,
  configurePolterCommand,
  getPolterDescription,
  parsePolterOptions,
} from '../src/cli-shared/polter-command.js';

describe('Shared Polter Command Configuration', () => {
  describe('POLTER_OPTIONS', () => {
    it('should define all required options', () => {
      const optionFlags = POLTER_OPTIONS.map(opt => opt.flag);
      
      expect(optionFlags).toContain('-t, --timeout <ms>');
      expect(optionFlags).toContain('-f, --force');
      expect(optionFlags).toContain('-n, --no-wait');
      expect(optionFlags).toContain('--verbose');
      expect(optionFlags).toContain('--no-logs');
      expect(optionFlags).toContain('--log-lines <number>');
    });

    it('should have proper default values', () => {
      const timeoutOption = POLTER_OPTIONS.find(opt => opt.flag.includes('--timeout'));
      expect(timeoutOption?.defaultValue).toBe('300000');
      
      const forceOption = POLTER_OPTIONS.find(opt => opt.flag.includes('--force'));
      expect(forceOption?.defaultValue).toBe(false);
      
      const logLinesOption = POLTER_OPTIONS.find(opt => opt.flag.includes('--log-lines'));
      expect(logLinesOption?.defaultValue).toBe('5');
    });
  });

  describe('parsePolterOptions', () => {
    it('should parse timeout as number', () => {
      const options = {
        timeout: '5000',
        force: false,
        wait: true,
        verbose: false,
        logs: true,
        logLines: '10',
      };
      
      const parsed = parsePolterOptions(options);
      
      expect(parsed.timeout).toBe(5000);
      expect(typeof parsed.timeout).toBe('number');
    });

    it('should handle --no-wait correctly', () => {
      const optionsWithWait = {
        timeout: '5000',
        force: false,
        wait: true, // wait is true
        verbose: false,
        logs: true,
        logLines: '10',
      };
      
      const parsedWithWait = parsePolterOptions(optionsWithWait);
      expect(parsedWithWait.noWait).toBe(false); // noWait should be false
      
      const optionsNoWait = {
        ...optionsWithWait,
        wait: false, // --no-wait sets wait to false
      };
      
      const parsedNoWait = parsePolterOptions(optionsNoWait);
      expect(parsedNoWait.noWait).toBe(true); // noWait should be true
    });

    it('should handle --no-logs correctly', () => {
      const optionsWithLogs = {
        timeout: '5000',
        force: false,
        wait: true,
        verbose: false,
        logs: true, // logs enabled
        logLines: '10',
      };
      
      const parsedWithLogs = parsePolterOptions(optionsWithLogs);
      expect(parsedWithLogs.showLogs).toBe(true);
      
      const optionsNoLogs = {
        ...optionsWithLogs,
        logs: false, // --no-logs sets logs to false
      };
      
      const parsedNoLogs = parsePolterOptions(optionsNoLogs);
      expect(parsedNoLogs.showLogs).toBe(false);
    });

    it('should parse log lines as number', () => {
      const options = {
        timeout: '5000',
        force: false,
        wait: true,
        verbose: false,
        logs: true,
        logLines: '25',
      };
      
      const parsed = parsePolterOptions(options);
      
      expect(parsed.logLines).toBe(25);
      expect(typeof parsed.logLines).toBe('number');
    });
  });

  describe('configurePolterCommand', () => {
    it('should add all options to a command', () => {
      const command = new Command('test');
      
      configurePolterCommand(command);
      
      // Get all options from the command
      const commandOptions = command.options;
      const optionFlags = commandOptions.map(opt => opt.flags);
      
      expect(optionFlags).toContain('-t, --timeout <ms>');
      expect(optionFlags).toContain('-f, --force');
      expect(optionFlags).toContain('-n, --no-wait');
      expect(optionFlags).toContain('--verbose');
      expect(optionFlags).toContain('--no-logs');
      expect(optionFlags).toContain('--log-lines <number>');
    });

    it('should set allowUnknownOption', () => {
      const command = new Command('test');
      
      configurePolterCommand(command);
      
      // Commander stores this in _allowUnknownOption
      expect((command as any)._allowUnknownOption).toBe(true);
    });
  });

  describe('getPolterDescription', () => {
    it('should return the standard description', () => {
      const description = getPolterDescription();
      
      expect(description).toBe('Execute fresh binaries managed by Poltergeist');
    });
  });
});