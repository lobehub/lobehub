import { copyToClipboard } from '@lobehub/ui';
import { App } from 'antd';
import { Copy } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { cleanSpeakerTag } from '@/store/chat/utils/cleanSpeakerTag';

import { defineAction } from '../defineAction';

export const copyAction = defineAction({
  key: 'copy',
  useBuild: (ctx) => {
    const { t } = useTranslation('common');
    const { message } = App.useApp();

    return useMemo(() => {
      const raw =
        ctx.role === 'group' ? (ctx.contentBlock?.content ?? ctx.data.content) : ctx.data.content;
      const content = ctx.role === 'user' ? cleanSpeakerTag(raw) : raw;

      return {
        handleClick: async () => {
          await copyToClipboard(content);
          message.success(t('copySuccess'));
        },
        icon: Copy,
        key: 'copy',
        label: t('copy'),
      };
    }, [t, message, ctx.role, ctx.data.content, ctx.contentBlock?.content]);
  },
});
