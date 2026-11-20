import type { Asciicast, AsciicastEvent } from '@lobechat/utils/verify/asciicast';
import { parseResize } from '@lobechat/utils/verify/asciicast';
import { terminalTextFromStream } from '@lobechat/utils/verify/terminalEvidence';

/**
 * Playback math for the read-only terminal player, kept pure so seeking,
 * idle compression and markers are tested without a terminal.
 *
 * The player never streams events one by one: at any moment it knows the
 * playhead, asks {@link eventCountAt} how many events belong on screen, and
 * applies the ones it has not applied yet with {@link collectOps}. Seeking
 * backwards resets the terminal and replays from the start — a terminal screen
 * is the sum of everything written to it, so there is no cheaper way back.
 */

export const PLAYBACK_RATES = [0.5, 1, 2, 4] as const;

/**
 * Idle stretches longer than this play as this long. A recording that waited
 * a minute on a network call is still honest about the order of events; the
 * reader just doesn't sit through the wait. The real duration stays on the card.
 */
export const MAX_IDLE_SECONDS = 2;

/** Terminal size bounds while replaying — a hostile resize must not allocate a huge buffer. */
const MAX_COLS = 500;
const MAX_ROWS = 200;

export interface TimelineEvent extends AsciicastEvent {
  /** Playback time after idle compression, in seconds. */
  at: number;
}

export interface TimelineMarker {
  at: number;
  label: string;
}

export interface PlaybackTimeline {
  cols: number;
  duration: number;
  events: TimelineEvent[];
  markers: TimelineMarker[];
  rows: number;
}

export const clampTerminalSize = (cols: number, rows: number) => ({
  cols: Math.min(Math.max(1, Math.floor(cols)), MAX_COLS),
  rows: Math.min(Math.max(1, Math.floor(rows)), MAX_ROWS),
});

/** Compress idle gaps and pull out the `m` markers a reader can jump to. */
export const buildTimeline = (
  cast: Pick<Asciicast, 'cols' | 'events' | 'rows'>,
  maxIdle = MAX_IDLE_SECONDS,
): PlaybackTimeline => {
  let previous = 0;
  let at = 0;
  const events = cast.events.map((event) => {
    at += Math.min(Math.max(0, event.t - previous), maxIdle);
    previous = event.t;
    return { ...event, at };
  });
  const markers = events
    .filter((event) => event.code === 'm')
    .map((event, index) => ({ at: event.at, label: event.data.trim() || `#${index + 1}` }));
  return {
    ...clampTerminalSize(cast.cols, cast.rows),
    duration: events.at(-1)?.at ?? 0,
    events,
    markers,
  };
};

/** How many events are on screen at playback time `t` (all with `at <= t`). Binary search. */
export const eventCountAt = (events: Pick<TimelineEvent, 'at'>[], t: number): number => {
  let low = 0;
  let high = events.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (events[mid]!.at <= t) low = mid + 1;
    else high = mid;
  }
  return low;
};

export type TerminalOp =
  { cols: number; rows: number; type: 'resize' } | { data: string; type: 'write' };

/**
 * The terminal operations for events `[from, to)`: output writes, merged so
 * xterm parses one string instead of thousands, and resizes in order between
 * them. Every output chunk goes through `sanitize` — one sanitizer per pass,
 * so an escape sequence split across events is still stripped whole. Input
 * (`i`), markers and the exit event never touch the screen.
 */
export const collectOps = (
  events: AsciicastEvent[],
  from: number,
  to: number,
  sanitize: (chunk: string) => string,
): TerminalOp[] => {
  const ops: TerminalOp[] = [];
  let pending = '';
  const flush = () => {
    if (pending) ops.push({ data: pending, type: 'write' });
    pending = '';
  };
  for (let index = from; index < to; index++) {
    const event = events[index]!;
    if (event.code === 'o') pending += sanitize(event.data);
    else if (event.code === 'r') {
      const size = parseResize(event.data);
      if (!size) continue;
      flush();
      ops.push({ ...clampTerminalSize(size.cols, size.rows), type: 'resize' });
    }
  }
  flush();
  return ops;
};

/** `m:ss` under an hour, `h:mm:ss` beyond. */
export const formatPlaybackClock = (seconds: number, precise = false): string => {
  // A recording shorter than a few seconds would read 0:00 / 0:00 at whole
  // seconds — as if nothing were there to play. `precise` adds tenths.
  if (precise) {
    const tenths = Math.max(0, Math.floor(seconds * 10));
    const m = Math.floor(tenths / 600);
    const s = ((tenths % 600) / 10).toFixed(1).padStart(4, '0');
    return `${m}:${s}`;
  }
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
};

/** Tenths are worth showing while whole seconds would hide the playback. */
export const PRECISE_CLOCK_MAX_SECONDS = 10;

/**
 * The recording's output as plain text — the static view of a pty capture
 * that has no separate output file. Approximates the final screen (carriage
 * return overwrites keep the last write), it does not replace the replay.
 */
export const castPlainText = (events: AsciicastEvent[]): string =>
  terminalTextFromStream(
    events
      .filter((event) => event.code === 'o')
      .map((event) => event.data)
      .join(''),
  );
