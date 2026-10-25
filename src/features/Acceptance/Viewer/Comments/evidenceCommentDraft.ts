import { z } from 'zod';

export const evidenceCommentDraftSchema = z.object({
  clientId: z.string().min(1),
  content: z.string(),
  rect: z
    .object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      width: z.number().min(0).max(1),
      height: z.number().min(0).max(1),
    })
    .nullable(),
});

export type EvidenceCommentDraft = z.infer<typeof evidenceCommentDraftSchema>;
export const evidenceCommentDraftKey = (userId: string, acceptanceId: string, evidenceId: string) =>
  `acceptance-comment-draft:${userId}:${acceptanceId}:${evidenceId}`;

export const readEvidenceCommentDraft = (key: string): EvidenceCommentDraft | undefined => {
  try {
    const result = evidenceCommentDraftSchema.safeParse(
      JSON.parse(localStorage.getItem(key) ?? 'null'),
    );
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
};

export const saveEvidenceCommentDraft = (key: string, draft?: EvidenceCommentDraft) => {
  try {
    if (draft) localStorage.setItem(key, JSON.stringify(draft));
    else localStorage.removeItem(key);
  } catch {
    /* Private mode or quota: in-memory editing and retry still work. */
  }
};
