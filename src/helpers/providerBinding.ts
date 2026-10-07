import type { HeterogeneousProviderBindingError } from '@lobechat/heterogeneous-agents';
import type { HeterogeneousProviderConfig } from '@lobechat/types';

interface ResolveProviderBindingGuardInput {
  active: boolean;
  error?: HeterogeneousProviderBindingError;
  isReady: boolean;
}

export const resolveProviderBindingGuard = ({
  active,
  error,
  isReady,
}: ResolveProviderBindingGuardInput) => ({
  blocked: active && (!isReady || !!error),
  error: active && isReady ? error : undefined,
});

/**
 * Reports whether the selected runtime can resolve a provider binding.
 *
 * Use when:
 * - Rendering the API composer or selecting its dispatcher.
 *
 * Expects:
 * - The resolved execution target and actual agent workspace ownership.
 *
 * Returns:
 * - Whether this target supports the binding; provider validity is checked separately.
 */
export const isProviderBindingTargetSupported = (
  target: string,
  provider: HeterogeneousProviderConfig | undefined,
  isWorkspaceAgent: boolean,
): boolean =>
  target === 'local' ||
  (target === 'device' &&
    provider?.type === 'codex' &&
    provider.authMode === 'api' &&
    Boolean(provider.apiConfig) &&
    provider.apiConfig?.source !== 'server-default' &&
    !isWorkspaceAgent);
