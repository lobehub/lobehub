import dayjs, { type ConfigType } from 'dayjs';

/**
 * Days between `now`'s local date and a `YYYY-MM-DD` day string: 0 = today,
 * 1 = yesterday. The news section renders with `keepPreviousData`, so during a
 * page flip the payload on screen belongs to the *previous* day — every label,
 * empty-state and arrow-disabled decision must derive from the payload's own
 * day (this offset), never from the offset being fetched, or the new day's
 * title flashes over the old day's briefs.
 *
 * Clamped at 0: a payload from "today" fetched just before local midnight
 * would otherwise compute -1 and render a nonsense "tomorrow" state.
 */
export const resolveShownNewsOffset = (day: string, now?: ConfigType): number =>
  Math.max(0, dayjs(now).startOf('day').diff(dayjs(day).startOf('day'), 'day'));
