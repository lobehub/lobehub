import { describe, expect, it, vi } from 'vitest';

import { MarketplaceCategory } from '../types';
import { AgentMarketplaceExecutionRuntime } from './index';

const baseArgs = {
  categoryHints: [MarketplaceCategory.Engineering] as MarketplaceCategory[],
  prompt: 'Pick an engineer to help you ship faster.',
  requestId: 'req-1',
};

describe('AgentMarketplaceExecutionRuntime', () => {
  it('creates a pending pick request from valid args', async () => {
    const runtime = new AgentMarketplaceExecutionRuntime();
    const result = await runtime.showAgentMarketplace(baseArgs);

    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({
      requestId: 'req-1',
      status: 'pending',
      categoryHints: [MarketplaceCategory.Engineering],
      prompt: baseArgs.prompt,
    });
  });

  it('rejects empty categoryHints', async () => {
    const runtime = new AgentMarketplaceExecutionRuntime();
    const result = await runtime.showAgentMarketplace({ ...baseArgs, categoryHints: [] });

    expect(result.success).toBe(false);
  });

  it('rejects categoryHints with unknown slug', async () => {
    const runtime = new AgentMarketplaceExecutionRuntime();
    const result = await runtime.showAgentMarketplace({
      ...baseArgs,
      categoryHints: ['not-a-real-category'] as unknown as MarketplaceCategory[],
    });

    expect(result.success).toBe(false);
  });

  it('marks a request submitted with selected template ids', async () => {
    const runtime = new AgentMarketplaceExecutionRuntime();
    await runtime.showAgentMarketplace(baseArgs);

    const result = await runtime.submitAgentPick({
      requestId: 'req-1',
      selectedTemplateIds: ['pair-programmer', 'code-reviewer'],
    });

    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({
      requestId: 'req-1',
      status: 'submitted',
      selectedTemplateIds: ['pair-programmer', 'code-reviewer'],
    });
  });

  it('marks a request skipped with optional reason', async () => {
    const runtime = new AgentMarketplaceExecutionRuntime();
    await runtime.showAgentMarketplace({ ...baseArgs, requestId: 'req-2' });

    const result = await runtime.skipAgentPick({ requestId: 'req-2', reason: 'user tired' });

    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({
      requestId: 'req-2',
      status: 'skipped',
      skipReason: 'user tired',
    });
  });

  it('marks a request cancelled', async () => {
    const runtime = new AgentMarketplaceExecutionRuntime();
    await runtime.showAgentMarketplace({ ...baseArgs, requestId: 'req-3' });

    const result = await runtime.cancelAgentPick({ requestId: 'req-3' });

    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({ requestId: 'req-3', status: 'cancelled' });
  });

  it('returns current pick state', async () => {
    const runtime = new AgentMarketplaceExecutionRuntime();
    await runtime.showAgentMarketplace({ ...baseArgs, requestId: 'req-4' });

    const result = await runtime.getPickState({ requestId: 'req-4' });

    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({ requestId: 'req-4', status: 'pending' });
  });

  it('returns error for non-existent request', async () => {
    const runtime = new AgentMarketplaceExecutionRuntime();
    const result = await runtime.getPickState({ requestId: 'nope' });

    expect(result.success).toBe(false);
  });

  it('prevents submitting a non-pending request', async () => {
    const runtime = new AgentMarketplaceExecutionRuntime();
    await runtime.showAgentMarketplace({ ...baseArgs, requestId: 'req-5' });
    await runtime.cancelAgentPick({ requestId: 'req-5' });

    const result = await runtime.submitAgentPick({
      requestId: 'req-5',
      selectedTemplateIds: ['copywriter'],
    });

    expect(result.success).toBe(false);
  });

  it('invokes onShown telemetry hook with categoryHints on show', async () => {
    const onShown = vi.fn();
    const runtime = new AgentMarketplaceExecutionRuntime({ onShown });
    await runtime.showAgentMarketplace(baseArgs);

    expect(onShown).toHaveBeenCalledTimes(1);
    expect(onShown).toHaveBeenCalledWith({
      categoryHints: [MarketplaceCategory.Engineering],
      requestId: 'req-1',
    });
  });

  it('invokes onPicked telemetry hook with selectedTemplateIds on submit', async () => {
    const onPicked = vi.fn();
    const runtime = new AgentMarketplaceExecutionRuntime({ onPicked });
    await runtime.showAgentMarketplace({ ...baseArgs, requestId: 'req-6' });

    await runtime.submitAgentPick({
      requestId: 'req-6',
      selectedTemplateIds: ['pair-programmer'],
    });

    expect(onPicked).toHaveBeenCalledTimes(1);
    expect(onPicked).toHaveBeenCalledWith({
      categoryHints: [MarketplaceCategory.Engineering],
      requestId: 'req-6',
      selectedTemplateIds: ['pair-programmer'],
    });
  });
});
