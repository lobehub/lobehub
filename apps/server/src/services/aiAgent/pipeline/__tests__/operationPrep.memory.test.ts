// @vitest-environment node
/**
 * The memory block a server run injects: persona always, plus — only when the
 * deployment opts in — the top-k memories relevant to the run's prompt.
 */
import { RequestTrigger } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { appEnvMock } = vi.hoisted(() => ({
  appEnvMock: { ENABLE_RELEVANT_MEMORY_INJECTION: false as boolean },
}));
vi.mock('@/envs/app', () => ({ appEnv: appEnvMock }));

const getLatestPersonaDocument = vi.fn();
vi.mock('@/database/models/userMemory/persona', () => ({
  UserPersonaModel: class {
    getLatestPersonaDocument(...args: unknown[]) {
      return getLatestPersonaDocument(...args);
    }
  },
}));

const fetchRelevantMemory = vi.fn();
vi.mock('../relevantMemory', () => ({
  fetchRelevantMemory: (...args: unknown[]) => fetchRelevantMemory(...args),
}));

const { resolveInjectedUserMemory, resolveMemoryQuery } = await import('../operationPrep');

const persona = {
  persona: 'Arvin ships LobeHub releases daily.',
  tagline: 'builder',
  version: 7,
};

const relevant = {
  contexts: [{ description: 'works on the personal agent goal', id: 'ctx-1', title: 'Project' }],
  experiences: [],
  identities: [
    { description: 'ships weekly', id: 'idn-1', role: 'engineer', type: 'professional' },
  ],
  preferences: [{ conclusionDirectives: 'keep replies short', id: 'prf-1' }],
};

const call = (spendOrigin?: Parameters<typeof resolveInjectedUserMemory>[0]['spendOrigin']) =>
  resolveInjectedUserMemory({
    db: {} as never,
    prompt: 'what did I decide about the release cadence?',
    spendOrigin,
    userId: 'user-1',
    workspaceId: undefined,
  });

describe('resolveInjectedUserMemory', () => {
  beforeEach(() => {
    appEnvMock.ENABLE_RELEVANT_MEMORY_INJECTION = false;
    getLatestPersonaDocument.mockReset().mockResolvedValue(persona);
    fetchRelevantMemory.mockReset().mockResolvedValue(relevant);
  });

  it('injects the persona only while the relevant-memory switch is off', async () => {
    const memory = await call();

    expect(fetchRelevantMemory).not.toHaveBeenCalled();
    expect(memory?.memories).toEqual({
      contexts: [],
      experiences: [],
      identities: [],
      persona: { narrative: persona.persona, tagline: persona.tagline },
      preferences: [],
    });
  });

  it('returns undefined when the switch is off and there is no persona', async () => {
    getLatestPersonaDocument.mockResolvedValue(undefined);

    await expect(call()).resolves.toBeUndefined();
  });

  it('merges the retrieved memories with the persona once the switch is on', async () => {
    appEnvMock.ENABLE_RELEVANT_MEMORY_INJECTION = true;

    const memory = await call();

    expect(fetchRelevantMemory).toHaveBeenCalledWith({
      db: expect.anything(),
      prompt: 'what did I decide about the release cadence?',
      spendOrigin: undefined,
      userId: 'user-1',
      workspaceId: undefined,
    });
    expect(memory?.memories).toEqual({
      contexts: relevant.contexts,
      experiences: relevant.experiences,
      identities: relevant.identities,
      persona: { narrative: persona.persona, tagline: persona.tagline },
      preferences: relevant.preferences,
    });
  });

  it('forwards the share-visitor billing origin to retrieval', async () => {
    appEnvMock.ENABLE_RELEVANT_MEMORY_INJECTION = true;
    const spendOrigin = {
      agentShare: { agentId: 'agt-1', shareId: 'shr-1', visitorUserId: 'visitor-1' },
      trigger: RequestTrigger.AgentShare,
    };

    await call(spendOrigin);

    expect(fetchRelevantMemory).toHaveBeenCalledWith(expect.objectContaining({ spendOrigin }));
  });

  it('degrades to persona-only when retrieval throws', async () => {
    appEnvMock.ENABLE_RELEVANT_MEMORY_INJECTION = true;
    fetchRelevantMemory.mockRejectedValue(new Error('embedding provider down'));

    const memory = await call();

    expect(memory?.memories?.persona?.narrative).toBe(persona.persona);
    expect(memory?.memories?.contexts).toEqual([]);
  });

  it('still injects retrieved memories when the persona lookup throws', async () => {
    appEnvMock.ENABLE_RELEVANT_MEMORY_INJECTION = true;
    getLatestPersonaDocument.mockRejectedValue(new Error('persona table unavailable'));

    const memory = await call();

    expect(memory?.memories?.contexts).toEqual(relevant.contexts);
    expect(memory?.memories?.persona).toBeUndefined();
  });

  it('returns undefined when retrieval finds nothing and there is no persona', async () => {
    appEnvMock.ENABLE_RELEVANT_MEMORY_INJECTION = true;
    getLatestPersonaDocument.mockResolvedValue(undefined);
    fetchRelevantMemory.mockResolvedValue(undefined);

    await expect(call()).resolves.toBeUndefined();
  });
});

describe('relevant-memory query for continuation runs', () => {
  const history = [
    { content: 'what did I decide about the release cadence?', role: 'user' },
    { content: 'Let me check.', role: 'assistant' },
    { content: '{"ok":true}', role: 'tool' },
  ];

  beforeEach(() => {
    appEnvMock.ENABLE_RELEVANT_MEMORY_INJECTION = true;
    getLatestPersonaDocument.mockReset().mockResolvedValue(undefined);
    fetchRelevantMemory.mockReset().mockResolvedValue(relevant);
  });

  it('keeps the injected memories on a blank-prompt approval / tool-result resume', async () => {
    const memory = await resolveInjectedUserMemory({
      db: {} as never,
      loadHistoryMessages: async () => history,
      prompt: '',
      userId: 'user-1',
    });

    expect(fetchRelevantMemory).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'what did I decide about the release cadence?' }),
    );
    expect(memory?.memories?.contexts).toEqual(relevant.contexts);
  });

  it('does not touch history while the switch is off', async () => {
    appEnvMock.ENABLE_RELEVANT_MEMORY_INJECTION = false;
    const loadHistoryMessages = vi.fn(async () => history);

    await resolveInjectedUserMemory({
      db: {} as never,
      loadHistoryMessages,
      prompt: '',
      userId: 'user-1',
    });

    expect(loadHistoryMessages).not.toHaveBeenCalled();
  });

  it('uses the run prompt as-is when there is one, without loading history', async () => {
    const loadHistoryMessages = vi.fn(async () => history);

    await expect(resolveMemoryQuery('new question', loadHistoryMessages)).resolves.toBe(
      'new question',
    );
    expect(loadHistoryMessages).not.toHaveBeenCalled();
  });

  it('falls back to the latest non-blank user message', async () => {
    await expect(
      resolveMemoryQuery('  ', async () => [
        { content: 'older question', role: 'user' },
        { content: 'answer', role: 'assistant' },
        { content: 'latest question', role: 'user' },
        { content: '   ', role: 'user' },
        { content: '', role: 'assistant' },
      ]),
    ).resolves.toBe('latest question');
  });

  it('stays blank when history has no user text', async () => {
    await expect(
      resolveMemoryQuery('', async () => [{ content: 'hi', role: 'assistant' }]),
    ).resolves.toBe('');
  });
});
