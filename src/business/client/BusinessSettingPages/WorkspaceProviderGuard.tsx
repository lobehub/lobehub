import type { PropsWithChildren, ReactNode } from 'react';

/**
 * Wraps the workspace provider settings. A business build renders an
 * explanation instead where the workspace may not bring its own keys.
 */
export function WorkspaceProviderGuard({ children }: PropsWithChildren): ReactNode {
  return children;
}
