// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  consumePairingRequest,
  createOrGetPairingRequest,
  deletePairingRequest,
  generatePairingCode,
  PAIRING_MAX_PENDING_PER_BOT,
  PAIRING_TTL_SECONDS,
  peekPairingRequest,
  releasePairingClaim,
} from '../dmPairingStore';

// ioredis surface used by the store. `multi` returns a chainable builder
// whose terminal `exec()` resolves to an array. Each test resets these
// mocks so cross-test state doesn't leak.
const multiBuilder = {
  del: vi.fn(),
  exec: vi.fn(),
  expire: vi.fn(),
  set: vi.fn(),
  zadd: vi.fn(),
  zrem: vi.fn(),
};

const mockRedis = {
  del: vi.fn(),
  exists: vi.fn(),
  get: vi.fn(),
  multi: vi.fn(() => multiBuilder),
  set: vi.fn(),
  zcard: vi.fn(),
  zremrangebyscore: vi.fn(),
} as any;

beforeEach(() => {
  vi.clearAllMocks();
  // Re-establish chain returns after clearAllMocks wipes them
  multiBuilder.set.mockReturnValue(multiBuilder);
  multiBuilder.zadd.mockReturnValue(multiBuilder);
  multiBuilder.expire.mockReturnValue(multiBuilder);
  multiBuilder.del.mockReturnValue(multiBuilder);
  multiBuilder.zrem.mockReturnValue(multiBuilder);
  multiBuilder.exec.mockResolvedValue([]);
  mockRedis.multi.mockReturnValue(multiBuilder);
  mockRedis.zremrangebyscore.mockResolvedValue(0);
  // peek/consume always try to acquire the claim first; default to "won".
  mockRedis.set.mockResolvedValue('OK');
});

describe('generatePairingCode', () => {
  it('returns an 8-character Crockford-Base32 code (no 0/1/I/L/O/U)', () => {
    const code = generatePairingCode();
    expect(code).toHaveLength(8);
    // Excluded glyphs would produce ambiguous codes when re-typed by the
    // owner — guard that the alphabet stays intentional.
    expect(code).toMatch(/^[A-HJKMNP-TV-Z2-9]{8}$/);
  });

  it('produces independent codes across calls (no obvious correlation)', () => {
    const codes = new Set(Array.from({ length: 50 }, () => generatePairingCode()));
    // 50 codes from a 30^8 space have a vanishing collision probability;
    // anything less than 50 means generation is broken (e.g. fixed seed).
    expect(codes.size).toBe(50);
  });
});

describe('createOrGetPairingRequest', () => {
  const baseParams = {
    applicant: {
      applicantUserId: 'stranger-1',
      applicantUserName: 'Stranger',
      replyLocale: 'en-US' as const,
      threadId: 'discord:dm-channel-1',
    },
    applicationId: 'app-123',
    platform: 'discord',
  };

  it('returns redis-unavailable when no client is wired', async () => {
    const result = await createOrGetPairingRequest({ ...baseParams, redis: null });
    expect(result).toEqual({ status: 'redis-unavailable' });
  });

  it('mints a fresh code and writes the code-, applicant-, and active-set keys', async () => {
    mockRedis.get.mockResolvedValue(null); // no existing applicant entry
    mockRedis.zcard.mockResolvedValue(0); // no capacity pressure
    mockRedis.exists.mockResolvedValue(0); // no code collision

    const result = await createOrGetPairingRequest({ ...baseParams, redis: mockRedis });
    expect(result.status).toBe('created');
    if (result.status !== 'created') throw new Error('unreachable');
    expect(result.reused).toBe(false);
    expect(result.code).toMatch(/^[A-HJKMNP-TV-Z2-9]{8}$/);

    // Code key — JSON entry, with TTL
    expect(multiBuilder.set).toHaveBeenCalledWith(
      `bot:dm-pairing:code:discord:app-123:${result.code}`,
      expect.any(String),
      'EX',
      PAIRING_TTL_SECONDS,
    );
    // Applicant index — points back to the code, with TTL
    expect(multiBuilder.set).toHaveBeenCalledWith(
      'bot:dm-pairing:applicant:discord:app-123:stranger-1',
      result.code,
      'EX',
      PAIRING_TTL_SECONDS,
    );
    // Active set — code is added with a future-expiry score, set TTL refreshed
    expect(multiBuilder.zadd).toHaveBeenCalledWith(
      'bot:dm-pairing:active:discord:app-123',
      expect.any(Number),
      result.code,
    );
    const zaddScore = multiBuilder.zadd.mock.calls[0][1] as number;
    expect(zaddScore).toBeGreaterThan(Date.now());
    expect(multiBuilder.expire).toHaveBeenCalledWith(
      'bot:dm-pairing:active:discord:app-123',
      PAIRING_TTL_SECONDS,
    );
    expect(multiBuilder.exec).toHaveBeenCalled();

    // Persisted JSON includes everything needed by /approve later
    const persisted = JSON.parse(multiBuilder.set.mock.calls[0][1] as string);
    expect(persisted).toMatchObject({
      applicantUserId: 'stranger-1',
      applicantUserName: 'Stranger',
      applicationId: 'app-123',
      code: result.code,
      platform: 'discord',
      replyLocale: 'en-US',
      threadId: 'discord:dm-channel-1',
    });
    expect(typeof persisted.createdAt).toBe('number');
  });

  it('reuses an existing code when the same applicant DMs again within TTL', async () => {
    // applicant index exists → recycle path
    mockRedis.get
      .mockResolvedValueOnce('ABCD2345') // applicantKey lookup
      .mockResolvedValueOnce('{"code":"ABCD2345"}'); // codeKey lookup confirms it's still alive

    const result = await createOrGetPairingRequest({ ...baseParams, redis: mockRedis });
    expect(result).toEqual({ code: 'ABCD2345', reused: true, status: 'reused' });
    // Idempotent: no fresh write
    expect(multiBuilder.set).not.toHaveBeenCalled();
    expect(multiBuilder.zadd).not.toHaveBeenCalled();
  });

  it('falls through to a fresh code when the applicant index points at an expired entry', async () => {
    // applicant index exists, but the code-keyed entry is gone (TTL elapsed
    // mid-window). Issue a new code rather than returning a dead reference.
    mockRedis.get
      .mockResolvedValueOnce('STALECODE') // applicantKey lookup
      .mockResolvedValueOnce(null); // codeKey is empty
    mockRedis.zcard.mockResolvedValue(0);
    mockRedis.exists.mockResolvedValue(0);

    const result = await createOrGetPairingRequest({ ...baseParams, redis: mockRedis });
    expect(result.status).toBe('created');
    expect(multiBuilder.set).toHaveBeenCalled();
  });

  it('returns capacity-exceeded when the per-bot pending cap is hit', async () => {
    mockRedis.get.mockResolvedValue(null);
    mockRedis.zcard.mockResolvedValue(PAIRING_MAX_PENDING_PER_BOT);

    const result = await createOrGetPairingRequest({ ...baseParams, redis: mockRedis });
    expect(result).toEqual({ status: 'capacity-exceeded' });
    // No state mutation when capacity is exceeded
    expect(multiBuilder.set).not.toHaveBeenCalled();
    expect(multiBuilder.zadd).not.toHaveBeenCalled();
  });

  it('prunes naturally-expired members before counting (keeps the cap honest)', async () => {
    // Without this, codes that expired without /approve would linger in
    // the active set forever and wedge the gate at 50.
    mockRedis.get.mockResolvedValue(null);
    mockRedis.zremrangebyscore.mockResolvedValue(7); // 7 stale members dropped
    mockRedis.zcard.mockResolvedValue(0); // post-prune count
    mockRedis.exists.mockResolvedValue(0);

    const result = await createOrGetPairingRequest({ ...baseParams, redis: mockRedis });
    expect(result.status).toBe('created');
    expect(mockRedis.zremrangebyscore).toHaveBeenCalledWith(
      'bot:dm-pairing:active:discord:app-123',
      0,
      expect.any(Number),
    );
    // Prune must run before the count, not after — otherwise the gate
    // sees stale members and rejects legitimate requests.
    const pruneOrder = mockRedis.zremrangebyscore.mock.invocationCallOrder[0];
    const countOrder = mockRedis.zcard.mock.invocationCallOrder[0];
    expect(pruneOrder).toBeLessThan(countOrder);
  });

  it('regenerates on a code collision (defensive — astronomically unlikely)', async () => {
    mockRedis.get.mockResolvedValue(null);
    mockRedis.zcard.mockResolvedValue(0);
    // First exists check returns 1 (collision), second returns 0
    mockRedis.exists.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

    const result = await createOrGetPairingRequest({ ...baseParams, redis: mockRedis });
    expect(result.status).toBe('created');
    expect(mockRedis.exists).toHaveBeenCalledTimes(2);
  });
});

describe('consumePairingRequest', () => {
  const baseParams = {
    applicationId: 'app-123',
    code: 'ABCD2345',
    platform: 'discord',
  };

  it('returns null when no redis client is wired', async () => {
    const result = await consumePairingRequest({ ...baseParams, redis: null });
    expect(result).toBeNull();
  });

  it('returns null when the code is unknown / expired', async () => {
    mockRedis.get.mockResolvedValue(null);
    const result = await consumePairingRequest({ ...baseParams, redis: mockRedis });
    expect(result).toBeNull();
    expect(multiBuilder.del).not.toHaveBeenCalled();
    // Peek released its own claim so a follow-up call isn't blocked.
    expect(mockRedis.del).toHaveBeenCalledWith('bot:dm-pairing:claim:discord:app-123:ABCD2345');
  });

  it('returns null without side effects when another caller holds the claim', async () => {
    // SET NX returns null when the lock is already taken — peek bails
    // without touching the entry, so the in-flight caller can finish.
    mockRedis.set.mockResolvedValue(null);
    const result = await consumePairingRequest({ ...baseParams, redis: mockRedis });
    expect(result).toBeNull();
    expect(mockRedis.get).not.toHaveBeenCalled();
    expect(mockRedis.del).not.toHaveBeenCalled();
    expect(multiBuilder.del).not.toHaveBeenCalled();
  });

  it('returns null and cleans up the malformed key when JSON is corrupt', async () => {
    mockRedis.get.mockResolvedValue('not-json');
    const result = await consumePairingRequest({ ...baseParams, redis: mockRedis });
    expect(result).toBeNull();
    // Best-effort cleanup so the bad entry doesn't sit around. The
    // applicant index is keyed by the (unparseable) entry's userId, so
    // we can't drop it here — but the code key, claim lock, and
    // active-set member all can.
    expect(multiBuilder.del).toHaveBeenCalledWith('bot:dm-pairing:code:discord:app-123:ABCD2345');
    expect(multiBuilder.del).toHaveBeenCalledWith('bot:dm-pairing:claim:discord:app-123:ABCD2345');
    expect(multiBuilder.zrem).toHaveBeenCalledWith(
      'bot:dm-pairing:active:discord:app-123',
      'ABCD2345',
    );
  });

  it('happy path: returns the entry and tears down all four keys atomically', async () => {
    const persisted = {
      applicantUserId: 'stranger-1',
      applicantUserName: 'Stranger',
      applicationId: 'app-123',
      code: 'ABCD2345',
      createdAt: 1_700_000_000_000,
      platform: 'discord',
      replyLocale: 'en-US',
      threadId: 'discord:dm-channel-1',
    };
    mockRedis.get.mockResolvedValue(JSON.stringify(persisted));

    const result = await consumePairingRequest({ ...baseParams, redis: mockRedis });
    expect(result).toEqual(persisted);
    expect(multiBuilder.del).toHaveBeenCalledWith('bot:dm-pairing:code:discord:app-123:ABCD2345');
    expect(multiBuilder.del).toHaveBeenCalledWith(
      'bot:dm-pairing:applicant:discord:app-123:stranger-1',
    );
    expect(multiBuilder.del).toHaveBeenCalledWith('bot:dm-pairing:claim:discord:app-123:ABCD2345');
    expect(multiBuilder.zrem).toHaveBeenCalledWith(
      'bot:dm-pairing:active:discord:app-123',
      'ABCD2345',
    );
    expect(multiBuilder.exec).toHaveBeenCalled();
  });

  it('normalizes case + whitespace before lookup (codes are typed by humans)', async () => {
    mockRedis.get.mockResolvedValue(null);
    await consumePairingRequest({ ...baseParams, code: '  abcd2345  ', redis: mockRedis });
    expect(mockRedis.get).toHaveBeenCalledWith('bot:dm-pairing:code:discord:app-123:ABCD2345');
  });

  it('returns null on an empty / whitespace code without hitting redis', async () => {
    const result = await consumePairingRequest({ ...baseParams, code: '   ', redis: mockRedis });
    expect(result).toBeNull();
    expect(mockRedis.get).not.toHaveBeenCalled();
  });
});

describe('peekPairingRequest', () => {
  const baseParams = {
    applicationId: 'app-123',
    code: 'ABCD2345',
    platform: 'discord',
  };

  const persisted = {
    applicantUserId: 'stranger-1',
    applicantUserName: 'Stranger',
    applicationId: 'app-123',
    code: 'ABCD2345',
    createdAt: 1_700_000_000_000,
    platform: 'discord',
    replyLocale: 'en-US' as const,
    threadId: 'discord:dm-channel-1',
  };

  it('takes the claim and returns the entry without deleting bookkeeping', async () => {
    mockRedis.get.mockResolvedValue(JSON.stringify(persisted));

    const result = await peekPairingRequest({ ...baseParams, redis: mockRedis });
    expect(result).toEqual(persisted);
    // The claim lock is taken with NX so concurrent peeks can't both win.
    expect(mockRedis.set).toHaveBeenCalledWith(
      'bot:dm-pairing:claim:discord:app-123:ABCD2345',
      '1',
      'EX',
      expect.any(Number),
      'NX',
    );
    // Critical: peek leaves the bookkeeping intact. If we deleted here
    // and downstream persistence failed, the owner couldn't retry.
    expect(multiBuilder.del).not.toHaveBeenCalled();
    expect(multiBuilder.zrem).not.toHaveBeenCalled();
  });

  it('returns null on missing / unknown code and releases its own claim', async () => {
    mockRedis.get.mockResolvedValue(null);
    const result = await peekPairingRequest({ ...baseParams, redis: mockRedis });
    expect(result).toBeNull();
    // Without the lock release, a follow-up call would sit behind a
    // phantom 60s claim for an entry that never existed.
    expect(mockRedis.del).toHaveBeenCalledWith('bot:dm-pairing:claim:discord:app-123:ABCD2345');
    expect(multiBuilder.del).not.toHaveBeenCalled();
  });

  it('returns null without side effects when another caller holds the claim', async () => {
    mockRedis.set.mockResolvedValue(null); // SET NX failed — race lost
    const result = await peekPairingRequest({ ...baseParams, redis: mockRedis });
    expect(result).toBeNull();
    expect(mockRedis.get).not.toHaveBeenCalled();
    expect(mockRedis.del).not.toHaveBeenCalled();
  });

  it('returns null when redis is unwired', async () => {
    const result = await peekPairingRequest({ ...baseParams, redis: null });
    expect(result).toBeNull();
  });
});

describe('releasePairingClaim', () => {
  const baseParams = {
    applicationId: 'app-123',
    code: 'ABCD2345',
    platform: 'discord',
  };

  it('clears only the claim lock so the entry stays available for retry', async () => {
    await releasePairingClaim({ ...baseParams, redis: mockRedis });
    expect(mockRedis.del).toHaveBeenCalledWith('bot:dm-pairing:claim:discord:app-123:ABCD2345');
    expect(mockRedis.del).toHaveBeenCalledTimes(1);
    expect(multiBuilder.del).not.toHaveBeenCalled();
  });

  it('is a no-op when redis is unwired', async () => {
    await expect(releasePairingClaim({ ...baseParams, redis: null })).resolves.toBeUndefined();
    expect(mockRedis.del).not.toHaveBeenCalled();
  });

  it('normalizes case + whitespace before releasing', async () => {
    await releasePairingClaim({ ...baseParams, code: '  abcd2345  ', redis: mockRedis });
    expect(mockRedis.del).toHaveBeenCalledWith('bot:dm-pairing:claim:discord:app-123:ABCD2345');
  });
});

describe('deletePairingRequest', () => {
  const baseParams = {
    applicantUserId: 'stranger-1',
    applicationId: 'app-123',
    code: 'ABCD2345',
    platform: 'discord',
  };

  it('tears down all four keys atomically', async () => {
    await deletePairingRequest({ ...baseParams, redis: mockRedis });
    expect(multiBuilder.del).toHaveBeenCalledWith('bot:dm-pairing:code:discord:app-123:ABCD2345');
    expect(multiBuilder.del).toHaveBeenCalledWith(
      'bot:dm-pairing:applicant:discord:app-123:stranger-1',
    );
    expect(multiBuilder.del).toHaveBeenCalledWith('bot:dm-pairing:claim:discord:app-123:ABCD2345');
    expect(multiBuilder.zrem).toHaveBeenCalledWith(
      'bot:dm-pairing:active:discord:app-123',
      'ABCD2345',
    );
    expect(multiBuilder.exec).toHaveBeenCalled();
  });

  it('is a no-op when redis is unwired (callers should not have to guard)', async () => {
    await expect(deletePairingRequest({ ...baseParams, redis: null })).resolves.toBeUndefined();
    expect(multiBuilder.del).not.toHaveBeenCalled();
  });

  it('normalizes case + whitespace on the code before deleting', async () => {
    await deletePairingRequest({ ...baseParams, code: '  abcd2345  ', redis: mockRedis });
    expect(multiBuilder.del).toHaveBeenCalledWith('bot:dm-pairing:code:discord:app-123:ABCD2345');
    expect(multiBuilder.zrem).toHaveBeenCalledWith(
      'bot:dm-pairing:active:discord:app-123',
      'ABCD2345',
    );
  });
});
