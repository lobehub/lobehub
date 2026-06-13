import { describe, expect, it } from 'vitest';

import { resolveOperationActivity, resolveOperationLoadingLabelKey } from './operationActivity';

describe('operationActivity', () => {
  describe('resolveOperationActivity', () => {
    it('maps tool sub-operations to the tool calling phase', () => {
      expect(resolveOperationActivity('createToolMessage')).toBe('toolCalling');
      expect(resolveOperationActivity('executeToolCall')).toBe('toolCalling');
      expect(resolveOperationActivity('pluginApi')).toBe('toolCalling');
      expect(resolveOperationActivity('builtinToolSearch')).toBe('toolCalling');
    });

    it('maps retrieval and generation sub-operations to user-facing phases', () => {
      expect(resolveOperationActivity('searchWorkflow')).toBe('searching');
      expect(resolveOperationActivity('rag')).toBe('searching');
      expect(resolveOperationActivity('callLLM')).toBe('generating');
      expect(resolveOperationActivity('createAssistantMessage')).toBe('generating');
      expect(resolveOperationActivity('generateSummary')).toBe('compressing');
    });

    it('does not expose container and bookkeeping operations as active phases', () => {
      expect(resolveOperationActivity('execAgentRuntime')).toBeUndefined();
      expect(resolveOperationActivity('subagentThread')).toBeUndefined();
    });
  });

  describe('resolveOperationLoadingLabelKey', () => {
    it('keeps explicit loading labels for top-level operation types', () => {
      expect(resolveOperationLoadingLabelKey('sendMessage')).toBe('operation.sendMessage');
      expect(resolveOperationLoadingLabelKey('execAgentRuntime')).toBe(
        'operation.execAgentRuntime',
      );
      expect(resolveOperationLoadingLabelKey('toolCalling')).toBe('operation.toolCalling');
    });

    it('falls back to activity labels for internal sub-operations', () => {
      expect(resolveOperationLoadingLabelKey('createToolMessage')).toBe(
        'opStatusTray.status.toolCalling',
      );
      expect(resolveOperationLoadingLabelKey('executeToolCall')).toBe(
        'opStatusTray.status.toolCalling',
      );
      expect(resolveOperationLoadingLabelKey('searchWorkflow')).toBe(
        'opStatusTray.status.searching',
      );
      expect(resolveOperationLoadingLabelKey('callLLM')).toBe('opStatusTray.status.generating');
    });

    it('returns undefined for internal operations without user-facing loading copy', () => {
      expect(resolveOperationLoadingLabelKey('subagentThread')).toBeUndefined();
    });
  });
});
