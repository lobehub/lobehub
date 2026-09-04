import type { Server } from 'node:http';

import honoApp from './index';
import { createStandaloneServer, resolveStandaloneOptions } from './standaloneServer';

type HonoStandaloneGlobal = typeof globalThis & {
  __lobeHonoStandaloneServer?: Server;
  __lobeHonoStandaloneSignalHandler?: (signal: NodeJS.Signals) => void;
};

const SHUTDOWN_SIGNALS: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];

const closePreviousServer = (previousServer: Server | undefined) =>
  new Promise<void>((resolve) => {
    if (!previousServer?.listening) {
      resolve();
      return;
    }

    previousServer.close(() => resolve());
  });

const startServer = async () => {
  const standaloneGlobal = globalThis as HonoStandaloneGlobal;
  const options = resolveStandaloneOptions();
  const { close, listen, server } = createStandaloneServer(honoApp, options);

  await closePreviousServer(standaloneGlobal.__lobeHonoStandaloneServer);
  standaloneGlobal.__lobeHonoStandaloneServer = server;

  const previousHandler = standaloneGlobal.__lobeHonoStandaloneSignalHandler;
  let shuttingDown = false;
  const onSignal = (signal: NodeJS.Signals) => {
    if (shuttingDown) process.exit(1);
    shuttingDown = true;
    console.info(`Hono runtime received ${signal}, draining in-flight requests and after() tasks`);
    void close().then((result) => {
      console.info(
        result === 'closed'
          ? 'Hono runtime stopped'
          : `Hono runtime shutdown timed out after ${options.shutdownTimeoutMs}ms`,
      );
      process.exit(result === 'closed' ? 0 : 1);
    });
  };
  for (const signal of SHUTDOWN_SIGNALS) {
    if (previousHandler) process.off(signal, previousHandler);
    process.on(signal, onSignal);
  }
  standaloneGlobal.__lobeHonoStandaloneSignalHandler = onSignal;

  process.title = `lobe-dev-hono-${options.port}`;
  await listen();
  console.info(`Hono runtime ready at http://${options.host}:${options.port}`);
};

void startServer().catch((error) => {
  console.error('Failed to start Hono runtime:', error);
  process.exitCode = 1;
});
