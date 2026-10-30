import type {
  LocalAcceptanceSource,
  LocalReviewEvent,
  LocalReviewLog,
} from '@lobechat/utils/verify/localAcceptance';
import {
  assembleLocalAcceptance,
  LOCAL_ACCEPTANCE_FORMAT,
  localAcceptanceComments,
  mergeLocalReviewEvents,
} from '@lobechat/utils/verify/localAcceptance';

/** The `<script type="application/json">` the CLI writes the acceptance into. */
export const LOCAL_DATA_ELEMENT_ID = 'acceptance-local-data';

/**
 * The page has no server to write to: a decision lands in the browser first
 * and reaches `reviews.json` when the reviewer saves it (the CLI reads the
 * saved file on its next `view` / `feedback`). Until then it lives here, so a
 * reload keeps it.
 */
const pendingKey = (acceptanceId: string) => `lobehub-acceptance-local:${acceptanceId}:reviews`;
/** Pending decisions already downloaded in a saved review log. */
const exportedKey = (acceptanceId: string) => `lobehub-acceptance-local:${acceptanceId}:exported`;

const readSource = (): LocalAcceptanceSource => {
  const element = document.getElementById(LOCAL_DATA_ELEMENT_ID);
  if (!element?.textContent) throw new Error('This report has no acceptance data.');
  const source = JSON.parse(element.textContent) as LocalAcceptanceSource;
  if (source.format !== LOCAL_ACCEPTANCE_FORMAT)
    throw new Error(`Unsupported local acceptance format: ${String(source.format)}`);
  return source;
};

const readList = <T>(key: string): T[] => {
  try {
    const raw = window.localStorage.getItem(key);
    const value = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(value) ? (value as T[]) : [];
  } catch {
    return [];
  }
};

const writeList = (key: string, value: unknown[]) => {
  try {
    if (value.length === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or a full quota: the decision still holds for this visit.
  }
};

const createLocalReport = () => {
  const source = readSource();
  const id = source.acceptance.id;
  // Decisions the report already carries were saved and read back by the CLI.
  const saved = new Set(source.reviews.map((event) => event.id));
  let pending = readList<LocalReviewEvent>(pendingKey(id)).filter((event) => !saved.has(event.id));
  let exported = new Set(
    readList<string>(exportedKey(id)).filter((eventId) => !saved.has(eventId)),
  );
  writeList(pendingKey(id), pending);
  writeList(exportedKey(id), [...exported]);
  let version = 0;
  let cache: { bundle: ReturnType<typeof assembleLocalAcceptance>; version: number } | undefined;
  const listeners = new Set<() => void>();

  const events = () => mergeLocalReviewEvents(source.reviews, pending);
  const notify = () => {
    version++;
    for (const listener of listeners) listener();
  };

  return {
    /** Where the acceptance lives, relative to the repository the CLI ran in. */
    acceptanceDir: `.acceptances/${source.acceptance.subjectKey}`,
    acceptanceId: id,
    append: (event: LocalReviewEvent) => {
      pending = [...pending, event];
      writeList(pendingKey(id), pending);
      notify();
    },
    bundle: () => {
      if (cache?.version !== version)
        cache = { bundle: assembleLocalAcceptance({ ...source, reviews: events() }), version };
      return cache.bundle;
    },
    comments: () => localAcceptanceComments(source),
    /** Everything decided on this acceptance, saved or not — what `reviews.json` holds. */
    exportLog: (): LocalReviewLog => ({
      acceptanceId: id,
      events: events(),
      format: LOCAL_ACCEPTANCE_FORMAT,
    }),
    getVersion: () => version,
    /** Record that every pending decision is in a downloaded review log. */
    markExported: () => {
      exported = new Set(pending.map((event) => event.id));
      writeList(exportedKey(id), [...exported]);
      notify();
    },
    pendingCount: () => pending.length,
    /** Pending decisions not in any downloaded review log yet. */
    unsavedCount: () => pending.filter((event) => !exported.has(event.id)).length,
    source,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};

export type LocalReport = ReturnType<typeof createLocalReport>;

let instance: LocalReport | undefined;

/** The acceptance this page was rendered with, plus the reviewer's decisions so far. */
export const getLocalReport = (): LocalReport => {
  instance ??= createLocalReport();
  return instance;
};
