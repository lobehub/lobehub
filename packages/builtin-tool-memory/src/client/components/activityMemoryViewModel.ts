import dayjs from 'dayjs';
import timezonePlugin from 'dayjs/plugin/timezone';
import utcPlugin from 'dayjs/plugin/utc';

import type { AddActivityMemoryParams } from '../../types';
import type { MemoryEntity } from './memoryArgs';
import { asText, asTextList, toEntities } from './memoryArgs';

export interface ActivityMemoryViewModel {
  activityType?: string;
  details?: string;
  /** Subjects, then objects, then locations — all cleaned up. */
  entities: MemoryEntity[];
  feedback?: string;
  /** Whether the activity-specific layer has anything worth its own sections. */
  hasActivityContent: boolean;
  /** Nothing to show at all — the card renders nothing in this case. */
  isEmpty: boolean;
  narrative?: string;
  notes?: string;
  /** Human-readable start/end window, e.g. `2024-05-03 14:00 → 15:00`. */
  schedule?: string;
  status?: string;
  summary?: string;
  tags: string[];
  timezone?: string;
  title?: string;
}

/** A location reads as an entity once its address is folded into the hover metadata. */
const toLocationEntities = (locations: unknown): MemoryEntity[] =>
  toEntities(locations).map((location) => ({
    ...location,
    type: location.type ?? 'place',
  }));

dayjs.extend(utcPlugin);
dayjs.extend(timezonePlugin);

/**
 * Read the instant in the activity's own timezone when it declared one.
 *
 * An activity is remembered in the timezone it happened in — "the 14:00 meeting"
 * stays 14:00 whether it is recalled from Shanghai or from California. Formatting
 * in the viewer's local zone while the card still shows the activity's `timezone`
 * label produces an actively wrong line ("23:00 Asia/Shanghai" for a 14:00 +08:00
 * meeting), so the label and the digits have to come from the same zone.
 */
const inZone = (text: string, timezone?: string) => {
  if (!timezone) return dayjs(text);

  try {
    const zoned = dayjs(text).tz(timezone);
    return zoned.isValid() ? zoned : dayjs(text);
  } catch {
    // An unknown IANA name throws rather than returning an invalid date.
    return dayjs(text);
  }
};

const formatMoment = (value: unknown, withDate: boolean, timezone?: string) => {
  const text = asText(value);
  if (!text) return undefined;

  const moment = inZone(text, timezone);
  // Models emit free-form strings here often enough ("next Tuesday") that an
  // unparseable value has to survive as-is rather than render "Invalid Date".
  if (!moment.isValid()) return text;

  return moment.format(withDate ? 'YYYY-MM-DD HH:mm' : 'HH:mm');
};

/**
 * Collapse start/end into one line. The end drops its date when it lands on the same
 * day, so a one-hour meeting reads `2024-05-03 14:00 → 15:00` rather than repeating.
 */
const toSchedule = (startsAt: unknown, endsAt: unknown, timezone?: string) => {
  const start = formatMoment(startsAt, true, timezone);
  const startMoment = inZone(asText(startsAt) ?? '', timezone);
  const endMoment = inZone(asText(endsAt) ?? '', timezone);
  const sameDay =
    startMoment.isValid() && endMoment.isValid() && startMoment.isSame(endMoment, 'day');
  const end = formatMoment(endsAt, !sameDay, timezone);

  if (start && end) return `${start} → ${end}`;
  return start || end;
};

/**
 * Derive everything the activity memory card renders. See {@link asText} for why
 * every field is treated as untrusted.
 */
export const getActivityMemoryViewModel = (
  data?: AddActivityMemoryParams,
): ActivityMemoryViewModel => {
  const { summary, details, tags, title, withActivity } = data || {};
  const {
    associatedLocations,
    associatedObjects,
    associatedSubjects,
    endsAt,
    feedback,
    narrative,
    notes,
    startsAt,
    status,
    timezone,
    type,
  } = withActivity || {};

  const entities = [
    ...toEntities(associatedSubjects, associatedObjects),
    ...toLocationEntities(associatedLocations),
  ];

  const safeTimezone = asText(timezone);
  const schedule = toSchedule(startsAt, endsAt, safeTimezone);
  const safeTags = asTextList(tags);
  const safeNarrative = asText(narrative);
  const safeNotes = asText(notes);
  const safeFeedback = asText(feedback);
  const safeSummary = asText(summary);
  const safeDetails = asText(details);
  const safeTitle = asText(title);

  const hasActivityContent =
    !!safeNarrative || !!safeNotes || !!safeFeedback || !!schedule || entities.length > 0;

  return {
    activityType: asText(type),
    details: safeDetails,
    entities,
    feedback: safeFeedback,
    hasActivityContent,
    isEmpty: !safeSummary && !safeDetails && !safeTags.length && !safeTitle && !hasActivityContent,
    narrative: safeNarrative,
    notes: safeNotes,
    schedule,
    status: asText(status),
    summary: safeSummary,
    tags: safeTags,
    timezone: safeTimezone,
    title: safeTitle,
  };
};
