import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applyCollaborationModeReport,
  dismissCodexPlan,
  executeCodexPlan,
  pendingHeteroPlanModeMetadata,
  resolveRunCollaborationMode,
  setPendingHeteroPlanMode,
  shouldShowCodexPlanDecision,
} from './heteroPlanMode';

const lab = vi.hoisted(() => ({ appServer: true }));

vi.mock('@/store/user', () => ({ getUserStoreState: () => ({}) }));
vi.mock('@/store/user/selectors', () => ({
  labPreferSelectors: {
    enableCodexAppServer: () => lab.appServer,
  },
}));

const storeWith = (metadata: Record<string, unknown> | undefined) => {
  const updateTopicMetadata = vi.fn(async () => {});
  const internal_dispatchTopic = vi.fn();
  const state = {
    internal_dispatchTopic,
    topicDataMap: metadata ? { k: { items: [{ id: 't', metadata }] } } : {},
    updateTopicMetadata,
  };
  return { get: () => state as any, internal_dispatchTopic, updateTopicMetadata };
};

describe('resolveRunCollaborationMode (local runs)', () => {
  beforeEach(() => {
    lab.appServer = true;
  });

  it('sends nothing for a topic that never turned Plan on, or another agent', () => {
    expect(resolveRunCollaborationMode('codex', {})).toBeUndefined();
    expect(resolveRunCollaborationMode('claude-code', { heteroPlanMode: true })).toBeUndefined();
  });

  it('sends plan or default explicitly once the topic used Plan', () => {
    expect(resolveRunCollaborationMode('codex', { heteroPlanMode: true })).toBe('plan');
    expect(resolveRunCollaborationMode('codex', { heteroPlanMode: false })).toBe('default');
  });

  it('sends nothing with the app-server lab off', () => {
    lab.appServer = false;
    expect(resolveRunCollaborationMode('codex', { heteroPlanMode: true })).toBeUndefined();
  });
});

describe('pendingHeteroPlanModeMetadata (new topics)', () => {
  beforeEach(() => {
    lab.appServer = true;
  });

  it('hands over the switch the composer showed, off included, with the app-server lab on', () => {
    setPendingHeteroPlanMode('agt', false);
    expect(pendingHeteroPlanModeMetadata('agt', 'codex')).toEqual({ heteroPlanMode: false });
    setPendingHeteroPlanMode('agt', true);
    expect(pendingHeteroPlanModeMetadata('agt', 'codex')).toEqual({ heteroPlanMode: true });
    lab.appServer = false;
    expect(pendingHeteroPlanModeMetadata('agt', 'codex')).toEqual({});
    lab.appServer = true;
    setPendingHeteroPlanMode('agt', undefined);
    expect(pendingHeteroPlanModeMetadata('agt', 'codex')).toEqual({});
  });
});

describe('applyCollaborationModeReport', () => {
  it('leaves a switch the user flipped mid-run alone when Codex only confirms the request', async () => {
    const store = storeWith({ heteroPlanMode: false });
    await applyCollaborationModeReport(
      store.get,
      't',
      { collaborationMode: 'plan', requested: 'plan' },
      { persist: true },
    );
    expect(store.updateTopicMetadata).not.toHaveBeenCalled();
  });

  it('follows Codex where it disagrees with the request, writing a local run', async () => {
    const store = storeWith({ heteroPlanMode: true });
    await applyCollaborationModeReport(
      store.get,
      't',
      { collaborationMode: 'default', requested: 'plan' },
      { persist: true },
    );
    expect(store.updateTopicMetadata).toHaveBeenCalledWith('t', { heteroPlanMode: false });
  });

  it('follows the server-written report in memory for a run hosted by lh', async () => {
    const store = storeWith({ heteroPlanMode: true });
    await applyCollaborationModeReport(
      store.get,
      't',
      { collaborationMode: 'default', requested: 'plan' },
      { persist: false },
    );
    expect(store.updateTopicMetadata).not.toHaveBeenCalled();
    expect(store.internal_dispatchTopic).toHaveBeenCalledWith(
      expect.objectContaining({ value: { metadata: { heteroPlanMode: false } } }),
    );
  });
});

describe('shouldShowCodexPlanDecision', () => {
  const plan = (id: string) => ({
    plugin: { apiName: 'proposed_plan', identifier: 'codex' },
    role: 'tool',
    tool_call_id: id,
  });
  const messages = [{ role: 'user' }, { role: 'assistant' }, plan('p1'), { role: 'assistant' }];
  const show = (overrides: Partial<Parameters<typeof shouldShowCodexPlanDecision>[0]> = {}) =>
    shouldShowCodexPlanDecision({
      messages,
      metadata: { heteroPlanMode: true },
      running: false,
      toolCallId: 'p1',
      ...overrides,
    });

  beforeEach(() => {
    lab.appServer = true;
  });

  it('shows under the latest plan once the topic is idle with Plan on', () => {
    expect(show()).toBe(true);
  });

  it('hides while the topic runs, with Plan off, or once dismissed', () => {
    expect(show({ running: true })).toBe(false);
    expect(show({ metadata: { heteroPlanMode: false } })).toBe(false);
    expect(
      show({
        metadata: { codexPlanDecision: { dismissed: true, itemId: 'p1' }, heteroPlanMode: true },
      }),
    ).toBe(false);
    // A dismissal of an older plan does not hide a newer one.
    expect(
      show({
        metadata: { codexPlanDecision: { dismissed: true, itemId: 'p0' }, heteroPlanMode: true },
      }),
    ).toBe(true);
  });

  it('hides after the user wrote again or a newer plan arrived', () => {
    expect(show({ messages: [...messages, { role: 'user' }] })).toBe(false);
    expect(show({ messages: [...messages, plan('p2')] })).toBe(false);
  });

  it('hides with the app-server lab off', () => {
    lab.appServer = false;
    expect(show()).toBe(false);
  });
});

describe('plan decision', () => {
  it('executes by turning Plan off before the message that carries the plan out', async () => {
    const order: string[] = [];
    const updateTopicMetadata = vi.fn(async (_id: string, patch: unknown) => {
      order.push(`update:${JSON.stringify(patch)}`);
    });
    const sendMessage = vi.fn(async ({ message }: { message: string }) => {
      order.push(`send:${message}`);
    });
    // A draft the user typed meanwhile is not what this sends: keep it.

    await executeCodexPlan({
      message: 'Execute the plan above.',
      sendMessage,
      toolCallId: 'p1',
      topicId: 't',
      updateTopicMetadata,
    });

    expect(order).toEqual([
      'update:{"codexPlanDecision":{"dismissed":true,"itemId":"p1"},"heteroPlanMode":false}',
      'send:Execute the plan above.',
    ]);
    expect(sendMessage).toHaveBeenCalledWith({
      message: 'Execute the plan above.',
      preserveComposer: true,
    });
  });

  it('keeps discussing by only putting the buttons away', async () => {
    const updateTopicMetadata = vi.fn(async () => {});
    await dismissCodexPlan({ toolCallId: 'p1', topicId: 't', updateTopicMetadata });
    expect(updateTopicMetadata).toHaveBeenCalledWith('t', {
      codexPlanDecision: { dismissed: true, itemId: 'p1' },
    });
  });
});
