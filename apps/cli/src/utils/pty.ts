/**
 * `@lydell/node-pty` is a native module: it ships a prebuilt binary per
 * platform and cannot be bundled, so it stays a real runtime dependency and is
 * marked external in `tsdown.config.ts`. It is also imported lazily, because
 * the CLI bundle is embedded in contexts that have no `node_modules` at all
 * (the desktop app runs it from `Resources/bin`) — a static import would make
 * every one of those fail at startup, while a host that never opens a terminal
 * never resolves this at all.
 */
const importPty = () => import('@lydell/node-pty');
let ptyModule: ReturnType<typeof importPty> | undefined;

export const loadPty = () => {
  ptyModule ??= importPty();
  // A failed load stays retryable instead of caching the rejection forever.
  ptyModule.catch(() => {
    ptyModule = undefined;
  });
  return ptyModule;
};
