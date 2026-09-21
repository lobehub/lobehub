import { z } from 'zod';

export const AgentShareDocumentProvenanceSchema = z.object({
  shareId: z.string(),
  topicId: z.string(),
  visitorUserId: z.string(),
});

export type AgentShareDocumentProvenance = z.infer<typeof AgentShareDocumentProvenanceSchema>;

/**
 * Share provenance is an access boundary, not a lifecycle owner. Share-authored documents remain
 * creator-owned and intentionally outlive visitor topics so a creator-facing history can expose
 * them later.
 */
export type DocumentAccessScope =
  ({ type: 'agentShare' } & AgentShareDocumentProvenance) | { type: 'ordinary' };

export const ordinaryDocumentAccessScope = {
  type: 'ordinary',
} as const satisfies DocumentAccessScope;

export const agentShareDocumentAccessScope = (
  provenance: AgentShareDocumentProvenance,
): DocumentAccessScope => ({
  shareId: provenance.shareId,
  topicId: provenance.topicId,
  type: 'agentShare',
  visitorUserId: provenance.visitorUserId,
});

/** Remove server-owned Agent Share provenance from caller-supplied metadata. */
export const stripAgentShareDocumentProvenance = <T>(metadata: T): T => {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return metadata;

  return Object.fromEntries(
    Object.entries(metadata as Record<string, unknown>).filter(([key]) => key !== 'agentShare'),
  ) as T;
};

/** Read server-written Agent Share provenance without trusting the rest of the JSON metadata. */
export const getAgentShareDocumentProvenance = (
  metadata: unknown,
): AgentShareDocumentProvenance | undefined => {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined;

  const result = AgentShareDocumentProvenanceSchema.safeParse(
    (metadata as { agentShare?: unknown }).agentShare,
  );
  return result.success ? result.data : undefined;
};
