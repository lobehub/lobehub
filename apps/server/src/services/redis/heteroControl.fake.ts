import { vi } from 'vitest';

/**
 * Emulates the control scripts over in-memory lists and hashes, reading the
 * `<id|status>\t<expiry>\n<json>` headers the way the scripts do. The same
 * cases run against a real Redis in `heteroControl.realRedis.test.ts`.
 */
export const createHeteroControlFakeRedis = () => {
  const lists = new Map<string, string[]>();
  const hashes = new Map<string, Map<string, string>>();
  const hashOf = (key: string) => hashes.get(key) ?? hashes.set(key, new Map()).get(key)!;
  const header = (value: string) => value.slice(0, value.indexOf('\n')).split('\t');
  const stateOf = (status: string, expiry: string, payload = '') =>
    `${status}\t${expiry}\n${payload}`;

  const evalScript = vi.fn(async (script: string, numKeys: number, ...rest: any[]) => {
    const keys = rest.slice(0, numKeys).map(String);
    const args = rest.slice(numKeys).map(String);

    if (script.includes("stateOf('pending', ARGV[2])")) {
      const [queue, states] = keys;
      const [id, expiry, item] = args;
      hashOf(states).set(id, stateOf('pending', expiry));
      lists.set(queue, [...(lists.get(queue) ?? []), item]);
      return 1;
    }
    if (script.includes("redis.call('LPOP'")) {
      const [queue, states] = keys;
      const now = Number(args[0]);
      const list = lists.get(queue) ?? [];
      while (list.length > 0) {
        const item = list.shift()!;
        const [id, expiry] = header(item);
        const state = hashOf(states).get(id);
        if (!state || header(state)[0] !== 'pending') continue;
        if (Number(expiry) <= now) {
          hashOf(states).set(id, stateOf('expired', expiry));
          continue;
        }
        hashOf(states).set(id, stateOf('claimed', expiry));
        return item;
      }
      return null;
    }
    if (script.includes("return 'recorded'")) {
      const [states] = keys;
      const [id, status, payload] = args;
      const state = hashOf(states).get(id);
      if (!state) return 'absent';
      const [current, expiry] = header(state);
      if (current !== 'claimed') return current;
      hashOf(states).set(id, stateOf(status, expiry, payload));
      return 'recorded';
    }
    if (script.includes("status == 'pending' and tonumber(expiry)")) {
      const [states] = keys;
      const [id, now] = args;
      const state = hashOf(states).get(id);
      if (!state) return null;
      const [status, expiry] = header(state);
      if (status === 'pending' && Number(expiry) <= Number(now)) {
        hashOf(states).set(id, stateOf('expired', expiry));
        return stateOf('expired', expiry);
      }
      return state;
    }
    throw new Error('unexpected script');
  });

  return { eval: evalScript };
};
