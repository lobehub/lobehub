import { Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserStore } from '@/store/user';
import { authSelectors, userProfileSelectors } from '@/store/user/slices/auth/selectors';

import AgentSelect from './AgentSelect';

const styles = createStaticStyles(({ css }) => ({
  // The measure comes from the layout (`--home-greeting-measure`), which derives
  // it from the container width: it has to clear the portrait's bubble, and it
  // must not depend on the rail, or collapsing would re-wrap the headline and
  // shove the composer and the whole task list down by a line.
  greeting: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;

    max-width: var(--home-greeting-measure, none);
    margin: 0;

    font-size: 22px;
    line-height: 1.4;
    letter-spacing: -0.01em;
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
