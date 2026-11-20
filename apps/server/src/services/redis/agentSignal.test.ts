import { beforeEach, describe, expect, it, vi } from 'vitest';

import { redisService } from './index';

const client = vi.hoisted(() => ({
  current: undefined as Record<string, ReturnType<typeof vi.fn>> | null | undefined,
}));
const getRedisServiceClient = vi.hoisted(() => vi.fn());
vi.mock('./client', () => ({ getRedisServiceClient }));

const createClient = () => ({
  decr: vi.fn().mockResolvedValue(0),
  eval: vi.fn().mockResolvedValue(['t1']),
  expire: vi.fn().mockResolvedValue(1),
  incr: vi.fn().mockResolvedValue(1),
  set: vi.fn().mockResolvedValue('OK'),
});

describe('redisService.agentSignal', () => {
  beforeEach(() => {
    client.current = createClient();
    getRedisServiceClient.mockReset();
    getRedisServiceClient.mockImplementation(async () => client.current ?? null);
  });

  it('reads and writes through the agentSignal key scope', async () => {
    await redisService.agentSignal.countClassifierCall({ userId: 'u', utcDay: '2026-10-11' });

    expect(getRedisServiceClient).toHaveBeenCalledWith('agentSignal');
  });

  it('counts classifier calls per user and UTC day, outliving the day', async () => {
    await expect(
      redisService.agentSignal.countClassifierCall({ userId: 'u', utcDay: '2026-10-11' }),
    ).resolves.toBe(1);

    expect(client.current!.incr).toHaveBeenCalledWith('classifier_calls:v1:u:2026-10-11');
    expect(client.current!.expire).toHaveBeenCalledWith(
      'classifier_calls:v1:u:2026-10-11',
      2 * 24 * 60 * 60,
    );
  });

  it('takes and releases declaration slots in one topic scope', async () => {
    await redisService.agentSignal.takeDeclarationSlot('topic:t1');
    await redisService.agentSignal.releaseDeclarationSlot('topic:t1');

    expect(client.current!.incr).toHaveBeenCalledWith('declaration_slots:v1:topic:t1');
    expect(client.current!.expire).toHaveBeenCalledWith(
      'declaration_slots:v1:topic:t1',
      24 * 60 * 60,
    );
    expect(client.current!.decr).toHaveBeenCalledWith('declaration_slots:v1:topic:t1');
  });

  it('opens the manual-trigger window with its expiry before counting', async () => {
    await redisService.agentSignal.countManualTrigger('u');

    expect(client.current!.set).toHaveBeenCalledWith('manual_triggers:v1:u', '0', {
      ex: 3600,
      nx: true,
    });
    expect(client.current!.set.mock.invocationCallOrder[0]).toBeLessThan(
      client.current!.incr.mock.invocationCallOrder[0],
    );
  });

  it('claims nightly topics atomically against the limit for one user and night', async () => {
    await expect(
      redisService.agentSignal.claimNightlyTopics({
        limit: 50,
        localDate: '2026-10-11',
        topicIds: ['t1', 't2'],
        userId: 'u',
      }),
    ).resolves.toEqual(['t1']);

    expect(client.current!.eval).toHaveBeenCalledWith(
      expect.stringContaining('SISMEMBER'),
      1,
      'nightly_topics:v1:u:2026-10-11',
      50,
      3 * 24 * 60 * 60,
      't1',
      't2',
    );
  });

  it('answers undefined for every count when Redis is unavailable', async () => {
    client.current = null;

    await expect(
      redisService.agentSignal.countClassifierCall({ userId: 'u', utcDay: '2026-10-11' }),
    ).resolves.toBeUndefined();
    await expect(redisService.agentSignal.takeDeclarationSlot('s')).resolves.toBeUndefined();
    await expect(redisService.agentSignal.countManualTrigger('u')).resolves.toBeUndefined();
    await expect(
      redisService.agentSignal.claimNightlyTopics({
        limit: 50,
        localDate: '2026-10-11',
        topicIds: ['t1'],
        userId: 'u',
      }),
    ).resolves.toBeUndefined();
  });
});
