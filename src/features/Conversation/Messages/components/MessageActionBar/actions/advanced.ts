import { Wrench } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { defineAction } from '../defineAction';

/**
 * Shell for the "Advanced" submenu — it carries only the label and icon; what
 * it contains is decided by the menu that lists it, and it disappears when
 * none of those children apply.
 *
 * It exists because the developer-facing actions (ids to paste into a trace,
 * capturing a turn as an eval case) are individually rare but collectively a
 * category, and left flat they crowd the menu everyone else uses.
 */
export const advancedAction = defineAction({
  key: 'advanced',
  useBuild: () => {
    const { t } = useTranslation('chat');

    return useMemo(
      () => ({ icon: Wrench, key: 'advanced', label: t('messageAction.advanced') }),
      [t],
    );
  },
});
