'use client';

import { Button, Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { PlatformAvatar } from '../constants';

const SlackLinkBody = memo(() => {
  const { t } = useTranslation('messenger');

  return (
    <>
      <PlatformAvatar platform="slack" size={64} />
      <Flexbox align="center" gap={6}>
        <Text strong style={{ fontSize: 18 }}>
          {t('messenger.slack.connectModal.title')}
        </Text>
        <Text style={{ textAlign: 'center' }} type="secondary">
          {t('messenger.slack.connectModal.description')}
        </Text>
      </Flexbox>
      <Button
        block
        href="/api/agent/messenger/slack/install"
        size="large"
        target="_blank"
        type="primary"
      >
        {t('messenger.slack.connectModal.continueButton')}
      </Button>
    </>
  );
});

SlackLinkBody.displayName = 'MessengerSlackLinkBody';

export default SlackLinkBody;
