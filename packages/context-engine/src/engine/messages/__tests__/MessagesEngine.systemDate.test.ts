import { describe, expect, it } from 'vitest';

import type { UIChatMessage } from '@/types/index';

import { MessagesEngine } from '../MessagesEngine';
import type { MessagesEngineParams } from '../types';

const createMessages = (): UIChatMessage[] => [
  {
    content: 'Check this article',
    createdAt: 1_700_000_000_000,
    id: 'msg-1',
    role: 'user',
    updatedAt: 1_700_000_000_000,
  } as UIChatMessage,
];

const createParams = (overrides?: Partial<MessagesEngineParams>): MessagesEngineParams => ({
  evalContext: { sessionDate: '2026-11-21T12:00:00Z' },
  messages: createMessages(),
  model: 'gemini-4-neon',
  provider: 'lobehub',
  skillsConfig: {
    enabledSkills: [
      {
        description: 'Run statistical tests',
        identifier: 'stat-skill',
        name: 'Statistical Analysis',
      },
    ],
  },
  systemRole: 'You are a helpful assistant.',
  timezone: 'Asia/Shanghai',
  ...overrides,
});

describe('MessagesEngine SystemDateProvider stability', () => {
  it.each(['lobe-web-browsing', 'lobe-user-memory'])(
    'keeps SystemDateProvider and the leading system prefix stable when %s is activated mid-run',
    async (toolId) => {
      const before = await new MessagesEngine(
        createParams({
          toolsConfig: {
            manifests: [],
            tools: ['lobe-activator'],
          },
        }),
      ).process();

      const after = await new MessagesEngine(
        createParams({
          toolsConfig: {
            manifests: [
              {
                api: [{ description: 'Run tool', name: 'run', parameters: {} }],
                identifier: toolId,
                meta: { title: toolId },
                systemRole: 'Use this tool carefully.',
                type: 'builtin',
              },
            ],
            tools: ['lobe-activator', toolId],
          },
        }),
      ).process();

      const beforeSystem = before.messages[0].content as string;
      const afterSystem = after.messages[0].content as string;

      expect(beforeSystem).toContain('Current date: 2026-11-21 (Asia/Shanghai)');
      expect(afterSystem).toContain('Current date: 2026-11-21 (Asia/Shanghai)');
      expect(afterSystem.startsWith(beforeSystem)).toBe(true);
    },
  );

  it('still respects explicit enableSystemDate: false', async () => {
    const result = await new MessagesEngine(
      createParams({
        enableSystemDate: false,
      }),
    ).process();

    expect(result.messages[0].content as string).not.toContain('Current date:');
  });
});
