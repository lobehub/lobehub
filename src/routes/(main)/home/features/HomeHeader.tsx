import { DEFAULT_INBOX_AVATAR } from '@lobechat/const';
import { Avatar, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';
import { agentSelectors, builtinAgentSelectors } from '@/store/agent/selectors';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/slices/auth/selectors';

const styles = createStaticStyles(({ css }) => ({
  greeting: css`
    margin: 0;
    font-size: 22px;
    line-height: 1.4;
    letter-spacing: -0.01em;
  `,
  name: css`
    font-size: 14px;
    line-height: 20px;
  `,
}));

const getGreetingKey = (hour: number): 'afternoon' | 'evening' | 'morning' => {
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
};

/** CJK greetings already end on a full-width stop, which carries its own trailing space. */
const joinGreeting = (greeting: string, subtitle: string) =>
  /[。！？]$/.test(greeting) ? `${greeting}${subtitle}` : `${greeting} ${subtitle}`;

const HomeHeader = memo(() => {
  const { t } = useTranslation('home');
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const inboxMeta = useAgentStore(agentSelectors.getAgentMetaById(inboxAgentId ?? ''));
  const displayName = useUserStore(userProfileSelectors.displayUserName);
  const avatar = inboxMeta.avatar || DEFAULT_INBOX_AVATAR;

  const greeting = t(`dashboard.greeting.${getGreetingKey(new Date().getHours())}`, {
    name: displayName,
  });

  return (
    <Flexbox gap={16} justify={'center'}>
      <Flexbox horizontal align={'center'} gap={8}>
        <Avatar emojiScaleWithBackground avatar={avatar} shape={'square'} size={24} />
        <Text className={styles.name} weight={600}>
          {inboxMeta.title || 'Lobe AI'}
        </Text>
      </Flexbox>
      <Text as={'h1'} className={styles.greeting} weight={600}>
        {joinGreeting(greeting, t('dashboard.greeting.subtitle'))}
      </Text>
    </Flexbox>
  );
});

export default HomeHeader;
