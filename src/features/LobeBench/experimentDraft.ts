import { AgentChatConfigSchema } from '@lobechat/types';
import { z } from 'zod';

const modelSchema = z.object({ model: z.string().min(1), provider: z.string().min(1) });
const contenderSchema = modelSchema.extend({
  chatConfig: AgentChatConfigSchema.pick({
    enableReasoning: true,
    gpt5ReasoningEffort: true,
    reasoningBudgetToken: true,
    reasoningEffort: true,
    textVerbosity: true,
    thinking: true,
    thinkingBudget: true,
    thinkingLevel: true,
  }).optional(),
  id: z.string().min(1),
  name: z.string(),
  params: z
    .object({
      frequency_penalty: z.number().optional(),
      presence_penalty: z.number().optional(),
      temperature: z.number().optional(),
      top_p: z.number().optional(),
    })
    .optional(),
});

const draftSchema = z.object({
  contenders: z.array(contenderSchema),
  datasetId: z.string().optional(),
  /** Every dataset the experiment will run, one or more; a draft saved before has `datasetId` only. */
  datasetIds: z.array(z.string()).optional(),
  judge: modelSchema.optional(),
  k: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  maxSteps: z.number().int().min(1).max(1000).nullable(),
  name: z.string(),
  pickCases: z.boolean(),
  pickedCaseIds: z.array(z.string()),
  question: z.string(),
  timeoutMinutes: z.number().min(1).max(240).nullable(),
});

export type ExperimentDraft = z.infer<typeof draftSchema>;
export interface ExperimentDraftScope {
  benchmarkId: string;
  userId: string;
  workspaceId: string | null;
}

export const experimentDraftKey = ({ benchmarkId, userId, workspaceId }: ExperimentDraftScope) =>
  `lobe-bench:experiment-draft:v1:${JSON.stringify([userId, workspaceId, benchmarkId])}`;

export const experimentDraftLocationKey = (userId: string, workspaceId: string | null) =>
  `lobe-bench:experiment-draft-location:v1:${JSON.stringify([userId, workspaceId])}`;

/** Only known form fields are restored; run IDs and arbitrary stored fields are excluded. */
export const parseExperimentDraft = (raw: string | null): ExperimentDraft | undefined => {
  if (!raw) return;
  try {
    const parsed = draftSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
};

/** The datasets a draft runs: its list, or the one dataset a draft saved before names. */
export const draftDatasetIds = (draft: Pick<ExperimentDraft, 'datasetId' | 'datasetIds'>) =>
  draft.datasetIds ?? (draft.datasetId ? [draft.datasetId] : []);

/** An explicit case-set entry takes precedence without reusing another set's picked cases. */
export const applyPresetDataset = (
  draft: ExperimentDraft,
  datasetId?: string | null,
): ExperimentDraft =>
  datasetId && (datasetId !== draft.datasetId || draftDatasetIds(draft).join() !== datasetId)
    ? { ...draft, datasetId, datasetIds: [datasetId], pickedCaseIds: [] }
    : draft;

export interface AvailableDraftModel {
  model: string;
  provider: string;
  supportsTools: boolean;
}

export const getInvalidDraftSelections = (
  draft: ExperimentDraft,
  availableCaseIds: string[],
  availableModels: AvailableDraftModel[],
) => ({
  caseIds: draft.pickCases
    ? draft.pickedCaseIds.filter((id) => !availableCaseIds.includes(id))
    : [],
  contenders: draft.contenders.filter(
    (contender) =>
      !availableModels.some(
        (model) =>
          model.model === contender.model &&
          model.provider === contender.provider &&
          model.supportsTools,
      ),
  ),
  judge:
    !!draft.judge &&
    !availableModels.some(
      (model) => model.model === draft.judge?.model && model.provider === draft.judge?.provider,
    ),
});
