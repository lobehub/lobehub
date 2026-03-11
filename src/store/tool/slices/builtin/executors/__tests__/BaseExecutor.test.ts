/**
 * Tests for BaseExecutor
 */
import { type BuiltinToolContext, type BuiltinToolResult } from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

// Test API enum
const TestApiName = {
  methodA: 'methodA',
  methodB: 'methodB',
} as const;

// Test executor implementation
class TestExecutor extends BaseExecutor<typeof TestApiName> {
  readonly identifier = 'test-executor';
  protected readonly apiEnum = TestApiName;

  methodA = async (
    params: { value: string },
    _ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return {
      content: `Received: ${params.value}`,
      success: true,
    };
  };

  methodB = async (
    params: { count: number },
    _ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return {
      content: `Count: ${params.count}`,
      state: { count: params.count },
      success: true,
    };
  };
}

// Test executor with missing method implementation
class IncompleteExecutor extends BaseExecutor<typeof TestApiName> {
  readonly identifier = 'incomplete-executor';
  protected readonly apiEnum = TestApiName;

  // Only implements methodA, methodB is missing
  methodA = async (_params: any, _ctx: BuiltinToolContext): Promise<BuiltinToolResult> => {
    return { success: true };
  };
}

describe('BaseExecutor', () => {
  const createContext = (): BuiltinToolContext => ({
    messageId: 'test-message-id',
    operationId: 'test-operation-id',
  });

  describe('identifier', () => {
    it('should have correct identifier', () => {
      const executor = new TestExecutor();
      expect(executor.identifier).toBe('test-executor');
    });
  });

  describe('hasApi', () => {
    it('should return true for supported APIs', () => {
      const executor = new TestExecutor();
      expect(executor.hasApi('methodA')).toBe(true);
      expect(executor.hasApi('methodB')).toBe(true);
    });

    it('should return false for unsupported APIs', () => {
      const executor = new TestExecutor();
      expect(executor.hasApi('unknownMethod')).toBe(false);
      expect(executor.hasApi('')).toBe(false);
    });
  });

  describe('getApiNames', () => {
    it('should return all supported API names', () => {
      const executor = new TestExecutor();
      const apiNames = executor.getApiNames();
      expect(apiNames).toContain('methodA');
      expect(apiNames).toContain('methodB');
      expect(apiNames).toHaveLength(2);
    });
  });

  describe('invoke', () => {
    it('should invoke methodA successfully', async () => {
      const executor = new TestExecutor();
      const result = await executor.invoke('methodA', { value: 'test' }, createContext());

      expect(result.success).toBe(true);
      expect(result.content).toBe('Received: test');
    });

    it('should invoke methodB successfully', async () => {
      const executor = new TestExecutor();
      const result = await executor.invoke('methodB', { count: 42 }, createContext());

      expect(result.success).toBe(true);
      expect(result.content).toBe('Count: 42');
      expect(result.state).toEqual({ count: 42 });
    });

    it('should return error for unknown API', async () => {
      const executor = new TestExecutor();
      const result = await executor.invoke('unknownMethod', {}, createContext());

      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('ApiNotFound');
      expect(result.error?.message).toBe('Unknown API: unknownMethod');
    });

    it('should return error for unimplemented method', async () => {
      const executor = new IncompleteExecutor();
      // methodB is in apiEnum but not implemented
      // First, let's hack the apiEnum to include methodB
      (executor as any).apiEnum = { ...TestApiName };

      const result = await executor.invoke('methodB', {}, createContext());

      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('MethodNotImplemented');
      expect(result.error?.message).toBe('Method not implemented: methodB');
    });
  });
});
