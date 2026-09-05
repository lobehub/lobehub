import { countContextTokens } from '@lobechat/context-engine';
import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  bucketMessageTokensByRole,
  getToolContextRefreshKey,
  getToolExcludeDefaultToolIds,
} from './utils';

describe('bucketMessageTokensByRole', () => {
  it('attributes content by role and everything tool-related to the tool bucket', () => {
    const buckets = bucketMessageTokensByRole([
      { bySource: { content: 10 }, index: 0, role: 'user', total: 10 },
      {
        bySource: { content: 20, reasoning: 5, thoughtSignature: 2, toolCalls: 30, toolResult: 40 },
        index: 1,
        role: 'assistant',
        total: 97,
      },
      { bySource: { content: 7, toolCallId: 3 }, index: 2, role: 'tool', total: 10 },
    ]);

    expect(buckets).toEqual({ assistant: 25, tool: 82, user: 10 });
  });

  it('counts tool calls, results, and reasoning on agent messages (regression)', () => {
    // Regression: the context-window panel used to join `message.content`
    // strings only, so a tool-heavy agent conversation reported almost zero
    // chat tokens. Feeding real accounting through the role buckets must
    // surface the tool payloads.
    const messages = [
      { content: 'do the thing', id: 'u1', role: 'user' },
      {
        content: 'on it',
        id: 'a1',
        reasoning: { content: 'let me think about this step by step '.repeat(20) },
        role: 'assistant',
        tools: [
          {
            apiName: 'readFile',
            arguments: JSON.stringify({ path: '/very/long/path'.repeat(30) }),
            id: 'call-1',
            identifier: 'fs',
            result: { content: 'file contents '.repeat(200) },
            type: 'default',
          },
        ],
      },
    ] as unknown as UIChatMessage[];

    const buckets = bucketMessageTokensByRole(countContextTokens({ messages }).messages);

    expect(buckets.user).toBeGreaterThan(0);
    expect(buckets.assistant).toBeGreaterThan(buckets.user); // reasoning counted
    expect(buckets.tool).toBeGreaterThan(100); // arguments + result counted
  });
});

describe('Token tool utils', () => {
  describe('getToolContextRefreshKey', () => {
    it('changes when web search switches between off and application search', () => {
      const baseKey = getToolContextRefreshKey({
        agentId: 'agent-1',
        searchMode: 'off',
        useModelBuiltinSearch: false,
      });

      expect(
        getToolContextRefreshKey({
          agentId: 'agent-1',
          searchMode: 'auto',
          useModelBuiltinSearch: false,
        }),
      ).not.toBe(baseKey);
    });

    it('changes when web search switches between application and model builtin search', () => {
      const appSearchKey = getToolContextRefreshKey({
        agentId: 'agent-1',
        searchMode: 'auto',
        useModelBuiltinSearch: false,
      });

      expect(
        getToolContextRefreshKey({
          agentId: 'agent-1',
          searchMode: 'auto',
          useModelBuiltinSearch: true,
        }),
      ).not.toBe(appSearchKey);
    });

    it('changes when switching between chat and agent modes', () => {
      const chatModeKey = getToolContextRefreshKey({
        agentId: 'agent-1',
        enableAgentMode: false,
      });

      expect(
        getToolContextRefreshKey({
          agentId: 'agent-1',
          enableAgentMode: true,
        }),
      ).not.toBe(chatModeKey);
    });
  });

  describe('getToolExcludeDefaultToolIds', () => {
    it('excludes discovery tools in manual skill mode', () => {
      expect(getToolExcludeDefaultToolIds('manual')).toEqual(
        expect.arrayContaining(['lobe-activator', 'lobe-skill-store']),
      );
    });

    it('keeps default tools in auto skill mode', () => {
      expect(getToolExcludeDefaultToolIds('auto')).toBeUndefined();
    });
  });
});
