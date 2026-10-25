// @vitest-environment node
import { createFollowupGate } from './followupGate';

const mockDefer = vi.hoisted(() => vi.fn());
vi.mock('../deferredMessages', () => ({ deferBotMessages: mockDefer }));

const msg = (id: string) => ({ id, text: id }) as never;
const base = (overrides: Record<string, unknown> = {}) => ({
  entryPoint: 'onSubscribedMessage' as const,
  merged: msg('m2'),
  parked: [msg('m1'), msg('m2')],
  thread: { id: 'discord:g:c1' },
  threadSubscribed: true,
  ...overrides,
});

const setup = (deps: { decision?: unknown; rolledOut?: boolean; scheduler?: unknown } = {}) => {
  const observe = vi.fn();
  const judge = vi.fn(async () => deps.decision as never);
  const isRolledOut = vi.fn(async () => deps.rolledOut ?? true);
  const gate = createFollowupGate({
    applicationId: 'app',
    observe,
    platform: 'discord',
    recorder: { isRolledOut, judge },
    scheduler: deps.scheduler as never,
  });

  return { gate, isRolledOut, judge, observe };
};

describe('follow-up gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDefer.mockResolvedValue(true);
  });

  it('proceeds untouched while the rollout is off: no judging, no scheduling, no parking', async () => {
    const submit = vi.fn(async () => 'hold' as const);
    const { gate, isRolledOut, judge, observe } = setup({
      decision: { decidedBy: 'x', reason: 'r', verdict: 'deny' },
      rolledOut: false,
      scheduler: { submit },
    });

    expect(await gate(base())).toBe('proceed');
    expect(isRolledOut).toHaveBeenCalled();
    expect(judge).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(mockDefer).not.toHaveBeenCalled();
    expect(observe).not.toHaveBeenCalled();
  });

  it('proceeds when nothing enforces and there is no scheduler (the default)', async () => {
    const { gate, observe } = setup();

    expect(await gate(base())).toBe('proceed');
    expect(observe).not.toHaveBeenCalled();
    expect(mockDefer).not.toHaveBeenCalled();
  });

  it('stops and records when an enforcing policy denied', async () => {
    const { gate, observe } = setup({
      decision: { decidedBy: 'bot-wake:owner-rules', reason: 'channel-denied', verdict: 'deny' },
    });

    expect(await gate(base())).toBe('stop');
    expect(observe).toHaveBeenCalledWith(
      'onSubscribedMessage',
      expect.anything(),
      { id: 'discord:g:c1' },
      'skip',
      'policy-denied',
      true,
    );
  });

  it.each(['allow', 'abstain'] as const)('proceeds on an enforced %s', async (verdict) => {
    const { gate } = setup({ decision: { records: [], verdict } });

    expect(await gate(base())).toBe('proceed');
  });

  it('parks every message behind the batch when the scheduler holds it', async () => {
    const scheduler = { submit: vi.fn(async () => 'hold') };
    const { gate, observe } = setup({ scheduler });

    expect(await gate(base())).toBe('stop');
    expect(scheduler.submit).toHaveBeenCalledWith({
      channelKey: 'discord:app:g:c1',
      messages: [
        { id: 'm1', threadId: 'discord:g:c1' },
        { id: 'm2', threadId: 'discord:g:c1' },
      ],
    });
    expect(mockDefer).toHaveBeenCalledWith('app', 'discord:g:c1', [msg('m1'), msg('m2')]);
    expect(observe).toHaveBeenCalledWith(
      'onSubscribedMessage',
      expect.anything(),
      expect.anything(),
      'defer',
      'scheduled',
      true,
    );
  });

  it('files a Discord thread message under its parent channel so one run covers both', async () => {
    const scheduler = { submit: vi.fn(async () => 'hold') };
    const { gate } = setup({ scheduler });
    await gate(base({ thread: { id: 'discord:g:c1:t5' } }));

    expect(scheduler.submit).toHaveBeenCalledWith(
      expect.objectContaining({ channelKey: 'discord:app:g:c1' }),
    );
  });

  it('lets the released batch through when it is replayed', async () => {
    const { gate } = setup({ scheduler: { submit: vi.fn(async () => 'release') } });

    expect(await gate(base())).toBe('proceed');
    expect(mockDefer).not.toHaveBeenCalled();
  });

  it('submits a replayed batch under the platform ids the scheduler parked', async () => {
    const scheduler = { submit: vi.fn(async () => 'release') };
    const { gate } = setup({ scheduler });
    const replay = { id: 'm1:replay:1710000000000:0', text: 'm1' } as never;

    expect(await gate(base({ merged: replay, parked: [replay] }))).toBe('proceed');
    expect(scheduler.submit).toHaveBeenCalledWith({
      channelKey: 'discord:app:g:c1',
      messages: [{ id: 'm1', threadId: 'discord:g:c1' }],
    });
  });

  it('fails open to the old behaviour when the scheduler or the parking store is unavailable', async () => {
    expect(
      await setup({ scheduler: { submit: vi.fn(async () => 'unavailable') } }).gate(base()),
    ).toBe('proceed');

    mockDefer.mockResolvedValue(false);
    expect(await setup({ scheduler: { submit: vi.fn(async () => 'hold') } }).gate(base())).toBe(
      'proceed',
    );
  });

  it('checks the enforced policies before it touches the scheduler', async () => {
    const scheduler = { submit: vi.fn() };
    const { gate } = setup({ decision: { reason: 'x', verdict: 'deny' }, scheduler });

    await gate(base());
    expect(scheduler.submit).not.toHaveBeenCalled();
  });
});
