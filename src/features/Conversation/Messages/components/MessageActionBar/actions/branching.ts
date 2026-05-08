import { App } from 'antd';
import { Split } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';

import { defineAction } from '../defineAction';

export const branchingAction = defineAction({
  key: 'branching',
  useBuild: (ctx) => {
    const { t } = useTranslation('common');
    const { message } = App.useApp();
    const [topic, openThreadCreator] = useChatStore((s) => [s.activeTopicId, s.openThreadCreator]);

    return useMemo(
      () => ({
        handleClick: () => {
          if (!topic) {
            message.warning(t('branchingRequiresSavedTopic'));
            return;
          }
          openThreadCreator(ctx.id);
        },
        icon: Split,
        key: 'branching',
        label: t('branching'),
      }),
      [t, ctx.id, topic, openThreadCreator, message],
    );
  },
});
