import net from 'node:net';

/**
 * Which loopback address actually answers on a port.
 *
 * The gateway pins tunnel targets to `127.0.0.1`, but plenty of dev servers
 * bind `localhost`, which newer Node resolves to `::1` only — `vite` with no
 * `--host` does exactly that on macOS. Dialing `127.0.0.1` then gets
 * ECONNREFUSED for a server that is plainly running. So before a tunnel dials
 * out, probe the port and fall back to `::1` when IPv4 refuses. Both are
 * loopback, so the security boundary is unchanged.
 *
 * Probing is a TCP connect-and-close, done before the real request so the
 * request itself (and any streamed body) is only ever sent once. Results are
 * cached briefly per port; a stale answer costs one failed request, after
 * which the cache entry is dropped.
 */

const PROBE_TIMEOUT_MS = 1000;
const CACHE_TTL_MS = 30_000;

type Probe = (host: string, port: number) => Promise<boolean>;

const tcpProbe: Probe = (host, port) =>
  new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(PROBE_TIMEOUT_MS, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });

export class LoopbackResolver {
  private cache = new Map<number, { expires: number; host: string }>();

  constructor(private probe: Probe = tcpProbe) {}

  /**
   * The host to dial for `target`. Anything other than `127.0.0.1` passes
   * through untouched; for `127.0.0.1` the answer is `::1` only when IPv4
   * refuses and IPv6 accepts. If neither answers, `127.0.0.1` is returned so
   * the real request produces the real error.
   */
  async resolve(target: { host: string; port: number }): Promise<string> {
    if (target.host !== '127.0.0.1') return target.host;

    const cached = this.cache.get(target.port);
    if (cached && cached.expires > Date.now()) return cached.host;

    let host = '127.0.0.1';
    if (!(await this.probe('127.0.0.1', target.port)) && (await this.probe('::1', target.port))) {
      host = '::1';
    }
    this.cache.set(target.port, { expires: Date.now() + CACHE_TTL_MS, host });
    return host;
  }

  /** Forget a port's answer, e.g. after a request to it failed to connect. */
  forget(port: number): void {
    this.cache.delete(port);
  }
}
