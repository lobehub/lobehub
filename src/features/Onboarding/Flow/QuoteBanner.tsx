'use client';

import { INBOX_SESSION_ID } from '@lobechat/const';
import { Avatar, Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';

import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

import { styles } from './style';

interface QuoteBannerProps {
  highlight: string;
  quote: string;
}

const QuoteBanner = memo<QuoteBannerProps>(({ highlight, quote }) => {
  const avatar = useAgentStore(agentSelectors.getAgentMetaById(INBOX_SESSION_ID)).avatar;

  return (
    <Flexbox horizontal align={'center'} className={styles.bannerContent} gap={16}>
      <Avatar avatar={avatar} className={styles.bannerAvatar} size={64} />
      <Text className={styles.bannerQuote}>
        {quote}{' '}
        <Text as={'span'} className={styles.bannerQuoteHighlight}>
          {highlight}
        </Text>
      </Text>
    </Flexbox>
  );
});

QuoteBanner.displayName = 'OnboardingQuoteBanner';

export default QuoteBanner;
