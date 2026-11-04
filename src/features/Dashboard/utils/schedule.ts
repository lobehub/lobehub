/**
 * Refresh cadences offered by name. A widget may carry any cron pattern (an
 * agent picks one from its script's manifest); these are the ones a person
 * picks from a list and reads back as words.
 */
export const SCHEDULE_PRESETS = [
  { key: 'every15m', pattern: '*/15 * * * *' },
  { key: 'every30m', pattern: '*/30 * * * *' },
  { key: 'hourly', pattern: '0 * * * *' },
  { key: 'every6h', pattern: '0 */6 * * *' },
  { key: 'daily9', pattern: '0 9 * * *' },
] as const;

export type SchedulePresetKey = (typeof SCHEDULE_PRESETS)[number]['key'];

/** Presets whose run time depends on the timezone (fixed clock time, not an interval). */
const CLOCK_PRESETS = new Set<SchedulePresetKey>(['daily9']);

const normalizePattern = (pattern: string) => pattern.trim().split(/\s+/).join(' ');

/** The preset a cron pattern is, if it is one. */
export const findSchedulePreset = (pattern?: string | null): SchedulePresetKey | undefined => {
  if (!pattern) return undefined;
  const normalized = normalizePattern(pattern);
  return SCHEDULE_PRESETS.find((preset) => preset.pattern === normalized)?.key;
};

/** Whether a schedule's timezone changes when it runs (and so belongs beside its label). */
export const scheduleShowsTimezone = (pattern: string) => {
  const preset = findSchedulePreset(pattern);
  return !preset || CLOCK_PRESETS.has(preset);
};

/** A board-wide schedule choice: no schedule, a preset, or leave every widget as it is. */
export type BoardScheduleChoice = 'keep' | 'manual' | SchedulePresetKey;

/**
 * What the board's widgets refresh on today, as the settings form reads it:
 * - `none` — the user can change no widget here (only creators may);
 * - `uniform` — every widget they can change shares one cadence, shown as `choice`;
 * - `custom` — they share one cron pattern that is not a preset;
 * - `mixed` — the widgets differ.
 */
export type BoardScheduleState =
  | { kind: 'none' }
  | { choice: Exclude<BoardScheduleChoice, 'keep'>; kind: 'uniform' }
  | { kind: 'custom'; pattern: string }
  | { kind: 'mixed' };

export const resolveBoardSchedule = (
  widgets: { schedulePattern?: string | null }[],
): BoardScheduleState => {
  if (widgets.length === 0) return { kind: 'none' };

  const patterns = new Set(
    widgets.map(({ schedulePattern }) =>
      schedulePattern ? normalizePattern(schedulePattern) : null,
    ),
  );
  if (patterns.size > 1) return { kind: 'mixed' };

  const [pattern] = patterns;
  if (!pattern) return { choice: 'manual', kind: 'uniform' };
  const preset = findSchedulePreset(pattern);
  return preset ? { choice: preset, kind: 'uniform' } : { kind: 'custom', pattern };
};

/** The choice the form starts on: what is set today, or "keep" when no single preset says it. */
export const initialBoardScheduleChoice = (state: BoardScheduleState): BoardScheduleChoice =>
  state.kind === 'uniform' ? state.choice : 'keep';

/** The cron pattern a choice writes; `undefined` when it writes nothing. */
export const boardSchedulePattern = (choice: BoardScheduleChoice): string | null | undefined => {
  if (choice === 'keep') return undefined;
  if (choice === 'manual') return null;
  return SCHEDULE_PRESETS.find((preset) => preset.key === choice)?.pattern;
};

/** A cadence as a person reads it: the preset's name, else the cron pattern, with its timezone when it matters. */
export const formatSchedule = (
  translate: (key: `schedule.${SchedulePresetKey}`) => string,
  pattern: string,
  timezone?: string | null,
) => {
  const preset = findSchedulePreset(pattern);
  const label = preset ? translate(`schedule.${preset}`) : pattern;
  return timezone && scheduleShowsTimezone(pattern) ? `${label} · ${timezone}` : label;
};
