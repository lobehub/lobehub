import type { BuiltinPortalProps } from '@lobechat/types';
import { memo, useCallback, useMemo } from 'react';

import { userService } from '@/services/user';
import { useUserStore } from '@/store/user';
import { keyVaultsConfigSelectors } from '@/store/user/selectors';

import CredentialsManager from './CredentialsManager';

const normalizePath = (raw: string) =>
  raw
    .trim()
    .replaceAll(/\.+/g, '.')
    .replaceAll(/^\.|\.$/g, '');

const getPrefixFromPath = (rawPath?: string) => {
  if (!rawPath) return undefined;

  const path = normalizePath(rawPath);
  if (!path) return undefined;

  const segments = path.split('.');
  if (segments.length <= 1) return path;

  return segments.slice(0, -1).join('.');
};

const CredentialsPortal = memo<BuiltinPortalProps>(({ arguments: args, state }) => {
  const keyVaults = useUserStore(
    (s) => keyVaultsConfigSelectors.keyVaultsSettings(s) as Record<string, any>,
  );
  const refreshUserState = useUserStore((s) => s.refreshUserState);

  const forcedPrefix = useMemo(() => {
    const argumentsPrefix =
      typeof args?.prefix === 'string' ? normalizePath(args.prefix) : undefined;
    if (argumentsPrefix) return argumentsPrefix;

    const argumentsPathPrefix = getPrefixFromPath(
      typeof args?.path === 'string' ? args.path : undefined,
    );
    if (argumentsPathPrefix) return argumentsPathPrefix;

    const statePrefix = typeof state?.prefix === 'string' ? normalizePath(state.prefix) : undefined;
    if (statePrefix) return statePrefix;

    const statePathPrefix = getPrefixFromPath(
      typeof state?.path === 'string' ? state.path : undefined,
    );
    if (statePathPrefix) return statePathPrefix;

    return undefined;
  }, [args?.path, args?.prefix, state?.path, state?.prefix]);

  const persistKeyVaults = useCallback(
    async (next: Record<string, any>) => {
      await userService.updateUserSettings({ keyVaults: next });
      await refreshUserState();
    },
    [refreshUserState],
  );

  return (
    <CredentialsManager
      forcedPrefix={forcedPrefix}
      keyVaults={keyVaults}
      onPersist={persistKeyVaults}
    />
  );
});

CredentialsPortal.displayName = 'CredentialsPortal';

export default CredentialsPortal;
export { CredentialsManager };
