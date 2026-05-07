import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';

import type { MockCase, MockEvent, PlaybackState, SpeedMultiplier } from '../types';
import { applySpeed } from './timing';

export interface MockPlayerOptions {
  case: MockCase;
  onEvent: (event: AgentStreamEvent) => void;
  operationId: string;
  speedMultiplier?: SpeedMultiplier;
}

type Listener = (state: PlaybackState) => void;

const eventsOf = (c: MockCase): MockEvent[] => {
  if (c.source.type === 'fixture') return c.source.events;
  if (c.source.type === 'snapshot') return c.source.events ?? [];
  if (c.source.type === 'generator') return c.source.events ?? [];
  return [];
};

const countTools = (events: MockEvent[]) => events.filter((e) => e.type === 'tool_start').length;
const countSteps = (events: MockEvent[]) => events.filter((e) => e.type === 'step_start').length;
const totalDuration = (events: MockEvent[]) => events.reduce((s, e) => s + (e.delay ?? 0), 0);

export class MockPlayer {
  private events: MockEvent[];
  private cursor = 0;
  private elapsedMs = 0;
  private currentStepIndex = -1;
  private toolsExecuted = 0;
  private state: PlaybackState;
  private speed: SpeedMultiplier;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<Listener>();

  constructor(private opts: MockPlayerOptions) {
    this.events = eventsOf(opts.case);
    this.speed = opts.speedMultiplier ?? 1;
    this.state = {
      status: 'idle',
      currentEventIndex: 0,
      totalEvents: this.events.length,
      currentStepIndex: 0,
      totalSteps: countSteps(this.events),
      toolsExecuted: 0,
      totalTools: countTools(this.events),
      elapsedMs: 0,
      totalDurationMs: totalDuration(this.events),
      speedMultiplier: this.speed,
    };
  }

  play() {
    if (this.state.status === 'running') return;
    this.setState({ status: 'running' });
    this.scheduleNext();
  }

  pause() {
    if (this.state.status !== 'running') return;
    this.clearTimer();
    this.setState({ status: 'paused' });
  }

  resume() {
    if (this.state.status !== 'paused') return;
    this.setState({ status: 'running' });
    this.scheduleNext();
  }

  stop() {
    this.clearTimer();
    this.cursor = 0;
    this.elapsedMs = 0;
    this.currentStepIndex = -1;
    this.toolsExecuted = 0;
    this.setState({
      status: 'idle',
      currentEventIndex: 0,
      currentStepIndex: 0,
      toolsExecuted: 0,
      elapsedMs: 0,
    });
  }

  setSpeed(speed: SpeedMultiplier) {
    this.speed = speed;
    this.setState({ speedMultiplier: speed });
    if (this.state.status === 'running') {
      this.clearTimer();
      this.scheduleNext();
    }
  }

  getState(): PlaybackState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  stepNextEvent() {
    if (this.cursor >= this.events.length) return;
    this.dispatch(this.events[this.cursor]);
    this.cursor += 1;
    if (this.cursor >= this.events.length) this.setState({ status: 'complete' });
  }

  stepNextStep() {
    while (this.cursor < this.events.length) {
      const ev = this.events[this.cursor];
      this.dispatch(ev);
      this.cursor += 1;
      if (ev.type === 'step_complete') break;
    }
    if (this.cursor >= this.events.length) this.setState({ status: 'complete' });
  }

  stepNextTool() {
    while (this.cursor < this.events.length) {
      const ev = this.events[this.cursor];
      this.dispatch(ev);
      this.cursor += 1;
      if (ev.type === 'tool_end') break;
    }
    if (this.cursor >= this.events.length) this.setState({ status: 'complete' });
  }

  seekToEventIndex(idx: number) {
    if (idx < 0 || idx > this.events.length) return;
    this.clearTimer();
    if (idx < this.cursor) {
      this.stop();
    }
    while (this.cursor < idx) {
      this.dispatch(this.events[this.cursor]);
      this.cursor += 1;
    }
  }

  private scheduleNext = () => {
    if (this.state.status !== 'running') return;
    if (this.cursor >= this.events.length) {
      this.setState({ status: 'complete' });
      return;
    }
    const ev = this.events[this.cursor];
    const delay = applySpeed(ev.delay ?? 0, this.speed);
    this.timer = setTimeout(() => {
      this.dispatch(ev);
      this.cursor += 1;
      this.scheduleNext();
    }, delay);
  };

  private dispatch(ev: MockEvent) {
    if (ev.type === 'step_start') this.currentStepIndex += 1;
    if (ev.type === 'tool_end') this.toolsExecuted += 1;
    this.elapsedMs += ev.delay ?? 0;

    const decorated: AgentStreamEvent = {
      type: ev.type,
      data: ev.data,
      operationId: this.opts.operationId,
      stepIndex: Math.max(0, this.currentStepIndex),
      timestamp: Date.now(),
    };
    this.opts.onEvent(decorated);
    this.setState({
      currentEventIndex: this.cursor + 1,
      currentStepIndex: Math.max(0, this.currentStepIndex),
      toolsExecuted: this.toolsExecuted,
      elapsedMs: this.elapsedMs,
    });
  }

  private setState(patch: Partial<PlaybackState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }

  private clearTimer() {
    if (this.timer != null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
