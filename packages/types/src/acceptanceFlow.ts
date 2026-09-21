import { z } from 'zod';

import type { VerifyOnFailStrategy } from './verify';

export interface VerifyCheckDefinition {
  expected?: string;
  fixtures?: VerifyCheckFixture[];
  preconditions?: string[];
  steps?: VerifyCheckStep[];
}
export interface VerifyCheckFixture {
  data?: Record<string, unknown>;
  description?: string;
  id: string;
  name: string;
  resource?: { type: 'file' | 'document'; id: string };
}
export interface VerifyCheckStep {
  expected?: string;
  fixtureIds?: string[];
  id: string;
  instruction: string;
}
export interface AcceptanceFlowNodeOverrides {
  fixtureData?: Record<string, Record<string, unknown>>;
  onFail?: VerifyOnFailStrategy;
  required?: boolean;
}
export interface AcceptanceFlowNodeInput {
  check?: { id: string; title: string; description?: string; definition: VerifyCheckDefinition };
  criterionId?: string;
  id: string;
  overrides?: AcceptanceFlowNodeOverrides;
  subFlowId?: string;
}
export interface AcceptanceFlowEdgeInput {
  condition?: string;
  id: string;
  required: boolean;
  sourceNodeId: string;
  targetNodeId: string;
  trigger: string;
}
export interface AcceptanceFlowDefinition {
  edges: AcceptanceFlowEdgeInput[];
  entryNodeId: string;
  nodes: AcceptanceFlowNodeInput[];
  title: string;
}
export interface VerifyFlowSnapshot {
  edges: AcceptanceFlowEdgeInput[];
  entryNodeId: string;
  flowId: string;
  nodes: {
    id: string;
    criterionId?: string;
    subFlowId?: string;
    parentNodeId?: string;
    title?: string;
    isEntry?: boolean;
    checkItemIds: string[];
  }[];
  title: string;
}
export type AcceptanceFlowVerdict = 'passed' | 'failed' | 'uncertain' | 'blocked';
export type AcceptanceFlowReview = 'accepted' | 'rejected';

/** Runtime validation shared by asset and plan writers. */
export const verifyCheckDefinitionSchema = z
  .object({
    preconditions: z.array(z.string().max(4000)).max(100).optional(),
    expected: z.string().max(20000).optional(),
    fixtures: z
      .array(
        z.object({
          id: z.string().min(1),
          name: z.string().min(1),
          description: z.string().optional(),
          resource: z
            .object({ type: z.enum(['file', 'document']), id: z.string().min(1) })
            .optional(),
          data: z.record(z.string(), z.unknown()).optional(),
        }),
      )
      .max(100)
      .optional(),
    steps: z
      .array(
        z.object({
          id: z.string().min(1),
          instruction: z.string().min(1),
          expected: z.string().optional(),
          fixtureIds: z.array(z.string()).optional(),
        }),
      )
      .max(200)
      .optional(),
  })
  .superRefine((value, ctx) => {
    for (const key of ['fixtures', 'steps'] as const) {
      const ids = (value[key] ?? []).map((v) => v.id);
      if (new Set(ids).size !== ids.length)
        ctx.addIssue({ code: 'custom', message: `Duplicate ${key} ids`, path: [key] });
    }
    const fixtures = new Set(value.fixtures?.map((f) => f.id));
    if (value.steps?.some((s) => s.fixtureIds?.some((id) => !fixtures.has(id))))
      ctx.addIssue({ code: 'custom', message: 'Unknown fixture reference', path: ['steps'] });
  });
