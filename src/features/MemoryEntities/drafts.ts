import { create } from 'zustand';

interface DraftState {
  drafts: Record<string, string>;
  /** `undefined` ends editing for that context. */
  setDraft: (id: string, text?: string) => void;
}

/**
 * Unsaved 「现在」 edits, per context. Kept outside the page so following a link or picking
 * another context does not discard what was typed; coming back resumes the edit.
 */
export const useDraftStore = create<DraftState>()((set) => ({
  drafts: {},
  setDraft: (id, text) =>
    set((s) => {
      const drafts = { ...s.drafts };
      if (text === undefined) delete drafts[id];
      else drafts[id] = text;
      return { drafts };
    }),
}));

/**
 * What saving a draft should do. Only unchanged text is a no-op; clearing the field is a real
 * edit and is saved as an empty description.
 */
export const resolveDraft = (draft: string | undefined, current: string) => {
  const value = (draft ?? '').trim();
  return { save: value !== current, value };
};
