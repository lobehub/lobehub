import { copyToClipboard } from '@lobehub/ui';
import { toast } from '@lobehub/ui/base-ui';
import { Braces } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';

import { defineAction } from '../defineAction';

/**
 * Dev-tool action (visible only with Advanced Tools enabled): copies this
 * message's id — the handle for `lh` queries, eval cases and bug reports.
 *
 * For a group message the useful id is the underlying assistant message, not
 * the aggregate group, same as `copyOperationId`.
 */
export const copyMessageIdAction = defineAction({
  key: 'copyMessageId',
  useBuild: (ctx) => {
    const { t } = useTranslation('chat');
    const isDevMode = useUserStore((s) => userGeneralSettingsSelectors.config(s).isDevMode);
    const messageId = ctx.contentBlock?.id ?? ctx.id;

    return useMemo(() => {
      if (!isDevMode || !messageId) return null;
      return {
        handleClick: async () => {
          await copyToClipboard(messageId);
          toast.success(t('copySuccess', { ns: 'common' }));
        },
        icon: Braces,
        key: 'copyMessageId',
        label: t('messageAction.copyMessageId'),
      };
    }, [t, isDevMode, messageId]);
  },
});
