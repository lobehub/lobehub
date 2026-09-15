import { useCallback, useMemo, useState } from 'react';

export interface CaseDraft {
  criteria: string;
  expected: string;
  input: string;
}

export interface CaseDraftPatch {
  content?: { expected?: string; input?: string };
  evalConfig?: { criteria?: string };
}

/**
 * Only what actually changed. Sending the whole draft would rewrite fields the
 * user never touched — and `expected` in particular is meaningfully empty on a
 * captured case, so a blanket write is not a no-op.
 */
export const diffCaseDraft = (initial: CaseDraft, draft: CaseDraft): CaseDraftPatch | null => {
  const content: { expected?: string; input?: string } = {};
  if (draft.input !== initial.input) content.input = draft.input;
  if (draft.expected !== initial.expected) content.expected = draft.expected;

  const patch: CaseDraftPatch = {};
  if (Object.keys(content).length > 0) patch.content = content;
  if (draft.criteria !== initial.criteria) patch.evalConfig = { criteria: draft.criteria };

  return Object.keys(patch).length > 0 ? patch : null;
};

/**
 * Edit state for a case definition: the values being typed, and what to send.
 *
 * `initial` is re-read on every entry into edit mode rather than held from
 * mount, so reopening the editor after a save starts from what was saved.
 */
export const useCaseDraft = (initial: CaseDraft) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<CaseDraft>(initial);

  const start = useCallback(() => {
    setDraft(initial);
    setEditing(true);
  }, [initial]);

  const cancel = useCallback(() => setEditing(false), []);

  const patch = useMemo(() => diffCaseDraft(initial, draft), [initial, draft]);

  return {
    cancel,
    draft,
    editing,
    patch,
    setDraft: (next: Partial<CaseDraft>) => setDraft((prev) => ({ ...prev, ...next })),
    start,
    stop: () => setEditing(false),
  };
};
