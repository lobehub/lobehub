'use client';

import { Alert } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Feishu / Lark push a group message the bot was not @-mentioned in only when the app holds
 * `im:message.group_msg`, and another bot's message only with
 * `im:message.group_msg.include_bot:read` on top. Without the first, keywords and wake rules save
 * fine but never fire; without the second, the wake judgement never sees what other bots said.
 * Nothing on the page would say why, so the wake tab names both scopes up front.
 */
const FeishuWakeNotice = memo(() => {
  const { t } = useTranslation('agent');

  return (
    <Alert
      showIcon
      description={t('channel.wake.feishuScope.desc')}
      title={t('channel.wake.feishuScope.title')}
      type={'info'}
    />
  );
});

FeishuWakeNotice.displayName = 'FeishuWakeNotice';

export default FeishuWakeNotice;
