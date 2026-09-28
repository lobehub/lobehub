import { copyToClipboard } from '@lobehub/ui';
import { toast } from '@lobehub/ui/base-ui';
import { Copy } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { cleanBotPromptTags } from '@/store/chat/utils/parseReferencedMessage';
import { unescapeMarkdown } from '@/store/chat/utils/unescapeMarkdown';

import { defineAction } from '../defineAction';

export const copyAction = defineAction({
  key: 'copy',
  useBuild: (ctx) => {
    const { t } = useTranslation('common');

    return useMemo(() => {
      const raw =
        ctx.role === 'group' ? (ctx.contentBlock?.content ?? ctx.data.content) : ctx.data.content;
      const content = ctx.role === 'user' ? unescapeMarkdown(cleanBotPromptTags(raw)) : raw;

      return {
        handleClick: async () => {
          await copyToClipboard(content);
          toast.success(t('copySuccess'));
        },
        icon: Copy,
        key: 'copy',
        label: t('copy'),
      };
    }, [t, ctx.role, ctx.data.content, ctx.contentBlock?.content]);
  },
});
