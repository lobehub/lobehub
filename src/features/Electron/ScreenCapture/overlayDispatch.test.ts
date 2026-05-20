import { describe, expect, it } from 'vitest';

import { canConsumePendingOverlayDispatch } from './overlayDispatch';

describe('overlayDispatch', () => {
  describe('canConsumePendingOverlayDispatch', () => {
    it('allows a new conversation before messages initialize', () => {
      expect(
        canConsumePendingOverlayDispatch({
          agentId: 'agent-1',
          isAgentConfigLoading: false,
          messagesInit: false,
          pendingDispatch: {
            agentId: 'agent-1',
            captureIds: ['capture-1'],
            dispatchId: 'dispatch-1',
            prompt: 'hello',
          },
          routeAgentId: 'agent-1',
          topicId: null,
        }),
      ).toBe(true);
    });

    it('waits for existing conversation messages to initialize', () => {
      expect(
        canConsumePendingOverlayDispatch({
          agentId: 'agent-1',
          isAgentConfigLoading: false,
          messagesInit: false,
          pendingDispatch: {
            agentId: 'agent-1',
            captureIds: ['capture-1'],
            dispatchId: 'dispatch-1',
            prompt: 'hello',
          },
          routeAgentId: 'agent-1',
          topicId: 'topic-1',
        }),
      ).toBe(false);
    });

    it('blocks when the route has not switched to the pending agent', () => {
      expect(
        canConsumePendingOverlayDispatch({
          agentId: 'agent-1',
          isAgentConfigLoading: false,
          messagesInit: true,
          pendingDispatch: {
            agentId: 'agent-1',
            captureIds: ['capture-1'],
            dispatchId: 'dispatch-1',
            prompt: 'hello',
          },
          routeAgentId: 'agent-2',
          topicId: null,
        }),
      ).toBe(false);
    });

    it('blocks while agent config is still loading', () => {
      expect(
        canConsumePendingOverlayDispatch({
          agentId: 'agent-1',
          isAgentConfigLoading: true,
          messagesInit: true,
          pendingDispatch: {
            agentId: 'agent-1',
            captureIds: [],
            dispatchId: 'dispatch-1',
            prompt: 'hello',
          },
          routeAgentId: 'agent-1',
          topicId: null,
        }),
      ).toBe(false);
    });
  });
});
