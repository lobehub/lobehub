import { Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
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
  // The measure is the layout's answer to the portrait, which the centered
  // block does not have — so the headline runs to the block's own width.
  greetingCentered: css`
    max-width: none;
    text-align: center;
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

interface HomeHeaderProps {
  centered?: boolean;
}

const HomeHeader = memo<HomeHeaderProps>(({ centered }) => {
  const { t } = useTranslation('home');
  const displayName = useUserStore(userProfileSelectors.displayUserName);
  const isLogin = useUserStore(authSelectors.isLogin);

  const greetingKey = getGreetingKey(new Date().getHours());
  const greeting = isLogin
    ? t(`dashboard.greeting.${greetingKey}`, { name: displayName })
    : t(`dashboard.greeting.${greetingKey}Guest`);

  return (
    <Flexbox gap={16} justify={'center'}>
      {!centered && (
        <Flexbox horizontal align={'center'} className={styles.toolbar} gap={16}>
          <AgentSelect />
        </Flexbox>
      )}
      <Text
        as={'h1'}
        className={cx(styles.greeting, centered && styles.greetingCentered)}
        weight={600}
      >
        {greeting}
      </Text>
    </Flexbox>
  );
});

export default HomeHeader;
