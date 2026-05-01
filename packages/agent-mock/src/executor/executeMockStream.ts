import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';

import { MockPlayer } from '../player/MockPlayer';
import type { MockCase, SpeedMultiplier } from '../types';

export interface ExecuteMockStreamOptions {
  case: MockCase;
  onEvent: (event: AgentStreamEvent) => void;
  operationId: string;
  speedMultiplier?: SpeedMultiplier;
}

export interface MockStreamHandle {
  player: MockPlayer;
  start: () => void;
  stop: () => void;
}

export function executeMockStream(opts: ExecuteMockStreamOptions): MockStreamHandle {
  const player = new MockPlayer({
    case: opts.case,
    onEvent: opts.onEvent,
    operationId: opts.operationId,
    speedMultiplier: opts.speedMultiplier,
  });

  return {
    player,
    start() {
      player.play();
    },
    stop() {
      player.stop();
    },
  };
}
