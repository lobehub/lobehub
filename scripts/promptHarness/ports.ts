import net from 'node:net';

const FORBIDDEN_PORTS = new Set([3010, 3311, 8080, 3901, 3902]);

export const assertHarnessPort = (port: number): number => {
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
    throw new Error(`Invalid harness port: ${port}`);
  }
  if (FORBIDDEN_PORTS.has(port)) {
    throw new Error(
      `Refusing shared/development port ${port}; the harness must allocate an ephemeral port.`,
    );
  }
  return port;
};

const canBind = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen({ host: '127.0.0.1', port }, () => {
      server.close(() => resolve(true));
    });
  });

export const allocatePort = async (avoid: readonly number[] = []): Promise<number> => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const port = await new Promise<number>((resolve, reject) => {
      const server = net.createServer();
      server.unref();
      server.once('error', reject);
      server.listen({ host: '127.0.0.1', port: 0 }, () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          server.close();
          reject(new Error('Unable to allocate an ephemeral port.'));
          return;
        }
        const allocated = address.port;
        server.close(() => resolve(allocated));
      });
    });

    if (!avoid.includes(port) && (await canBind(port))) {
      return assertHarnessPort(port);
    }
  }

  throw new Error('Unable to allocate a unique ephemeral port.');
};

export const isPortOpen = (host: string, port: number, timeoutMs = 500): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const finish = (open: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(timeoutMs, () => finish(false));
  });

export const waitForPort = async ({
  host = '127.0.0.1',
  port,
  timeoutMs = 120_000,
}: {
  host?: string;
  port: number;
  timeoutMs?: number;
}): Promise<void> => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isPortOpen(host, port)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Port ${host}:${port} did not open within ${timeoutMs}ms.`);
};

export const waitForHttp = async ({
  timeoutMs = 180_000,
  url,
}: {
  timeoutMs?: number;
  url: string;
}): Promise<Response> => {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (response.status < 500) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(
    `HTTP endpoint ${url} did not become ready within ${timeoutMs}ms: ${String(lastError)}`,
  );
};
