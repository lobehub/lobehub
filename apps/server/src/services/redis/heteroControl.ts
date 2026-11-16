import { RedisKeys } from '@/server/modules/Redis';

import { getRedisServiceClient } from './client';

const getClient = () => getRedisServiceClient('agentSteer');

/**
 * How long a run's control keys outlive their last write. It bounds how long a
 * message may wait to be claimed (see {@link HETERO_CONTROL_MAX_TTL_MS}) plus
 * how long its result stays readable; only garbage collection relies on it.
 */
const KEY_TTL_SECONDS = 60 * 60;

/** Upper bound on how long one control message may wait for a poller. */
export const HETERO_CONTROL_MAX_TTL_MS = 10 * 60 * 1000;

/**
 * A command for a running heterogeneous agent session (Claude Code), delivered
 * through the run's `waitHeteroSteer` long-poll. The command set is open: the
 * run answers `unsupported` for one it has no handler for.
 */
export interface HeteroControlMessage {
  command: string;
  createdAt: number;
  id: string;
  params: unknown;
}

/** What the run reported after handling a control message. */
export type HeteroControlReport =
  { data?: unknown; status: 'ok' } | { status: 'unsupported' } | { error: string; status: 'error' };

/**
 * Where a control message stands:
 * - `pending`: no poller claimed it yet;
 * - `claimed`: a poller took it and has not reported (still running, or the
 *   run died while handling it — it is never handed out again);
 * - `expired`: nobody claimed it in time: the run ended, or its `lh` predates
 *   control messages and never declares `acceptsControl`;
 * - otherwise the {@link HeteroControlReport} the run sent back.
 */
export type HeteroControlState =
  { status: 'claimed' } | { status: 'expired' } | { status: 'pending' } | HeteroControlReport;

export type HeteroControlStatus = HeteroControlState['status'];

/** Outcome of {@link heteroControl.report}. */
export type HeteroControlReportOutcome =
  /** Stored: the message was claimed and had no result yet. */
  | 'recorded'
  /** No such message on this run (or its state expired). */
  | 'absent'
  /** Not claimed, or already settled: the report is ignored. */
  | Exclude<HeteroControlStatus, 'claimed'>;

// A queued item is `<id>\t<expires at ms>\n<message JSON>`, and a state value
// `<status>\t<expires at ms>\n<report JSON or empty>`, so the scripts read ids,
// statuses and expiry without parsing JSON.
const LUA_HELPERS = `
local function header(value)
  local nl = string.find(value, '\\n', 1, true)
  if not nl then return nil, nil end
  local head = string.sub(value, 1, nl - 1)
  local tab = string.find(head, '\\t', 1, true)
  if not tab then return nil, nil end
  return string.sub(head, 1, tab - 1), string.sub(head, tab + 1)
end
local function stateOf(status, expiry, payload)
  return status .. '\\t' .. expiry .. '\\n' .. (payload or '')
end
`;

/**
 * KEYS[1] = queue; KEYS[2] = states; ARGV[1] = id; ARGV[2] = expires at ms;
 * ARGV[3] = item; ARGV[4] = key ttl
 */
const ENQUEUE_SCRIPT = `${LUA_HELPERS}
redis.call('HSET', KEYS[2], ARGV[1], stateOf('pending', ARGV[2]))
redis.call('RPUSH', KEYS[1], ARGV[3])
redis.call('EXPIRE', KEYS[1], ARGV[4])
redis.call('EXPIRE', KEYS[2], ARGV[4])
return 1
`;

/**
 * Pops the oldest message still pending and marks it claimed, in one step.
 * Messages past their expiry, or already settled by a reader's lazy expiry,
 * are dropped on the way. The pop is the claim: nothing puts a message back.
 *
 * KEYS[1] = queue; KEYS[2] = states; ARGV[1] = now ms; ARGV[2] = key ttl
 */
const CLAIM_SCRIPT = `${LUA_HELPERS}
local now = tonumber(ARGV[1])
while true do
  local item = redis.call('LPOP', KEYS[1])
  if not item then return false end
  local id, expiry = header(item)
  local state = id and redis.call('HGET', KEYS[2], id)
  if state then
    local status = header(state)
    if status == 'pending' then
      if tonumber(expiry) <= now then
        redis.call('HSET', KEYS[2], id, stateOf('expired', expiry))
      else
        redis.call('HSET', KEYS[2], id, stateOf('claimed', expiry))
        redis.call('EXPIRE', KEYS[2], ARGV[2])
        return item
      end
    end
  end
end
`;

/**
 * Reads one message's state, settling a pending one past its expiry as
 * expired first: a claim after that finds it settled and skips it.
 *
 * KEYS[1] = states; ARGV[1] = id; ARGV[2] = now ms
 */
const READ_SCRIPT = `${LUA_HELPERS}
local state = redis.call('HGET', KEYS[1], ARGV[1])
if not state then return false end
local status, expiry = header(state)
if status == 'pending' and tonumber(expiry) <= tonumber(ARGV[2]) then
  state = stateOf('expired', expiry)
  redis.call('HSET', KEYS[1], ARGV[1], state)
end
return state
`;

/**
 * Stores a result for a claimed message; any other state is left as is and
 * returned, so a repeated or late report changes nothing.
 *
 * KEYS[1] = states; ARGV[1] = id; ARGV[2] = status; ARGV[3] = report JSON;
 * ARGV[4] = key ttl
 */
const REPORT_SCRIPT = `${LUA_HELPERS}
local state = redis.call('HGET', KEYS[1], ARGV[1])
if not state then return 'absent' end
local status, expiry = header(state)
if status ~= 'claimed' then return status end
redis.call('HSET', KEYS[1], ARGV[1], stateOf(ARGV[2], expiry, ARGV[3]))
redis.call('EXPIRE', KEYS[1], ARGV[4])
return 'recorded'
`;

const queueKeyOf = (operationId: string) => RedisKeys.agentSteer.heteroControl(operationId);
const stateKeyOf = (operationId: string) => RedisKeys.agentSteer.heteroControlState(operationId);

const bodyOf = (value: string) => value.slice(value.indexOf('\n') + 1);

const parseState = (raw: unknown): HeteroControlState | undefined => {
  if (typeof raw !== 'string') return;
  const head = raw.slice(0, Math.max(raw.indexOf('\n'), 0));
  const status = head.slice(0, Math.max(head.indexOf('\t'), 0));
  switch (status) {
    case 'pending':
    case 'claimed':
    case 'expired': {
      return { status };
    }
    case 'ok':
    case 'unsupported':
    case 'error': {
      try {
        return JSON.parse(bodyOf(raw)) as HeteroControlReport;
      } catch {
        return status === 'error' ? { error: 'Unreadable report', status } : { status };
      }
    }
  }
};

/**
 * Control messages for running heterogeneous agent sessions, per operation.
 *
 * Delivery is at most once: a claim pops the message, and nothing re-queues
 * it. Unlike a steer follow-up — whose batch stays leased and returns to the
 * queue when the run dies, since a lost user message must still start a turn —
 * a control command acts on the live process (stop a task, change a setting).
 * Replaying one into a later session, or twice into the same one, could act on
 * something the sender never meant, so a claimed message whose run never
 * reports stays `claimed` and its sender times out instead.
 *
 * Every write throws without Redis; reads answer `undefined`.
 */
export const heteroControl = {
  /**
   * Queues a message for `operationId`'s poller. It waits until `expiresAt`;
   * unclaimed by then, it reads as `expired`.
   *
   * @throws when Redis is unavailable — the message cannot be delivered
   */
  async enqueue(
    operationId: string,
    message: HeteroControlMessage,
    expiresAt: number,
  ): Promise<void> {
    const redis = await getClient();
    if (!redis) throw new Error('Redis is unavailable to queue a control message');

    await redis.eval(
      ENQUEUE_SCRIPT,
      2,
      queueKeyOf(operationId),
      stateKeyOf(operationId),
      message.id,
      expiresAt,
      `${message.id}\t${expiresAt}\n${JSON.stringify(message)}`,
      KEY_TTL_SECONDS,
    );
  },

  /**
   * Takes the oldest pending message and marks it claimed. A message is
   * claimed by one poller at most, once.
   *
   * @returns the message, or `undefined` when none is pending (or without Redis)
   */
  async claim(operationId: string): Promise<HeteroControlMessage | undefined> {
    const redis = await getClient();
    if (!redis) return;

    const item = await redis.eval<unknown>(
      CLAIM_SCRIPT,
      2,
      queueKeyOf(operationId),
      stateKeyOf(operationId),
      Date.now(),
      KEY_TTL_SECONDS,
    );
    if (typeof item !== 'string') return;
    try {
      return JSON.parse(bodyOf(item)) as HeteroControlMessage;
    } catch {
      return;
    }
  },

  /**
   * Stores the run's result for a message it claimed. Only the first report
   * for a claimed message counts.
   *
   * @throws when Redis is unavailable
   */
  async report(
    operationId: string,
    id: string,
    report: HeteroControlReport,
  ): Promise<HeteroControlReportOutcome> {
    const redis = await getClient();
    if (!redis) throw new Error('Redis is unavailable to record a control result');

    return (await redis.eval<string>(
      REPORT_SCRIPT,
      1,
      stateKeyOf(operationId),
      id,
      report.status,
      JSON.stringify(report),
      KEY_TTL_SECONDS,
    )) as HeteroControlReportOutcome;
  },

  /**
   * Where one message stands (see {@link HeteroControlState}).
   *
   * @returns `undefined` for an unknown id, or without Redis
   */
  async read(operationId: string, id: string): Promise<HeteroControlState | undefined> {
    const redis = await getClient();
    if (!redis) return;

    return parseState(
      await redis.eval<unknown>(READ_SCRIPT, 1, stateKeyOf(operationId), id, Date.now()),
    );
  },
};
