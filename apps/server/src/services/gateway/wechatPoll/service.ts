import debug from 'debug';

import { getWechatPollServiceIdleMs, getWechatPollShardCount } from './config';
import { type RunWechatPollShardOptions, runWechatPollTick } from './shardRunner';

const log = debug('lobe-server:wechat-poll:service');

export interface RunWechatPollServiceOptions extends Omit<RunWechatPollShardOptions, 'shouldStop'> {
  /**
   * Idle pause between ticks that did not win a shard; injectable for tests.
   * Defaults to `WECHAT_POLL_SERVICE_IDLE_MS` (one minute).
   */
  idleMs?: number;
  /** Stops every loop: in-flight workers exit within one supervision tick. */
  signal?: AbortSignal;
}

const abortableSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(onDone, ms);
    function onDone() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onDone);
      resolve();
    }
    signal?.addEventListener('abort', onDone);
  });

/**
 * Resident driver for the WeChat shard poller: one claim loop per shard, each
 * repeatedly running the ordinary tick (mode state machine + lease race +
 * worker window) until the abort signal fires.
 *
 * A loop whose tick ran a full worker window re-ticks immediately, so the next
 * window reclaims the lease within milliseconds — window boundaries are
 * membership refreshes, not handover gaps. Every other outcome (disabled,
 * lease held, transition pending) idles for a beat; that periodic idle tick is
 * also what detects mode transitions, so flipping the env flag takes effect
 * within about one idle period.
 *
 * Resolves once every loop has wound down after the signal fires.
 */
export const runWechatPollService = async (
  options: RunWechatPollServiceOptions = {},
): Promise<void> => {
  const { idleMs, signal, ...tickOptions } = options;
  const shardCount = getWechatPollShardCount();
  const idle = idleMs ?? getWechatPollServiceIdleMs();
  const stopped = () => signal?.aborted === true;

  log('service starting: %d shard loop(s), idle=%dms', shardCount, idle);

  const runLoop = async (loop: number): Promise<void> => {
    // Stagger the loops so they don't stampede the same shard's lease on boot.
    await abortableSleep(loop * 250, signal);

    while (!stopped()) {
      let wasWorker = false;
      try {
        const result = await runWechatPollTick({ ...tickOptions, shouldStop: stopped });
        wasWorker = result.role === 'worker';
        log('loop=%d tick: %o', loop, result);
      } catch (err: any) {
        log('loop=%d tick failed: %s', loop, err?.message);
      }
      // A finished worker window rolls straight into the next claim; anything
      // else waits out one idle period before probing again.
      if (!wasWorker && !stopped()) await abortableSleep(idle, signal);
    }

    log('loop=%d stopped', loop);
  };

  await Promise.all(Array.from({ length: shardCount }, (_, loop) => runLoop(loop)));
  log('service stopped');
};
