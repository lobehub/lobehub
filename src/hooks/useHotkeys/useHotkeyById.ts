import { uniq } from 'es-toolkit/compat';
import { type DependencyList } from 'react';
import { type HotkeyCallback, type Options } from 'react-hotkeys-hook';
import { useHotkeys } from 'react-hotkeys-hook';

import { HOTKEYS_REGISTRATION } from '@/const/hotkeys';
import { useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';
import { type HotkeyId } from '@/types/hotkey';
import { isDev } from '@/utils/env';

type OptionsOrDependencyArray = Options | DependencyList;

export const useHotkeyById = (
  hotkeyId: HotkeyId,
  callback: HotkeyCallback,
  options?: OptionsOrDependencyArray,
  dependencies?: OptionsOrDependencyArray,
) => {
  const hotkey = useUserStore(settingsSelectors.getHotkeyById(hotkeyId));
  const mobile = useServerConfigStore((s) => s.isMobile);

  const _options: Options | undefined = !Array.isArray(options)
    ? (options as Options)
    : !Array.isArray(dependencies)
      ? (dependencies as Options)
      : undefined;

  const _deps: DependencyList | undefined = Array.isArray(options)
    ? options
    : Array.isArray(dependencies)
      ? dependencies
      : undefined;

  const item = HOTKEYS_REGISTRATION.find((item) => item.id === hotkeyId);

  const ref = useHotkeys(
    hotkey,
    (...props) => {
      if (isDev) console.log('[Hotkey]', hotkeyId);
      return callback(...props);
    },
    {
      enableOnFormTags: true,
      preventDefault: true,
      ..._options,
      enabled: !mobile && _options?.enabled,
      scopes: uniq([hotkeyId, ...(item?.scopes || []), ...(_options?.scopes || [])]),
    },
    _deps,
  );

  return {
    id: hotkeyId,
    ref,
  };
};
