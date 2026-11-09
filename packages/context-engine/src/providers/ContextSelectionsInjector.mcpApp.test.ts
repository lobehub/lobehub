import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../types';
import { ContextSelectionsInjector } from './ContextSelectionsInjector';

describe('MCP App context feature gate', () => {
  it.each([false, true])(
    'injects app context only when mcpAppsEnabled=%s',
    async (mcpAppsEnabled) => {
      const context: PipelineContext = {
        initialState: { messages: [], model: 'test', provider: 'test' },
        isAborted: false,
        messages: [
          {
            content: 'Question',
            role: 'user',
            metadata: {
              contextSelections: [
                {
                  content: 'app-secret-selection',
                  id: 'a',
                  identifier: 'notes',
                  source: 'mcpApp',
                  title: 'Notes',
                },
                { content: 'normal-selection', id: 'b', source: 'text' },
              ],
            },
          },
        ],
        metadata: { maxTokens: 4000, model: 'test' },
      };
      const result = await new ContextSelectionsInjector({ enabled: true, mcpAppsEnabled }).process(
        context,
      );
      expect(result.messages[0].content).toContain('normal-selection');
      expect(String(result.messages[0].content).includes('app-secret-selection')).toBe(
        mcpAppsEnabled,
      );
      if (mcpAppsEnabled) expect(result.messages[0].content).toContain('identifier="notes"');
    },
  );
});
