import type { AgentStreamEventType } from '@lobechat/agent-gateway-client';

export interface MockCase {
  description?: string;
  id: string;
  meta?: {
    toolCount?: number;
    stepCount?: number;
    estimatedDurationMs?: number;
  };
  name: string;
  source: MockCaseSource;
  tags?: string[];
}

export type MockCaseSource =
  | { type: 'snapshot'; path: string; events?: MockEvent[] }
  | { type: 'fixture'; events: MockEvent[] }
  | { type: 'generator'; factoryId: string; params: unknown; events?: MockEvent[] };

export interface MockEvent {
  data: unknown;
  /** ms relative to previous event */
  delay?: number;
  /** label for timeline jumps, e.g. 'tool:TodoWrite#3' */
  label?: string;
  type: AgentStreamEventType;
}

export type PlaybackStatus = 'idle' | 'running' | 'paused' | 'complete' | 'error';
export type SpeedMultiplier = 0.5 | 1 | 2 | 5 | 'instant';

export interface PlaybackState {
  currentEventIndex: number;
  currentStepIndex: number;
  elapsedMs: number;
  errorMessage?: string;
  speedMultiplier: SpeedMultiplier;
  status: PlaybackStatus;
  toolsExecuted: number;
  totalDurationMs: number;
  totalEvents: number;
  totalSteps: number;
  totalTools: number;
}
