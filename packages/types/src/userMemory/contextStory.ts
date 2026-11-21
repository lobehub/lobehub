import type { UserMemoryDossierStatus } from './structure';

/**
 * Read shapes of the consolidated memory: a context (one ongoing matter) holds dossiers (one
 * feature, deal or sub-task each), and each dossier holds evidence (one activity per topic that
 * moved it). Only contexts written by consolidation (`synthesized_at` set) are stories.
 */

/** One card on the contexts page. */
export interface MemoryContextStorySummary {
  dossierCount: number;
  /** Evidence rows filed under the context's dossiers. */
  evidenceCount: number;
  firstSeenAt: Date | null;
  id: string;
  lastEvidenceAt: Date | null;
  nextSteps: string[];
  now: string | null;
  openQuestions: string[];
  /** Derived from the newest evidence by consolidation. */
  status: UserMemoryDossierStatus;
  title: string | null;
}

export interface MemoryContextStoryEvidence {
  capturedAt: Date;
  dossierId: string;
  id: string;
  narrative: string | null;
  /** Agent of the source topic, to build the topic link. */
  sourceAgentId: string | null;
  /** Topic the evidence was extracted from, when it still exists. */
  sourceTopicId: string | null;
  sourceTopicTitle: string | null;
  title: string | null;
}

export interface MemoryContextStoryDossier {
  activityCount: number;
  evidence: MemoryContextStoryEvidence[];
  firstSeenAt: Date | null;
  id: string;
  lastEvidenceAt: Date | null;
  now: string | null;
  status: UserMemoryDossierStatus;
  title: string | null;
}

export interface MemoryContextStory extends MemoryContextStorySummary {
  dossiers: MemoryContextStoryDossier[];
}

export interface MemoryContextStoryList {
  legacyCap: number;
  /** Contexts not consolidated yet that readers still see, counted up to `legacyCap`. */
  legacyCount: number;
  stories: MemoryContextStorySummary[];
}
