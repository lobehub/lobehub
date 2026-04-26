// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  consumePairingRequest,
  createOrGetPairingRequest,
  generatePairingCode,
  PAIRING_MAX_PENDING_PER_BOT,
  PAIRING_TTL_SECONDS,
} from '../dmPairingStore';

// ioredis surface used by the store. `multi` returns a chainable builder
// whose terminal `exec()` resolves to an array. Each test resets these
// mocks so cross-test state doesn't leak.
const multiBuilder = {
  del: vi.fn(),
  exec: vi.fn(),
  expire: vi.fn(),
  sadd: vi.fn(),
  set: vi.fn(),
  srem: vi.fn(),
};

const mockRedis = {
  del: vi.fn(),
  exists: vi.fn(),
  get: vi.fn(),
  multi: vi.fn(() => multiBuilder),
  scard: vi.fn(),
} as any;

beforeEach(() => {
  vi.clearAllMocks();
  // Re-establish chain returns after clearAllMocks wipes them
  multiBuilder.set.mockReturnValue(multiBuilder);
  multiBuilder.sadd.mockReturnValue(multiBuilder);
  multiBuilder.expire.mockReturnValue(multiBuilder);
  multiBuilder.del.mockReturnValue(multiBuilder);
  multiBuilder.srem.mockReturnValue(multiBuilder);
  multiBuilder.exec.mockResolvedValue([]);
  mockRedis.multi.mockReturnValue(multiBuilder);
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
    mockRedis.scard.mockResolvedValue(0); // no capacity pressure
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
    // Active set — code is added, set TTL refreshed
    expect(multiBuilder.sadd).toHaveBeenCalledWith(
      'bot:dm-pairing:active:discord:app-123',
      result.code,
    );
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
    expect(multiBuilder.sadd).not.toHaveBeenCalled();
  });

  it('falls through to a fresh code when the applicant index points at an expired entry', async () => {
    // applicant index exists, but the code-keyed entry is gone (TTL elapsed
    // mid-window). Issue a new code rather than returning a dead reference.
    mockRedis.get
      .mockResolvedValueOnce('STALECODE') // applicantKey lookup
      .mockResolvedValueOnce(null); // codeKey is empty
    mockRedis.scard.mockResolvedValue(0);
    mockRedis.exists.mockResolvedValue(0);

    const result = await createOrGetPairingRequest({ ...baseParams, redis: mockRedis });
    expect(result.status).toBe('created');
    expect(multiBuilder.set).toHaveBeenCalled();
  });

  it('returns capacity-exceeded when the per-bot pending cap is hit', async () => {
    mockRedis.get.mockResolvedValue(null);
    mockRedis.scard.mockResolvedValue(PAIRING_MAX_PENDING_PER_BOT);

    const result = await createOrGetPairingRequest({ ...baseParams, redis: mockRedis });
    expect(result).toEqual({ status: 'capacity-exceeded' });
    // No state mutation when capacity is exceeded
    expect(multiBuilder.set).not.toHaveBeenCalled();
    expect(multiBuilder.sadd).not.toHaveBeenCalled();
  });

  it('regenerates on a code collision (defensive — astronomically unlikely)', async () => {
    mockRedis.get.mockResolvedValue(null);
    mockRedis.scard.mockResolvedValue(0);
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
  });

  it('returns null and cleans up the malformed key when JSON is corrupt', async () => {
    mockRedis.get.mockResolvedValue('not-json');
    const result = await consumePairingRequest({ ...baseParams, redis: mockRedis });
    expect(result).toBeNull();
    // Best-effort cleanup so the bad entry doesn't sit around
    expect(mockRedis.del).toHaveBeenCalledWith('bot:dm-pairing:code:discord:app-123:ABCD2345');
  });

  it('happy path: returns the entry and tears down all three keys atomically', async () => {
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
    expect(multiBuilder.srem).toHaveBeenCalledWith(
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
