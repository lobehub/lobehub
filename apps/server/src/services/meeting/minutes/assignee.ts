import type { MeetingAssignee, MeetingAssigneeType } from '@lobechat/types';

/** A member or agent an action item can be assigned to, with every name it may be called by. */
export interface AssigneeCandidate {
  /** Other names the transcript may use: username, email local part, agent slug-like name. */
  aliases: string[];
  avatar?: string | null;
  id: string;
  /** Display name, written into the minutes and shown in the picker. */
  name: string;
  type: MeetingAssigneeType;
}

export interface AssigneeMatchContext {
  /** Candidate of the person who recorded the meeting, owner of first-person commitments. */
  recorder?: AssigneeCandidate;
  /** Diarization label → name the user gave that speaker, so "Speaker 2" resolves to a person. */
  speakerNames: Map<string, string>;
}

/** Owners that mean "the person speaking", which in a recorded meeting is the recorder. */
const FIRST_PERSON = new Set(['i', 'me', 'myself', 'self', '我', '我自己', '本人', '自己']);

/** Shortest name a partial match may use; shorter fragments match too many people. */
const MIN_PARTIAL_LENGTH = 2;

const normalize = (value: string) =>
  value.trim().toLowerCase().replace(/^@/, '').replaceAll(/\s+/g, ' ');

const namesOf = (candidate: AssigneeCandidate) =>
  [candidate.name, ...candidate.aliases].map(normalize).filter(Boolean);

const toAssignee = ({ id, name, type }: AssigneeCandidate): MeetingAssignee => ({ id, name, type });

/** The single candidate a predicate selects, or `undefined` when none or several do. */
const unique = (candidates: AssigneeCandidate[], predicate: (name: string) => boolean) => {
  const matches = candidates.filter((candidate) => namesOf(candidate).some(predicate));
  const distinct = new Map(
    matches.map((candidate) => [`${candidate.type}:${candidate.id}`, candidate]),
  );
  return distinct.size === 1 ? [...distinct.values()][0] : undefined;
};

/**
 * Resolve the owner the minutes name ("Alice", "Speaker 2", "我") to one
 * member or agent. Only an unambiguous match is returned: an exact name
 * first, then a unique partial one. Anything else stays unassigned for the
 * user to pick, since a wrong assignee is worse than none.
 */
export const matchAssignee = (
  hint: string | undefined,
  candidates: AssigneeCandidate[],
  context: AssigneeMatchContext,
): MeetingAssignee | undefined => {
  if (!hint?.trim()) return undefined;

  const named = context.speakerNames.get(hint.trim()) ?? hint;
  const target = normalize(named);
  if (!target) return undefined;

  if (FIRST_PERSON.has(target)) return context.recorder ? toAssignee(context.recorder) : undefined;

  const exact = unique(candidates, (name) => name === target);
  if (exact) return toAssignee(exact);

  if (target.length < MIN_PARTIAL_LENGTH) return undefined;
  const partial = unique(
    candidates,
    (name) => name.length >= MIN_PARTIAL_LENGTH && (name.includes(target) || target.includes(name)),
  );
  return partial ? toAssignee(partial) : undefined;
};
