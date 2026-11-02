import type { QuickNoteProposalKind, QuickNoteProposalPayload } from '@lobechat/types';

/** One user-editable text field of a Proposal payload. */
export interface QuickNoteProposalField {
  /** Field identifier, also used as the i18n label suffix. */
  key: QuickNoteProposalFieldKey;
  /** Whether the field is a long body (TextArea) rather than a one-line title. */
  multiline: boolean;
  /** Whether the executor rejects an empty value. */
  required: boolean;
}

export type QuickNoteProposalFieldKey =
  'instruction' | 'markdown' | 'name' | 'openingMessage' | 'requirement' | 'title';

/**
 * Editable fields per Proposal kind, title first. Mirrors the server payload schemas: `tool_call`
 * keeps its body in `arguments.markdown` and its title is optional.
 */
export const QUICK_NOTE_PROPOSAL_FIELDS: Record<QuickNoteProposalKind, QuickNoteProposalField[]> = {
  goal: [
    { key: 'title', multiline: false, required: true },
    { key: 'requirement', multiline: true, required: true },
  ],
  task: [
    { key: 'name', multiline: false, required: true },
    { key: 'instruction', multiline: true, required: true },
  ],
  tool_call: [
    { key: 'title', multiline: false, required: false },
    { key: 'markdown', multiline: true, required: true },
  ],
  topic: [
    { key: 'title', multiline: false, required: true },
    { key: 'openingMessage', multiline: true, required: true },
  ],
};

const readString = (value: unknown): string => (typeof value === 'string' ? value : '');

const readArguments = (payload: QuickNoteProposalPayload): Record<string, unknown> => {
  const args = payload.arguments;
  return args && typeof args === 'object' && !Array.isArray(args)
    ? (args as Record<string, unknown>)
    : {};
};

/**
 * Reads one editable field from a Proposal payload.
 *
 * Before:
 * - `('tool_call', { arguments: { markdown: "# Plan" } }, 'markdown')`
 *
 * After:
 * - `"# Plan"`
 */
export const getQuickNoteProposalField = (
  kind: QuickNoteProposalKind,
  payload: QuickNoteProposalPayload,
  key: QuickNoteProposalFieldKey,
): string =>
  kind === 'tool_call' && key === 'markdown'
    ? readString(readArguments(payload).markdown)
    : readString(payload[key]);

/**
 * Writes edited fields back into a Proposal payload, keeping every other argument.
 *
 * Before:
 * - `('tool_call', { identifier: "lobe-page-agent", arguments: { markdown: "Old" } }, { markdown: "New", title: "" })`
 *
 * After:
 * - `{ identifier: "lobe-page-agent", arguments: { markdown: "New" } }` (an empty optional title is dropped)
 */
export const setQuickNoteProposalFields = (
  kind: QuickNoteProposalKind,
  payload: QuickNoteProposalPayload,
  values: Partial<Record<QuickNoteProposalFieldKey, string>>,
): QuickNoteProposalPayload => {
  const next: QuickNoteProposalPayload = { ...payload };

  for (const field of QUICK_NOTE_PROPOSAL_FIELDS[kind]) {
    const value = values[field.key];
    if (value === undefined) continue;
    const trimmed = value.trim();

    if (kind === 'tool_call' && field.key === 'markdown') {
      next.arguments = { ...readArguments(payload), markdown: trimmed };
    } else if (!trimmed && !field.required) {
      delete next[field.key];
    } else {
      next[field.key] = trimmed;
    }
  }

  return next;
};

/**
 * Display text of a Proposal: a one-line title and a body preview.
 *
 * Before:
 * - `('task', { name: "Compare models", instruction: "Compare gpt-live and moshi" })`
 *
 * After:
 * - `{ title: "Compare models", body: "Compare gpt-live and moshi" }`
 */
export const getQuickNoteProposalPreview = (
  kind: QuickNoteProposalKind,
  payload: QuickNoteProposalPayload,
): { body: string; title: string } => {
  const [titleField, bodyField] = QUICK_NOTE_PROPOSAL_FIELDS[kind];
  const body = getQuickNoteProposalField(kind, payload, bodyField.key);
  const fallbackBody = kind === 'goal' ? readString(payload.problemDescription) : '';

  return {
    body: body || fallbackBody,
    title: getQuickNoteProposalField(kind, payload, titleField.key),
  };
};
