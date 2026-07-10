import { describe, expect, it } from 'vitest';

import { type OperationType } from '@/store/chat/slices/operation/types';

import { resolveOperationActivity } from './operationActivity';

describe('resolveOperationActivity', () => {
  it('maps tool-related ops (including bookkeeping ones) to toolCalling', () => {
    const toolOps: OperationType[] = [
      'toolCalling',
      'executeToolCall',
      'createToolMessage',
      'pluginApi',
      'builtinToolSearch',
      'builtinToolInterpreter',
      'builtinToolPageAgent',
    ];
    for (const type of toolOps) {
      expect(resolveOperationActivity(type)).toBe('toolCalling');
    }
  });

  it('maps retrieval ops to searching', () => {
    expect(resolveOperationActivity('rag')).toBe('searching');
    expect(resolveOperationActivity('searchWorkflow')).toBe('searching');
  });

  it('maps compression ops to compressing', () => {
    expect(resolveOperationActivity('contextCompression')).toBe('compressing');
    expect(resolveOperationActivity('generateSummary')).toBe('compressing');
  });

  it('maps generation ops to generating', () => {
    const genOps: OperationType[] = [
      'callLLM',
      'groupAgentStream',
      'createAssistantMessage',
      'supervisorDecision',
    ];
    for (const type of genOps) {
      expect(resolveOperationActivity(type)).toBe('generating');
    }
  });

  it('maps reasoning to reasoning', () => {
    expect(resolveOperationActivity('reasoning')).toBe('reasoning');
  });

  it('returns undefined for container/runtime and other unmapped ops', () => {
    const unmapped: OperationType[] = [
      'execAgentRuntime',
      'execHeterogeneousAgent',
      'execServerAgentRuntime',
      'sendMessage',
      'translate',
    ];
    for (const type of unmapped) {
      expect(resolveOperationActivity(type)).toBeUndefined();
    }
  });
});
