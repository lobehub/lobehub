/**
 * Classification of one topic, produced after its auto summary is written.
 * The label vocabularies are versioned by `taxonomyVersion`; this contract only
 * fixes the shape, not the label values.
 */
export interface TopicAnalysisResult {
  /** Primary task category id. */
  category: string;
  /** What the user wanted back, e.g. information vs. a produced result. */
  intent?: string | null;
  /** Additional dimensions that do not need their own column. */
  labels?: Record<string, unknown>;
  model: string;
  /** Whether the user's goal was reached. */
  outcome?: string | null;
  provider: string;
  secondaryCategory?: string | null;
  taxonomyVersion: string;
}
