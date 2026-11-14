'use client';

import { type ComponentType, lazy, Suspense } from 'react';

type CommandMenuModule = { default: ComponentType };

// Lazy load the CommandMenu component with React lazy
// This splits the CommandMenu code into a separate chunk that only loads when needed
// The chunk carries the Shiki/oniguruma WASM payload. On browsers that reject
// synchronous WebAssembly compilation above 4KB on the main thread, the chunk
// rejects during module evaluation. Contain that rejection: global search is
// optional, so a failed chunk resolves to a component that renders nothing
// instead of taking down the app shell.
export const loadCommandMenu = (): Promise<CommandMenuModule> =>
  import('@/features/CommandMenu').catch(() => ({ default: () => null }));

const CmdkComponent = lazy(loadCommandMenu);

const CmdkLazy = () => (
  <Suspense fallback={null}>
    <CmdkComponent />
  </Suspense>
);

export default CmdkLazy;
