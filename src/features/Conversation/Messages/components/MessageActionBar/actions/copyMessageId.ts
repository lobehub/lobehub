import { copyToClipboard, toast } from '@lobehub/ui';
import { Braces } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { defineAction } from '../defineAction';

/**
 * Copies this message's id — the handle for `lh` queries, eval cases and bug reports.
 *
 * For a group message the useful id is the underlying assistant message, not
 * the aggregate group, same as `copyOperationId`.
 */
export const copyMessageIdAction = defineAction({
  key: 'copyMessageId',
  useBuild: (ctx) => {
    const { t } = useTranslation('chat');
    const messageId = ctx.contentBlock?.id ?? ctx.id;

    return useMemo(() => {
      if (!messageId) return null;
      return {
        handleClick: async () => {
          await copyToClipboard(messageId);
          toast.success(t('copySuccess', { ns: 'common' }));
        },
        icon: Braces,
        key: 'copyMessageId',
        label: t('messageAction.copyMessageId'),
      };
    }, [t, messageId]);
  },
});
