'use client';

import { Alert } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Feishu / Lark push a group message the bot was not @-mentioned in only when the app holds
 * `im:message.group_msg`. Without it keywords and wake rules save fine but never fire, and
 * nothing on the page would say why, so the wake tab names the scope up front.
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
