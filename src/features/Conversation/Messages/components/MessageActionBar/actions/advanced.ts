import { Wrench } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';

import { defineAction } from '../defineAction';

/**
 * Shell for the "Advanced" submenu — it carries only the label and icon; what
 * it contains is decided by the menu that lists it, and it disappears when
 * none of those children apply.
 *
 * It exists because the developer-facing actions (ids to paste into a trace,
 * capturing a turn as an eval case) are individually rare but collectively a
 * category, and left flat they crowd the menu everyone else uses.
 *
 * The whole drawer is developer-facing, so Advanced Tools gates it here rather
 * than child by child: one place to reason about, and it covers children that
 * carry no dev gate of their own (capturing a case is gated on Labs instead).
 */
export const advancedAction = defineAction({
  key: 'advanced',
  useBuild: () => {
    const { t } = useTranslation('chat');
    const isDevMode = useUserStore((s) => userGeneralSettingsSelectors.config(s).isDevMode);

    return useMemo(
      () =>
        isDevMode ? { icon: Wrench, key: 'advanced', label: t('messageAction.advanced') } : null,
      [t, isDevMode],
    );
  },
});
