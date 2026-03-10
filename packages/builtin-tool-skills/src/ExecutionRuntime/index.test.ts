import { describe, expect, it, vi } from 'vitest';

import type { CommandResult } from '../types';
import { type SkillRuntimeService, SkillsExecutionRuntime } from './index';

const createMockService = (overrides?: Partial<SkillRuntimeService>): SkillRuntimeService => ({
  findAll: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  findById: vi.fn().mockResolvedValue(undefined),
  findByName: vi.fn().mockResolvedValue(undefined),
  readResource: vi.fn(),
  ...overrides,
});

describe('SkillsExecutionRuntime', () => {
  describe('execScript', () => {
    const args = { command: 'echo hello', description: 'test command' };

    describe('via execScript service method', () => {
      it('should return success: true when script succeeds', async () => {
        const service = createMockService({
          execScript: vi.fn().mockResolvedValue({
            exitCode: 0,
            output: 'hello',
            success: true,
          } satisfies CommandResult),
        });
        const runtime = new SkillsExecutionRuntime({ service });

        const result = await runtime.execScript(args);

        expect(result.success).toBe(true);
        expect(result.content).toBe('hello');
        expect(result.state).toEqual({ command: 'echo hello', exitCode: 0, success: true });
      });

      it('should return success: false when script fails with non-zero exit code', async () => {
        const service = createMockService({
          execScript: vi.fn().mockResolvedValue({
            exitCode: 1,
            output: '',
            stderr: 'command not found',
            success: false,
          } satisfies CommandResult),
        });
        const runtime = new SkillsExecutionRuntime({ service });

        const result = await runtime.execScript(args);

        expect(result.success).toBe(false);
        expect(result.content).toBe('command not found');
        expect(result.state).toEqual({ command: 'echo hello', exitCode: 1, success: false });
      });

      it('should combine output and stderr', async () => {
        const service = createMockService({
          execScript: vi.fn().mockResolvedValue({
            exitCode: 0,
            output: 'stdout line',
            stderr: 'stderr line',
            success: true,
          } satisfies CommandResult),
        });
        const runtime = new SkillsExecutionRuntime({ service });

        const result = await runtime.execScript(args);

        expect(result.content).toBe('stdout line\nstderr line');
      });

      it('should return "(no output)" when output is empty', async () => {
        const service = createMockService({
          execScript: vi.fn().mockResolvedValue({
            exitCode: 0,
            output: '',
            success: true,
          } satisfies CommandResult),
        });
        const runtime = new SkillsExecutionRuntime({ service });

        const result = await runtime.execScript(args);

        expect(result.content).toBe('(no output)');
      });

      it('should return success: false when execScript throws', async () => {
        const service = createMockService({
          execScript: vi.fn().mockRejectedValue(new Error('sandbox timeout')),
        });
        const runtime = new SkillsExecutionRuntime({ service });

        const result = await runtime.execScript(args);

        expect(result.success).toBe(false);
        expect(result.content).toBe('Failed to execute command: sandbox timeout');
      });
    });

    describe('via runCommand fallback', () => {
      it('should return success: true when command succeeds', async () => {
        const service = createMockService({
          runCommand: vi.fn().mockResolvedValue({
            exitCode: 0,
            output: 'ok',
            success: true,
          } satisfies CommandResult),
        });
        const runtime = new SkillsExecutionRuntime({ service });

        const result = await runtime.execScript(args);

        expect(result.success).toBe(true);
        expect(result.content).toBe('ok');
      });

      it('should return success: false when command fails with non-zero exit code', async () => {
        const service = createMockService({
          runCommand: vi.fn().mockResolvedValue({
            exitCode: 127,
            output: '',
            stderr: 'not found',
            success: false,
          } satisfies CommandResult),
        });
        const runtime = new SkillsExecutionRuntime({ service });

        const result = await runtime.execScript(args);

        expect(result.success).toBe(false);
        expect(result.content).toBe('not found');
        expect(result.state).toEqual({ command: 'echo hello', exitCode: 127, success: false });
      });

      it('should return success: false when runCommand throws', async () => {
        const service = createMockService({
          runCommand: vi.fn().mockRejectedValue(new Error('connection lost')),
        });
        const runtime = new SkillsExecutionRuntime({ service });

        const result = await runtime.execScript(args);

        expect(result.success).toBe(false);
        expect(result.content).toBe('Failed to execute command: connection lost');
      });

      it('should return success: false when neither execScript nor runCommand is available', async () => {
        const service = createMockService();
        const runtime = new SkillsExecutionRuntime({ service });

        const result = await runtime.execScript(args);

        expect(result.success).toBe(false);
        expect(result.content).toBe('Command execution is not available in this environment.');
      });
    });
  });
});
