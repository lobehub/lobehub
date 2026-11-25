import {
  escapeXml,
  type SkillItem,
  skillPrompt,
  type SkillSource,
  type SkillsPromptOptions,
} from '@lobechat/prompts';

import type { SkillMeta } from './SkillContextProvider';

/**
 * Keeping the `<available_skills>` block byte-stable across turns.
 *
 * `<available_skills>` sits inside message `[0]` (system prompt), so any change
 * to it — installing a skill mid-conversation, enabling/disabling one in the
 * UI, editing its description, or even reordering rows (`updatedAt DESC`) —
 * invalidates the provider prompt cache for the entire conversation behind it.
 *
 * Instead of rendering the live list directly into message `[0]`, the index
 * renders from a snapshot taken once while the cache is cold, and any changes
 * since are attached as a delta note on the user message that started the turn:
 *
 *   msg[0] system  ← snapshot rows only, never rewritten while the cache is warm
 *   user msg #2    ← <skills_changes> added <skill name="pptx">...</skill>
 *   user msg #3    ← no new change: user msg #2 replays verbatim, prefix stays cached
 *
 * Mirrors `AgentDocumentInjector/indexSnapshot.ts`: a note is computed once
 * when its turn starts and replayed verbatim on later turns. The snapshot is
 * refreshed (and old notes dropped) only when the cache is cold anyway: the
 * first turn, a gap longer than the provider cache TTL, or a history compression.
 */

/** One non-activated skill row as the snapshot saw it: everything needed to render it again. */
export interface SkillIndexRow {
  description: string;
  identifier: string;
  location?: string;
  name: string;
  source?: SkillSource;
}

export type SkillIndexChangeKind = 'added' | 'removed' | 'updated';

/** How one skill differs from its snapshot row, as of the turn the note belongs to. */
export interface SkillIndexChange {
  description?: string;
  identifier: string;
  kind: SkillIndexChangeKind;
  location?: string;
  name: string;
  source?: SkillSource;
}

/** The skill changes noted on one user message. */
export interface SkillIndexNote {
  changes: SkillIndexChange[];
  messageId: string;
}

export interface SkillIndexSnapshot {
  /**
   * Id of the newest compressed-history message when the snapshot was taken.
   * A compression rewrites the prompt anyway, so a different id refreshes it.
   */
  compressionId?: string;
  /** Change notes in turn order. Each is replayed on its user message. */
  notes: SkillIndexNote[];
  rows: SkillIndexRow[];
  /** ISO timestamp of when the rows were taken. */
  takenAt: string;
}

/** Changes keyed by the id of the user message they are attached to. */
export type SkillChangesByMessage = Record<string, SkillIndexChange[]>;

const listedSkills = (skills: SkillMeta[]): SkillMeta[] => skills.filter((s) => !s.activated);

const toRow = (skill: SkillMeta): SkillIndexRow => ({
  description: skill.description,
  identifier: skill.identifier,
  ...(skill.location && { location: skill.location }),
  name: skill.name,
  ...(skill.source && { source: skill.source }),
});

const toChange = (row: SkillIndexRow, kind: SkillIndexChangeKind): SkillIndexChange => ({
  ...(kind !== 'removed' && { description: row.description }),
  identifier: row.identifier,
  kind,
  ...(kind !== 'removed' && row.location && { location: row.location }),
  name: row.name,
  ...(row.source && { source: row.source }),
});

export function takeSkillIndexSnapshot(
  skills: SkillMeta[],
  { compressionId, takenAt }: { compressionId?: string; takenAt: Date },
): SkillIndexSnapshot {
  return {
    ...(compressionId && { compressionId }),
    notes: [],
    rows: listedSkills(skills).map(toRow),
    takenAt: takenAt.toISOString(),
  };
}

/**
 * Every available skill that differs from its snapshot row: added since,
 * updated since (name, description, source, or location changed), or removed
 * since. Cumulative — a note always states the full difference, so a reader
 * that only sees the newest note (older ones truncated away) still has the
 * whole picture.
 *
 * Pure reordering (e.g. `updatedAt DESC` shifting a row) produces no diff:
 * `skillsFromSnapshot` preserves snapshot order so message `[0]` stays unchanged.
 */
export function diffSkillIndex(rows: SkillIndexRow[], skills: SkillMeta[]): SkillIndexChange[] {
  const liveListed = new Map(listedSkills(skills).map((s) => [s.identifier, s]));
  const liveAllIds = new Set(skills.map((s) => s.identifier));
  const changes: SkillIndexChange[] = [];

  for (const row of rows) {
    const skill = liveListed.get(row.identifier);
    if (!skill) {
      // A skill that became pre-activated (injected with full content) is still present.
      if (!liveAllIds.has(row.identifier)) {
        changes.push(toChange(row, 'removed'));
      }
      continue;
    }

    const current = toRow(skill);
    if (
      current.name !== row.name ||
      current.description !== row.description ||
      current.source !== row.source ||
      current.location !== row.location
    ) {
      changes.push(toChange(current, 'updated'));
    }
  }

  const known = new Set(rows.map((row) => row.identifier));
  for (const skill of liveListed.values()) {
    if (!known.has(skill.identifier)) {
      changes.push(toChange(toRow(skill), 'added'));
    }
  }

  return changes;
}

/**
 * Skills an earlier note reported as added that are no longer enabled. The
 * snapshot rows never had them, so the row diff alone would leave the model
 * with the old "added" note and no word that they are gone.
 */
const removedSinceNoted = (
  snapshot: SkillIndexSnapshot,
  skills: SkillMeta[],
): SkillIndexChange[] => {
  const liveAllIds = new Set(skills.map((s) => s.identifier));
  const inRows = new Set(snapshot.rows.map((row) => row.identifier));
  const removed = new Map<string, SkillIndexChange>();

  for (const note of snapshot.notes) {
    for (const change of note.changes) {
      if (
        change.kind !== 'added' ||
        liveAllIds.has(change.identifier) ||
        inRows.has(change.identifier)
      ) {
        continue;
      }
      removed.set(change.identifier, {
        identifier: change.identifier,
        kind: 'removed',
        name: change.name,
        ...(change.source && { source: change.source }),
      });
    }
  }

  return [...removed.values()];
};

/**
 * Skills an earlier note reported as updated or removed that now match their
 * snapshot row again (description reverted, or disabled and re-enabled). The
 * row diff no longer lists them, so without this the earlier note — which
 * supersedes the index — would stay the last word, and a re-enabled skill would
 * keep reading as unavailable.
 */
const restoredSinceNoted = (
  snapshot: SkillIndexSnapshot,
  skills: SkillMeta[],
  diffed: SkillIndexChange[],
): SkillIndexChange[] => {
  const liveListed = new Map(listedSkills(skills).map((s) => [s.identifier, s]));
  const inDiff = new Set(diffed.map((change) => change.identifier));
  const restored = new Map<string, SkillIndexChange>();

  for (const note of snapshot.notes) {
    for (const change of note.changes) {
      const skill = liveListed.get(change.identifier);
      if (change.kind === 'added' || !skill || inDiff.has(change.identifier)) continue;
      restored.set(change.identifier, toChange(toRow(skill), 'updated'));
    }
  }

  return [...restored.values()];
};

/**
 * A removal revokes every name the model was given for the skill. The row diff
 * only knows the snapshot name, so a skill renamed in an earlier note and then
 * disabled would keep its newer name reading as available — and `activateSkill`
 * resolves by name.
 */
const revokeAdvertisedNames = (
  snapshot: SkillIndexSnapshot,
  changes: SkillIndexChange[],
): SkillIndexChange[] => {
  const advertised = new Map<string, Set<string>>();
  for (const note of snapshot.notes) {
    for (const change of note.changes) {
      if (change.kind === 'removed') continue;
      const names = advertised.get(change.identifier) ?? new Set<string>();
      advertised.set(change.identifier, names.add(change.name));
    }
  }

  return changes.flatMap((change) => {
    if (change.kind !== 'removed') return [change];
    const otherNames = [...(advertised.get(change.identifier) ?? [])].filter(
      (name) => name !== change.name,
    );
    return [change, ...otherNames.map((name) => ({ ...change, name }))];
  });
};

const sameChanges = (a: SkillIndexChange[], b: SkillIndexChange[]) =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * Note on `messageId` how the enabled skills differ from the snapshot, once.
 *
 * - A message that already has a note keeps it (a retried step or regenerated
 *   reply replays the same note).
 * - No note is added when nothing changed, or when the difference equals the
 *   newest note still visible in the conversation — that note already says it.
 *
 * @returns the same snapshot object when nothing was added.
 */
export function noteSkillChanges(
  snapshot: SkillIndexSnapshot,
  skills: SkillMeta[],
  { messageId, presentMessageIds }: { messageId: string; presentMessageIds: Set<string> },
): SkillIndexSnapshot {
  if (snapshot.notes.some((note) => note.messageId === messageId)) return snapshot;

  const diffed = revokeAdvertisedNames(snapshot, [
    ...diffSkillIndex(snapshot.rows, skills),
    ...removedSinceNoted(snapshot, skills),
  ]);
  const changes = [...diffed, ...restoredSinceNoted(snapshot, skills, diffed)];
  if (changes.length === 0) return snapshot;

  const newestPresent = snapshot.notes.findLast((note) => presentMessageIds.has(note.messageId));
  if (newestPresent && sameChanges(newestPresent.changes, changes)) return snapshot;

  return { ...snapshot, notes: [...snapshot.notes, { changes, messageId }] };
}

/**
 * The skills `<available_skills>` renders from: snapshot rows in place of the
 * live available skills — a removed skill keeps its row, a newer one has none
 * (both communicated via `<skills_changes>`) — and every live activated skill
 * unchanged.
 */
export function skillsFromSnapshot(skills: SkillMeta[], snapshot: SkillIndexSnapshot): SkillMeta[] {
  const activated = skills.filter((s) => s.activated);
  const activatedIds = new Set(activated.map((s) => s.identifier));
  const rows: SkillMeta[] = snapshot.rows
    .filter((row) => !activatedIds.has(row.identifier))
    .map((row) => ({ ...row }));
  return [...activated, ...rows];
}

export const skillChangesByMessage = (
  snapshot: SkillIndexSnapshot,
): SkillChangesByMessage | undefined =>
  snapshot.notes.length > 0
    ? Object.fromEntries(snapshot.notes.map((note) => [note.messageId, note.changes]))
    : undefined;

const isSnapshot = (value: unknown): value is SkillIndexSnapshot =>
  !!value &&
  typeof value === 'object' &&
  Array.isArray((value as SkillIndexSnapshot).rows) &&
  Array.isArray((value as SkillIndexSnapshot).notes) &&
  typeof (value as SkillIndexSnapshot).takenAt === 'string';

interface TurnMessage {
  createdAt?: Date | number | string;
  id?: string;
  role: string;
}

const toEpochMs = (value: TurnMessage['createdAt']): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const time = Date.parse(value);
    return Number.isFinite(time) ? time : undefined;
  }
  return undefined;
};

export interface ResolveSkillIndexInput {
  /**
   * How long the provider keeps a prompt cache. A turn whose user message came
   * later than this after the previous message starts cold, so the snapshot is
   * refreshed for free. Same test as `resolveAgentDocumentIndex`.
   */
  cacheTtlMs: number;
  /** The conversation the step runs on. */
  messages: TurnMessage[];
  now: Date;
  /** The snapshot this run already pinned (absent on the run's first step). */
  pinned?: unknown;
  /** Live enabled skills of the agent for this step. */
  skills: SkillMeta[];
  /** The snapshot kept for the conversation between runs. */
  stored?: unknown;
  /**
   * The messages the model will actually see, after history truncation. A note
   * only counts as already shown while its message is among them. Defaults to
   * `messages`.
   */
  visibleMessages?: TurnMessage[];
}

export interface ResolvedSkillIndex {
  /** The run has not pinned this snapshot yet: pin it for its next steps. */
  pin: boolean;
  /** What `<available_skills>` and `<skills_changes>` render from. */
  snapshot: SkillIndexSnapshot;
  /** The snapshot differs from the stored one: keep it for the next run. */
  store: boolean;
}

const latestCompressionId = (messages: TurnMessage[]): string | undefined =>
  messages.findLast((m) => m.role === 'compressedGroup')?.id;

/**
 * The snapshot the run already pinned, when this step keeps rendering from it.
 * A new history compression takes a fresh snapshot.
 */
export function reusablePinnedSkillIndex({
  messages,
  pinned,
}: Pick<ResolveSkillIndexInput, 'messages' | 'pinned'>): SkillIndexSnapshot | undefined {
  return isSnapshot(pinned) && pinned.compressionId === latestCompressionId(messages)
    ? pinned
    : undefined;
}

/**
 * Pick the skill-index snapshot a step renders from.
 *
 * - Later steps of a run reuse the one the run pinned, so nothing moves mid-run.
 * - A run's first step continues the stored snapshot while the cache can still
 *   be warm, noting this turn's difference on its user message.
 * - Otherwise (no stored snapshot, a cold gap, or a new compression — also
 *   mid-run) a fresh snapshot is taken and the old notes go with the old one.
 */
export function resolveSkillIndex({
  cacheTtlMs,
  messages,
  now,
  pinned,
  skills,
  stored,
  visibleMessages = messages,
}: ResolveSkillIndexInput): ResolvedSkillIndex {
  const reused = reusablePinnedSkillIndex({ messages, pinned });
  if (reused) return { pin: false, snapshot: reused, store: false };

  const compressionId = latestCompressionId(messages);

  const lastUserIndex = messages.findLastIndex((m) => m.role === 'user');
  const lastUser = messages[lastUserIndex];
  const triggeredAt = toEpochMs(lastUser?.createdAt);
  const previousAt = toEpochMs(messages[lastUserIndex - 1]?.createdAt);
  const warm =
    triggeredAt !== undefined && previousAt !== undefined && triggeredAt - previousAt <= cacheTtlMs;

  if (
    !pinned &&
    warm &&
    lastUser?.id &&
    isSnapshot(stored) &&
    stored.compressionId === compressionId
  ) {
    const presentMessageIds = new Set(visibleMessages.flatMap((m) => (m.id ? [m.id] : [])));
    const snapshot = noteSkillChanges(stored, skills, {
      messageId: lastUser.id,
      presentMessageIds,
    });
    return { pin: true, snapshot, store: snapshot !== stored };
  }

  return {
    pin: true,
    snapshot: takeSkillIndexSnapshot(skills, { compressionId, takenAt: now }),
    store: true,
  };
}

const toSkillItem = (change: SkillIndexChange): SkillItem => ({
  description: change.description ?? '',
  identifier: change.identifier,
  location: change.location,
  name: change.name,
  source: change.source,
});

/**
 * Render skill changes in the same `<skill ...>` tag format as `<available_skills>`.
 *
 * Carries explicit `activateSkill` guidance whenever skills are added or updated
 * so the model still discovers and activates them even when the conversation
 * started with zero skills (no `<available_skills>` block in message `[0]`).
 */
export function formatSkillChanges(
  changes: SkillIndexChange[],
  options: SkillsPromptOptions = {},
): string {
  const { canActivateSkill = true } = options;
  const added = changes.filter((c) => c.kind === 'added');
  const updated = changes.filter((c) => c.kind === 'updated');
  const removed = changes.filter((c) => c.kind === 'removed');
  const activeChanges = [...added, ...updated];

  const hasFilesystemSkill = activeChanges.some(
    (s) => s.source === 'project' || s.source === 'device',
  );

  const headerLines: string[] = [];
  if (activeChanges.length > 0) {
    headerLines.push(
      'Available skills changed during this conversation. The following skills provide specialized instructions for specific tasks.',
      "Use the activateSkill tool to load an added or updated skill when the user's task matches its description.",
    );
    if (hasFilesystemSkill) {
      headerLines.push(
        canActivateSkill
          ? 'For a skill with source="project" or source="device", load it with activateSkill by name (do not bypass activation with readFile) and resolve relative paths against the parent directory of its `location` (parent of SKILL.md).'
          : 'For a skill with source="project" or source="device", load it by calling the readFile tool on its `location` path and resolve relative paths against the parent directory of its `location` (parent of SKILL.md).',
      );
    }
  } else {
    headerLines.push('Available skills changed during this conversation.');
  }

  if (updated.length > 0) {
    headerLines.push(
      'For updated skills below, this entry supersedes any earlier listing in <available_skills>.',
    );
  }
  if (removed.length > 0) {
    headerLines.push(
      'Removed skills are no longer available — do not call activateSkill for them.',
    );
  }

  const sections: string[] = [headerLines.join('\n')];

  if (added.length > 0) {
    const tags = added.map((skill) => skillPrompt(toSkillItem(skill))).join('\n');
    sections.push(`<added_skills>\n${tags}\n</added_skills>`);
  }

  if (updated.length > 0) {
    const tags = updated.map((skill) => skillPrompt(toSkillItem(skill))).join('\n');
    sections.push(`<updated_skills>\n${tags}\n</updated_skills>`);
  }

  if (removed.length > 0) {
    const tags = removed.map((skill) => `  <skill name="${escapeXml(skill.name)}" />`).join('\n');
    sections.push(`<removed_skills>\n${tags}\n</removed_skills>`);
  }

  return sections.join('\n\n');
}
