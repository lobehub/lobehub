import type { AcceptanceSubjectType } from '@lobechat/const/verify';
import { acceptanceSubjectTypes } from '@lobechat/const/verify';

import { firstString, objectValue } from './values';

/** A parsed acceptance subject reference (`task:<id>` / `topic:<id>` / `document:<id>`). */
export interface AcceptanceSubjectRef {
  subjectId: string;
  subjectType: AcceptanceSubjectType;
}

/**
 * Parse a `type:id` subject reference. Returns null on anything malformed —
 * callers decide whether that is an error (an explicit `--subject`) or a
 * silently absent field (result.json).
 */
export function parseSubjectRef(raw: unknown): AcceptanceSubjectRef | null {
  if (typeof raw !== 'string') return null;
  const idx = raw.indexOf(':');
  if (idx <= 0) return null;
  const type = raw.slice(0, idx).trim().toLowerCase();
  const id = raw.slice(idx + 1).trim();
  if (!id || !(acceptanceSubjectTypes as readonly string[]).includes(type)) return null;
  return { subjectId: id, subjectType: type as AcceptanceSubjectType };
}

/**
 * The acceptance subject a report attributes itself to, from result.json's
 * `subject` field — either `"task:<id>"` or `{ type, id, requirement? }`. An
 * explicit `--subject` flag wins over this.
 */
export function subjectFromResult(result: Record<string, unknown>): {
  ref: AcceptanceSubjectRef;
  requirement?: string;
} | null {
  const raw = result.subject;
  if (typeof raw === 'string') {
    const ref = parseSubjectRef(raw);
    return ref ? { ref } : null;
  }
  const value = objectValue(raw);
  if (!value) return null;
  const ref = parseSubjectRef(`${firstString(value.type) ?? ''}:${firstString(value.id) ?? ''}`);
  return ref ? { ref, requirement: firstString(value.requirement) } : null;
}

/** Default acceptance subject for a report authored inside a LobeHub topic. */
export function subjectFromEnv(): AcceptanceSubjectRef | null {
  const topicId = firstString(process.env.LOBEHUB_TOPIC_ID);
  return topicId ? { subjectId: topicId, subjectType: 'topic' } : null;
}
