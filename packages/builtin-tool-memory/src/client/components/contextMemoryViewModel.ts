import type { AddContextMemoryParams } from '../../types';
import type { MemoryEntity } from './memoryArgs';
import { asText, asTextList, toEntities, toPercent } from './memoryArgs';

export interface ContextMemoryViewModel {
  contextType?: string;
  description?: string;
  details?: string;
  /** Associated subjects followed by associated objects, both cleaned up. */
  entities: MemoryEntity[];
  /** Whether the context-specific layer has anything worth its own sections. */
  hasContextContent: boolean;
  impact?: number;
  /** Nothing to show at all — the card renders nothing in this case. */
  isEmpty: boolean;
  labels: string[];
  status?: string;
  summary?: string;
  tags: string[];
  title?: string;
  urgency?: number;
}

/**
 * Derive everything the context memory card renders. See {@link asText} for why
 * every field is treated as untrusted.
 */
export const getContextMemoryViewModel = (
  data?: AddContextMemoryParams,
): ContextMemoryViewModel => {
  const { summary, details, tags, title, withContext } = data || {};
  const {
    associatedObjects,
    associatedSubjects,
    currentStatus,
    description,
    labels,
    scoreImpact,
    scoreUrgency,
    title: contextTitle,
    type,
  } = withContext || {};

  const entities = toEntities(associatedSubjects, associatedObjects);

  const impact = toPercent(scoreImpact);
  const urgency = toPercent(scoreUrgency);
  const safeTags = asTextList(tags);
  const safeDescription = asText(description);
  const safeSummary = asText(summary);
  const safeDetails = asText(details);
  // `withContext.title` is the synthesized headline — a usable fallback when the
  // top-level title has not streamed in yet.
  const safeTitle = asText(title) ?? asText(contextTitle);

  const hasContextContent =
    !!safeDescription || entities.length > 0 || impact !== undefined || urgency !== undefined;

  return {
    contextType: asText(type),
    description: safeDescription,
    details: safeDetails,
    entities,
    hasContextContent,
    impact,
    isEmpty: !safeSummary && !safeDetails && !safeTags.length && !safeTitle && !hasContextContent,
    labels: asTextList(labels),
    status: asText(currentStatus),
    summary: safeSummary,
    tags: safeTags,
    title: safeTitle,
    urgency,
  };
};
