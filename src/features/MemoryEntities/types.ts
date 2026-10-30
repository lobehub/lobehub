/**
 * Entity pages over the existing memory layers: every context is a page, and activities are the
 * timeline. The backend stores no link between the two, so the timeline is inferred from names
 * both sides mention (see `link.ts`).
 */
export type ContextKind = 'project' | 'goal' | 'relationship' | 'event' | 'other';

/** Collapsed from the backend `currentStatus` enum, which `statusLabel` keeps verbatim. */
export type EntityStatus = 'active' | 'dormant' | 'closed';

export interface AssociatedName {
  name: string;
  type?: string;
}

export interface MemoryEntity {
  capturedAt: string;
  /** Rich narrative of where things stand; the page's 「现在」. */
  description: string;
  id: string;
  kind: ContextKind;
  /** Names of the people, things and places the context mentions. */
  names: AssociatedName[];
  /** The free-text type the extractor wrote, e.g. `creative_project`. */
  rawType?: string;
  status: EntityStatus;
  /** Backend status as written: `ongoing`, `on_hold`, … */
  statusValue?: string;
  /** Concise overview from the parent memory row. */
  summary: string;
  tags: string[];
  title: string;
  updatedAt: string;
}

export interface MemoryActivity {
  id: string;
  names: AssociatedName[];
  narrative: string;
  planned: boolean;
  statusValue?: string;
  title: string;
  /** When it happened, or when it was recorded if the extractor left no date. */
  when: string;
  /** False when `when` is only the capture time. */
  whenIsExact: boolean;
}

/** A context ↔ activity or context ↔ context pair, and the names that tie them. */
export interface NameLink {
  names: string[];
  targetId: string;
}
