import type { BuiltinServerRuntimeOutput } from '@lobechat/types';
import { z } from 'zod';

import {
  type CancelAgentPickArgs,
  type GetPickStateArgs,
  MARKETPLACE_CATEGORY_VALUES,
  type MarketplaceCategory,
  type PickState,
  type ShowAgentMarketplaceArgs,
  type SkipAgentPickArgs,
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

  async showAgentMarketplace(args: unknown): Promise<BuiltinServerRuntimeOutput> {
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

    const state: PickState = {
      categoryHints,
      description,
      prompt,
      requestId,
      status: 'pending',
    };

    this.picks.set(requestId, state);

    try {
      this.hooks.onShown?.({ categoryHints, requestId });
    } catch (error) {
      console.error('[AgentMarketplace] onShown telemetry failed', error);
    }

    return {
      content: `Marketplace picker "${prompt}" is now pending user selection.`,
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

  async skipAgentPick(args: SkipAgentPickArgs): Promise<BuiltinServerRuntimeOutput> {
    const { requestId, reason } = args;
    const state = this.picks.get(requestId);
    if (!state) return { content: `Pick request not found: ${requestId}`, success: false };

    if (state.status !== 'pending') {
      return {
        content: `Pick request ${requestId} is already ${state.status}, cannot skip.`,
        success: false,
      };
    }

    state.status = 'skipped';
    state.skipReason = reason;
    this.picks.set(requestId, state);

    return {
      content: `Pick request ${requestId} skipped.${reason ? ` Reason: ${reason}` : ''}`,
      state,
      success: true,
    };
  }

  async cancelAgentPick(args: CancelAgentPickArgs): Promise<BuiltinServerRuntimeOutput> {
    const { requestId } = args;
    const state = this.picks.get(requestId);
    if (!state) return { content: `Pick request not found: ${requestId}`, success: false };

    if (state.status !== 'pending') {
      return {
        content: `Pick request ${requestId} is already ${state.status}, cannot cancel.`,
        success: false,
      };
    }

    state.status = 'cancelled';
    this.picks.set(requestId, state);

    return { content: `Pick request ${requestId} cancelled.`, state, success: true };
  }

  async getPickState(args: GetPickStateArgs): Promise<BuiltinServerRuntimeOutput> {
    const { requestId } = args;
    const state = this.picks.get(requestId);
    if (!state) return { content: `Pick request not found: ${requestId}`, success: false };

    return { content: `Pick request ${requestId} is ${state.status}.`, state, success: true };
  }
}
