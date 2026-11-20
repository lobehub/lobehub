/**
 * In-memory stand-in for the slice of ioredis the LLM relay uses (strings with
 * PX/NX, counters, one Redis Stream per key, MULTI). One store is shared by
 * every `duplicate()`, so the relay runtime and the upload handlers can run
 * against the same "server" in a test.
 */
interface StreamEntry {
  fields: string[];
  id: string;
}

interface Store {
  expiresAt: Map<string, number>;
  seq: number;
  streams: Map<string, StreamEntry[]>;
  strings: Map<string, string>;
}

export class FakeRedis {
  disconnected = false;

  constructor(private readonly store: Store = createStore()) {}

  duplicate() {
    return new FakeRedis(this.store);
  }

  disconnect() {
    this.disconnected = true;
  }

  async get(key: string) {
    this.evict(key);
    return this.store.strings.get(key) ?? null;
  }

  async set(key: string, value: string, ...args: (string | number)[]) {
    this.evict(key);
    if (args.includes('NX') && this.store.strings.has(key)) return null;
    this.store.strings.set(key, value);
    const px = args.indexOf('PX');
    if (px !== -1) this.store.expiresAt.set(key, Date.now() + Number(args[px + 1]));
    return 'OK';
  }

  async del(...keys: string[]) {
    let removed = 0;
    for (const key of keys) {
      if (this.store.strings.delete(key) || this.store.streams.delete(key)) removed++;
      this.store.expiresAt.delete(key);
    }
    return removed;
  }

  async pttl(key: string) {
    this.evict(key);
    if (!this.store.strings.has(key) && !this.store.streams.has(key)) return -2;
    const expiresAt = this.store.expiresAt.get(key);
    return expiresAt === undefined ? -1 : expiresAt - Date.now();
  }

  async pexpire(key: string, ms: number) {
    this.store.expiresAt.set(key, Date.now() + ms);
    return 1;
  }

  async incrby(key: string, by: number) {
    const next = Number((await this.get(key)) ?? 0) + by;
    this.store.strings.set(key, String(next));
    return next;
  }

  async xadd(key: string, ...args: (string | number)[]) {
    const star = args.indexOf('*');
    const fields = args.slice(star + 1).map(String);
    const id = `${++this.store.seq}-0`;
    const entries = this.store.streams.get(key) ?? [];
    entries.push({ fields, id });
    this.store.streams.set(key, entries);
    return id;
  }

  async xread(...args: (string | number)[]) {
    const block = args.indexOf('BLOCK');
    const streamsAt = args.indexOf('STREAMS');
    const key = String(args[streamsAt + 1]);
    const lastId = String(args[streamsAt + 2]);
    const readNew = () =>
      (this.store.streams.get(key) ?? []).filter((entry) => compareIds(entry.id, lastId) > 0);

    let entries = readNew();
    if (entries.length === 0 && block !== -1) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(Number(args[block + 1]), 5)));
      entries = readNew();
    }
    if (entries.length === 0) return null;
    return [[key, entries.map((entry) => [entry.id, entry.fields])]];
  }

  multi() {
    const queued: (() => Promise<unknown>)[] = [];
    const chain: any = new Proxy(
      {},
      {
        get: (_target, property: string) => {
          if (property === 'exec') {
            return async () => {
              const results: [null, unknown][] = [];
              for (const run of queued) results.push([null, await run()]);
              return results;
            };
          }
          return (...args: unknown[]) => {
            queued.push(() => (this as any)[property](...args));
            return chain;
          };
        },
      },
    );
    return chain;
  }

  /** Test helper: current value of a string key. */
  peek(key: string) {
    this.evict(key);
    return this.store.strings.get(key);
  }

  /** Test helper: raw stream entries of a key. */
  peekStream(key: string) {
    return this.store.streams.get(key) ?? [];
  }

  private evict(key: string) {
    const expiresAt = this.store.expiresAt.get(key);
    if (expiresAt !== undefined && expiresAt <= Date.now()) {
      this.store.strings.delete(key);
      this.store.streams.delete(key);
      this.store.expiresAt.delete(key);
    }
  }
}

const createStore = (): Store => ({
  expiresAt: new Map(),
  seq: 0,
  streams: new Map(),
  strings: new Map(),
});

const compareIds = (a: string, b: string) => Number(a.split('-')[0]) - Number(b.split('-')[0]);
