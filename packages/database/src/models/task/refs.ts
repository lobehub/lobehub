import type { TaskItem } from '@lobechat/types';
import { and, inArray, or } from 'drizzle-orm';

import { tasks } from '../../schemas/task';
import { type TaskModelContext, taskOwnership } from './context';

export interface ParsedTaskRef {
  kind: 'id' | 'identifier';
  raw: string;
  value: string;
}

/** Classify once. An id must never fall back to an identifier (or vice versa). */
export const parseTaskRef = (raw: string): ParsedTaskRef => {
  const value = raw.trim();
  return value.startsWith('task_')
    ? { kind: 'id', raw, value }
    : { kind: 'identifier', raw, value: value.toUpperCase() };
};

export const matchTaskRefs = (refs: ParsedTaskRef[], rows: TaskItem[]) => {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const byIdentifier = new Map<string, TaskItem[]>();
  for (const row of rows) {
    const matches = byIdentifier.get(row.identifier) ?? [];
    matches.push(row);
    byIdentifier.set(row.identifier, matches);
  }
  const byRef = new Map<string, TaskItem>();
  const resolved = new Map<string, TaskItem>();
  const missing: string[] = [];
  const ambiguous: string[] = [];
  for (const ref of refs) {
    const matches =
      ref.kind === 'id'
        ? byId.has(ref.value)
          ? [byId.get(ref.value)!]
          : []
        : (byIdentifier.get(ref.value) ?? []);
    if (matches.length > 1) ambiguous.push(ref.raw);
    else if (matches.length === 0) missing.push(ref.raw);
    else {
      byRef.set(ref.raw, matches[0]);
      resolved.set(matches[0].id, matches[0]);
    }
  }
  return { ambiguous, byRef, missing, tasks: [...resolved.values()] };
};

export const resolveRefs = async (ctx: TaskModelContext, rawRefs: string[]) => {
  const refs = rawRefs.map(parseTaskRef);
  const ids = refs.filter((ref) => ref.kind === 'id').map((ref) => ref.value);
  const identifiers = refs.filter((ref) => ref.kind === 'identifier').map((ref) => ref.value);
  const rows =
    refs.length === 0
      ? []
      : await ctx.db
          .select()
          .from(tasks)
          .where(
            and(
              taskOwnership(ctx),
              or(
                ids.length ? inArray(tasks.id, ids) : undefined,
                identifiers.length ? inArray(tasks.identifier, identifiers) : undefined,
              ),
            ),
          );
  return matchTaskRefs(refs, rows);
};
