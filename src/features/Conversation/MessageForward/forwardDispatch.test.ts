import { type UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { buildForwardedContent, canConsumePendingForward } from './forwardDispatch';
import { type PendingForwardDispatch } from './forwardDispatch';

const pending: PendingForwardDispatch = {
  content: 'forwarded',
  dispatchId: 'dispatch-1',
  messageCount: 2,
  targetAgentId: 'agent-1',
};

const roleLabel = (role: string) => (role === 'user' ? 'User' : 'Assistant');

const msg = (over: Partial<UIChatMessage>): UIChatMessage =>
  ({ id: 'm', role: 'user', ...over }) as UIChatMessage;

describe('forwardDispatch', () => {
  describe('canConsumePendingForward', () => {
    it('allows once the target agent is active in a fresh topic', () => {
      expect(
        canConsumePendingForward({
          agentId: 'agent-1',
          isAgentConfigLoading: false,
          pendingForward: pending,
          routeAgentId: 'agent-1',
          topicId: null,
        }),
      ).toBe(true);
    });

    it('blocks while the target agent already has a topic (not a new conversation)', () => {
      expect(
        canConsumePendingForward({
          agentId: 'agent-1',
          isAgentConfigLoading: false,
          pendingForward: pending,
          routeAgentId: 'agent-1',
          topicId: 'topic-1',
        }),
      ).toBe(false);
    });

    it('blocks until the route switches to the target agent', () => {
      expect(
        canConsumePendingForward({
          agentId: 'agent-2',
          isAgentConfigLoading: false,
          pendingForward: pending,
          routeAgentId: 'agent-2',
          topicId: null,
        }),
      ).toBe(false);
    });

    it('blocks while agent config is still loading', () => {
      expect(
        canConsumePendingForward({
          agentId: 'agent-1',
          isAgentConfigLoading: true,
          pendingForward: pending,
          routeAgentId: 'agent-1',
          topicId: null,
        }),
      ).toBe(false);
    });

    it('blocks when there is no pending forward', () => {
      expect(
        canConsumePendingForward({
          agentId: 'agent-1',
          isAgentConfigLoading: false,
          pendingForward: null,
          routeAgentId: 'agent-1',
          topicId: null,
        }),
      ).toBe(false);
    });
  });

  describe('buildForwardedContent', () => {
    it('renders a role-labelled transcript with a header', () => {
      const content = buildForwardedContent(
        [
          msg({ content: 'hi there', role: 'user' }),
          msg({ content: 'hello back', role: 'assistant' }),
        ],
        { header: 'Forwarded 2 messages:', roleLabel },
      );

      expect(content).toBe(
        'Forwarded 2 messages:\n\n---\n\n**User**\n\nhi there\n\n---\n\n**Assistant**\n\nhello back',
      );
    });

    it('flattens assistantGroup child text without serializing tool payloads', () => {
      const content = buildForwardedContent(
        [
          msg({
            children: [
              { content: 'part one', tools: [{ id: 'tool-1' }] },
              { content: 'part two' },
            ] as UIChatMessage['children'],
            content: '',
            role: 'assistantGroup',
          }),
          msg({ content: 'tool output', role: 'tool' }),
          msg({ content: 'kept', role: 'assistant' }),
        ],
        { header: 'H', roleLabel },
      );

      expect(content).toBe(
        'H\n\n---\n\n**Assistant**\n\npart one\n\npart two\n\n---\n\n**Assistant**\n\nkept',
      );
      expect(content).not.toContain('tool-1');
    });

    it('skips messages with empty content', () => {
      const content = buildForwardedContent(
        [msg({ content: '   ', role: 'user' }), msg({ content: 'kept', role: 'assistant' })],
        { header: 'H', roleLabel },
      );

      expect(content).toBe('H\n\n---\n\n**Assistant**\n\nkept');
    });
  });
});
