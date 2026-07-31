import { Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserStore } from '@/store/user';
import { authSelectors, userProfileSelectors } from '@/store/user/slices/auth/selectors';

import AgentSelect from './AgentSelect';

const styles = createStaticStyles(({ css }) => ({
  // A fixed measure, not a fluid one: collapsing the rail changes this column's
  // width, and a headline that re-wraps on collapse would shove the composer
  // and the whole task list down by a line. Wide enough that a long display
  // name still fits, narrow enough to stay clear of the portrait's bubble.
  greeting: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;

    max-width: 440px;
    margin: 0;

    font-size: 22px;
    line-height: 1.4;
    letter-spacing: -0.01em;

    @media (width <= 1100px) {
      max-width: none;
    }
  `,
  toolbar: css`
    width: 100%;
    min-width: 0;
    min-height: 48px;
  `,
}));

const getGreetingKey = (hour: number): 'afternoon' | 'evening' | 'morning' => {
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
};

const HomeHeader = memo(() => {
  const { t } = useTranslation('home');
  const displayName = useUserStore(userProfileSelectors.displayUserName);
  const isLogin = useUserStore(authSelectors.isLogin);

  const greetingKey = getGreetingKey(new Date().getHours());
  const greeting = isLogin
    ? t(`dashboard.greeting.${greetingKey}`, { name: displayName })
    : t(`dashboard.greeting.${greetingKey}Guest`);

  return (
    <Flexbox gap={16} justify={'center'}>
      <Flexbox horizontal align={'center'} className={styles.toolbar} gap={16}>
        <AgentSelect />
      </Flexbox>
      <Text as={'h1'} className={styles.greeting} weight={600}>
        {greeting}
      </Text>
    </Flexbox>
  );
});

export default HomeHeader;
