'use client';

import { INBOX_SESSION_ID } from '@lobechat/const';
import { Avatar, Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

import { styles } from './style';

const QuoteBanner = memo(() => {
  const { t } = useTranslation('onboarding');
  const avatar = useAgentStore(agentSelectors.getAgentMetaById(INBOX_SESSION_ID)).avatar;

  return (
    <Flexbox horizontal align={'center'} className={styles.bannerContent} gap={16}>
      <Avatar avatar={avatar} className={styles.bannerAvatar} size={64} />
      <Text className={styles.bannerQuote}>
        {t('flow.steps.messenger.quote')}{' '}
        <Text as={'span'} className={styles.bannerQuoteHighlight}>
          {t('flow.steps.messenger.quoteHighlight')}
        </Text>
      </Text>
    </Flexbox>
  );
});

QuoteBanner.displayName = 'MessengerQuoteBanner';

export default QuoteBanner;
