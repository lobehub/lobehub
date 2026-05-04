import type { BuiltinServerRuntimeOutput } from '@lobechat/types';
import { z } from 'zod';

import {
  MARKETPLACE_CATEGORY_VALUES,
  type MarketplaceCategory,
  type PickState,
  type ShowAgentMarketplaceArgs,
  type SubmitAgentPickArgs,
} from '../types';

const marketplaceCategorySchema = z.enum(MARKETPLACE_CATEGORY_VALUES as [string, ...string[]]);

const showAgentMarketplaceSchema = z.object({
  categoryHints: z.array(marketplaceCategorySchema).min(1),
  description: z.string().optional(),
  prompt: z.string().min(1),
  requestId: z.string().min(1),
});

const submitAgentPickSchema = z.object({
  requestId: z.string().min(1),
  selectedTemplateIds: z.array(z.string().min(1)).min(1),
});

export interface TelemetryHooks {
  onPicked?: (payload: {
    categoryHints: MarketplaceCategory[];
    requestId: string;
    selectedTemplateIds: string[];
  }) => void;
  onShown?: (payload: { categoryHints: MarketplaceCategory[]; requestId: string }) => void;
}

export class AgentMarketplaceExecutionRuntime {
  private picks: Map<string, PickState> = new Map();
  private hooks: TelemetryHooks;

  constructor(hooks: TelemetryHooks = {}) {
    this.hooks = hooks;
  }

  async showAgentMarketplace(
    args: unknown,
    scope?: { topicId?: string | null },
  ): Promise<BuiltinServerRuntimeOutput> {
    const parsed = showAgentMarketplaceSchema.safeParse(args);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      return {
        content: `Invalid showAgentMarketplace args:\n${issues.join('\n')}\nPlease regenerate the tool call with the correct schema.`,
        success: false,
      };
    }

    const { categoryHints, description, prompt, requestId } =
      parsed.data as ShowAgentMarketplaceArgs;

    if (scope?.topicId) {
      const existing = [...this.picks.values()].find((p) => p.topicId === scope.topicId);
      if (existing) {
        return {
          content: `A marketplace picker is already open in this conversation (status=${existing.status}). Do NOT call showAgentMarketplace again. End this turn now and wait — when the user submits, the original tool result will be rewritten in place with the user's selection (\`selectedTemplateIds\`, \`installedAgentIds\`) and your runtime will resume from there with the full wrap-up checklist.`,
          state: existing,
          success: false,
        };
      }
    }

    const state: PickState = {
      categoryHints,
      description,
      prompt,
      requestId,
      status: 'pending',
      topicId: scope?.topicId ?? undefined,
    };

    this.picks.set(requestId, state);

    try {
      this.hooks.onShown?.({ categoryHints, requestId });
    } catch (error) {
      console.error('[AgentMarketplace] onShown telemetry failed', error);
    }

    return {
      content: [
        'Marketplace picker is now visible to the user.',
        'End this turn now: do NOT call any further tools (no finishOnboarding, no askUserQuestion, no other tools) and do NOT write any wrap-up text. The user has not picked yet — anything you say here is premature.',
        'When the user submits in the picker UI, this very tool result will be rewritten in place with the user’s selection (`selectedTemplateIds`, `installedAgentIds`) and your runtime will resume reading the updated content. The rewritten result carries the full wrap-up checklist (acknowledge → updateDocument(persona) → finishOnboarding); follow it then.',
      ].join(' '),
      state,
      success: true,
    };
  }

  async submitAgentPick(args: SubmitAgentPickArgs): Promise<BuiltinServerRuntimeOutput> {
    const parsed = submitAgentPickSchema.safeParse(args);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      return {
        content: `Invalid submitAgentPick args:\n${issues.join('\n')}\nPlease regenerate the tool call with the correct schema.`,
        success: false,
      };
    }

    const { requestId, selectedTemplateIds } = parsed.data;
    const state = this.picks.get(requestId);
    if (!state) return { content: `Pick request not found: ${requestId}`, success: false };

    if (state.status !== 'pending') {
      return {
        content: `Pick request ${requestId} is already ${state.status}, cannot submit.`,
        success: false,
      };
    }

    state.status = 'submitted';
    state.selectedTemplateIds = selectedTemplateIds;
    this.picks.set(requestId, state);

    try {
      this.hooks.onPicked?.({
        categoryHints: state.categoryHints,
        requestId,
        selectedTemplateIds,
      });
    } catch (error) {
      console.error('[AgentMarketplace] onPicked telemetry failed', error);
    }

    return {
      content: `User picked ${selectedTemplateIds.length} template(s) for ${requestId}.`,
      state,
      success: true,
    };
  }
}
