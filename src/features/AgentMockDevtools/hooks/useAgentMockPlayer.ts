import { executeMockStream, type MockCase } from '@lobechat/agent-mock';
import type { ConversationContext } from '@lobechat/types';
import { useCallback, useEffect, useRef } from 'react';

import { createGatewayEventHandler } from '@/store/chat/slices/aiChat/actions/gatewayEventHandler';
import { useChatStore } from '@/store/chat/store';

import { useAgentMockStore } from '../store/agentMockStore';

type MockStreamHandle = ReturnType<typeof executeMockStream>;

interface StartArgs {
  /** Required — gatewayEventHandler dispatches messages keyed by agentId/topicId. */
  agentId: string;
  assistantMessageId: string;
  case: MockCase;
  sessionId?: string;
  topicId: string;
}

export function useAgentMockPlayer() {
  const handleRef = useRef<MockStreamHandle | null>(null);
  const setPlayback = useAgentMockStore((s) => s.setPlayback);
  const speed = useAgentMockStore((s) => s.speed);
  const sideEffects = useAgentMockStore((s) => s.sideEffects);

  const start = useCallback(
    (args: StartArgs) => {
      handleRef.current?.stop();

      const operationId = `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const context: ConversationContext = {
        agentId: args.agentId,
        scope: 'main',
        sessionId: args.sessionId,
        topicId: args.topicId,
      };

      const handler = createGatewayEventHandler(() => useChatStore.getState(), {
        assistantMessageId: args.assistantMessageId,
        context,
        operationId,
      });

      const handle = executeMockStream({
        case: args.case,
        onEvent: handler,
        operationId,
        setSilent: (silent) => {
          useChatStore.setState({ __agentMockSilent: silent });
        },
        sideEffects,
        speedMultiplier: speed,
      });

      handle.player.subscribe((state) => setPlayback(state));
      handle.start();
      handleRef.current = handle;
    },
    [setPlayback, speed, sideEffects],
  );

  const pause = useCallback(() => handleRef.current?.player.pause(), []);
  const resume = useCallback(() => handleRef.current?.player.resume(), []);
  const stop = useCallback(() => {
    handleRef.current?.stop();
    handleRef.current = null;
    setPlayback(null);
  }, [setPlayback]);
  const stepEvent = useCallback(() => handleRef.current?.player.stepNextEvent(), []);
  const stepStep = useCallback(() => handleRef.current?.player.stepNextStep(), []);
  const stepTool = useCallback(() => handleRef.current?.player.stepNextTool(), []);
  const setSpeed = useCallback(
    (s: Parameters<MockStreamHandle['player']['setSpeed']>[0]) =>
      handleRef.current?.player.setSpeed(s),
    [],
  );

  useEffect(() => () => handleRef.current?.stop(), []);

  return { pause, resume, setSpeed, start, stepEvent, stepStep, stepTool, stop };
}
