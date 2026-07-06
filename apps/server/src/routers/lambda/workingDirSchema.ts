import { z } from 'zod';

const gitLinkedPullRequestSchema = z.object({
  ciStatus: z.enum(['failure', 'pending', 'success', 'unknown']).optional(),
  isDraft: z.boolean().optional(),
  mergeable: z.string().optional(),
  mergeStateStatus: z.string().optional(),
  mergedAt: z.string().nullable().optional(),
  number: z.number(),
  reviewDecision: z.string().optional(),
  state: z.string(),
  title: z.string(),
  url: z.string(),
});

export const workingDirConfigSchema = z.object({
  git: z
    .object({
      activeWorktree: z.string().optional(),
      branch: z.string().optional(),
      detached: z.boolean().optional(),
      github: z
        .object({
          extraPullRequestCount: z.number().optional(),
          pullRequest: gitLinkedPullRequestSchema.nullable().optional(),
          pullRequestStatus: z.enum(['error', 'gh-missing', 'ok']).optional(),
        })
        .optional(),
      isWorktree: z.boolean().optional(),
    })
    .optional(),
  path: z.string(),
  repoType: z.enum(['git', 'github']).optional(),
});
