/** The router fan-outs cap concurrent per-item I/O at this many calls. */
export const FANOUT_CAP = 5;

/** Item count used by fan-out tests — comfortably above {@link FANOUT_CAP}. */
export const FANOUT_COUNT = 12;

export const fanoutRange = Array.from({ length: FANOUT_COUNT }, (_, i) => i);

/**
 * Wraps an async implementation so it records the peak number of overlapping
 * calls. Each call yields across a macrotask so unbounded fan-outs overlap.
 */
export const trackInFlight = <A extends unknown[], R>(impl: (...args: A) => R) => {
  const state = { inFlight: 0, peak: 0 };
  const fn = async (...args: A) => {
    state.inFlight += 1;
    state.peak = Math.max(state.peak, state.inFlight);
    await new Promise((resolve) => setTimeout(resolve, 1));
    state.inFlight -= 1;
    return impl(...args);
  };
  return { fn, state };
};

export const wechatLink = (i: number) => ({
  activeAgentId: null,
  applicationId: `wechat-bot-${i}`,
  createdAt: new Date('2026-07-17T00:00:00.000Z'),
  id: `wechat-link-${i}`,
  platform: 'wechat',
  platformUserId: `wechat-user-${i}`,
  tenantId: `wechat-user-${i}`,
  userId: 'user-1',
  workspaceId: null,
});

export const slackInstall = (i: number) => ({
  applicationId: `A_${i}`,
  createdAt: new Date('2026-05-06T00:00:00.000Z'),
  credentials: { botToken: `xoxb-${i}` },
  id: `install-${i}`,
  installedByUserId: 'user-1',
  metadata: { scope: 'chat:write', tenantName: `Team ${i}` },
  platform: 'slack',
  tenantId: `T_${i}`,
});
