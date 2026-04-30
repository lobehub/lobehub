import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';

import { MockPlayer } from '../player/MockPlayer';
import type { MockCase, SideEffectFlags, SpeedMultiplier } from '../types';
import { DEFAULT_SIDE_EFFECT_FLAGS } from '../types';

export interface ExecuteMockStreamOptions {
  case: MockCase;
  /** The unchanged gateway event handler — caller wires this from createGatewayEventHandler. */
  onEvent: (event: AgentStreamEvent) => void;
  operationId: string;
  /** Setter that flips chatStore.__agentMockSilent during playback. */
  setSilent?: (silent: boolean) => void;
  sideEffects?: Partial<SideEffectFlags>;
  speedMultiplier?: SpeedMultiplier;
}

export interface MockStreamHandle {
  player: MockPlayer;
  start: () => void;
  stop: () => void;
}

export function executeMockStream(opts: ExecuteMockStreamOptions): MockStreamHandle {
  const flags = { ...DEFAULT_SIDE_EFFECT_FLAGS, ...opts.sideEffects };
  const shouldSilence = !flags.emitAgentSignal || !flags.recordTracing || !flags.emitAnalytics;

  const player = new MockPlayer({
    case: opts.case,
    onEvent: opts.onEvent,
    operationId: opts.operationId,
    speedMultiplier: opts.speedMultiplier,
  });

  const unsubscribe = player.subscribe((state) => {
    if (state.status === 'complete' || state.status === 'idle' || state.status === 'error') {
      opts.setSilent?.(false);
    }
  });

  return {
    player,
    start() {
      if (shouldSilence) opts.setSilent?.(true);
      player.play();
    },
    stop() {
      player.stop();
      opts.setSilent?.(false);
      unsubscribe();
    },
  };
}
