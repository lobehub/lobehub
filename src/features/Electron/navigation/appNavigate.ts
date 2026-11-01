import { stableWorkspaceAwareNavigate } from '@/features/Workspace/stableWorkspaceAwareNavigate';
import { type WorkspaceAwareNavigateOptions } from '@/features/Workspace/workspaceAwarePath';

export type AppNavigateTarget = 'activeTab' | 'newTab';

export interface AppNavigateOptions extends WorkspaceAwareNavigateOptions {
  target?: AppNavigateTarget;
}

export const appNavigate = (to: string, opts: AppNavigateOptions = {}): void => {
  // Web has a single router; `target` (active vs new tab) is desktop-only.
  const { target: _target, ...rest } = opts;
  void _target;
  stableWorkspaceAwareNavigate(to, rest);
};
