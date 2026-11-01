/**
 * The composer's in-progress draft as stored in the browser. Every field is
 * optional because the value is a browser string that a previous release (or
 * another tab) may have written in another shape.
 */
export interface TaskCreateDraft {
  assigneeAgentId?: string;
  assigneeUserId?: string | null;
  execution?: unknown;
  markdown?: string;
  priority?: number;
  visibility?: 'private' | 'public';
}

/** The saved draft for a scope, or null when there is none or it is unreadable. */
export const readTaskCreateDraft = (key: string): TaskCreateDraft | null => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as TaskCreateDraft) : null;
  } catch {
    return null;
  }
};

export const clearTaskCreateDraft = (key: string) => {
  try {
    localStorage.removeItem(key);
  } catch {
    /* storage unavailable — persistence is best-effort */
  }
};

/**
 * Mirrors the composer into storage and returns whether it now holds text.
 *
 * An empty composer clears the saved draft only once it has held text since it
 * was hydrated (`hasHeldText`): emptying the editor is the user discarding the
 * draft, and leaving the old text on disk brings it back on every reload. Before
 * that, an empty read is the gap right after a restore, before `setDocument`
 * lands, and must not wipe the draft being restored.
 */
export const persistTaskCreateDraft = (
  key: string,
  draft: TaskCreateDraft & { markdown: string },
  hasHeldText: boolean,
): boolean => {
  if (!draft.markdown) {
    if (hasHeldText) clearTaskCreateDraft(key);
    return false;
  }

  try {
    localStorage.setItem(key, JSON.stringify(draft));
  } catch {
    /* storage unavailable / quota — persistence is best-effort */
  }
  return true;
};
