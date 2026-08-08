import dayjs, { type Dayjs } from 'dayjs';

/** Offsets offered by "Send later", in hours. */
export const OFFSETS_IN_HOURS = [1, 3, 8, 24];

/**
 * A schedule is only ever approximate ("in ~3 hours"), so land it on the hour
 * rather than on whatever minute the user happened to open the menu — "15:00"
 * is a promise a person can hold in their head; "15:37" is noise.
 *
 * Floors to the hour, then guards the degenerate case: at 12:59, flooring
 * "in 1 hour" gives 13:00, which is 60 seconds away and makes the label a lie.
 * When the floored slot is less than {@link MIN_LEAD_MINUTES} out, take the next
 * hour instead.
 */
const MIN_LEAD_MINUTES = 10;

export const resolveScheduleTime = (hours: number, now: Dayjs = dayjs()): Dayjs => {
  const floored = now.add(hours, 'hour').startOf('hour');

  return floored.diff(now, 'minute') < MIN_LEAD_MINUTES ? floored.add(1, 'hour') : floored;
};
