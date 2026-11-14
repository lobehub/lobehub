'use client';

import { Component, lazy, type PropsWithChildren, Suspense } from 'react';

// Lazy load the CommandMenu component with React lazy
// This splits the CommandMenu code into a separate chunk that only loads when needed
const CmdkComponent = lazy(() => import('@/features/CommandMenu'));

/**
 * The CommandMenu chunk carries the Shiki/oniguruma syntax-highlighting WASM
 * payload. On browsers that reject synchronous WebAssembly compilation above
 * 4KB on the main thread that chunk throws while it initializes, and a lazy
 * component's init error is fatal to the whole tree unless a boundary sits
 * between it and the app shell. Global search is a convenience, not a
 * prerequisite, so contain the failure: the menu silently disappears and the
 * rest of the page keeps working.
 */
class CmdkErrorBoundary extends Component<PropsWithChildren, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

const CmdkLazy = () => (
  <CmdkErrorBoundary>
    <Suspense fallback={null}>
      <CmdkComponent />
    </Suspense>
  </CmdkErrorBoundary>
);

export default CmdkLazy;
