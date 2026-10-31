import { Flexbox, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserStore } from '@/store/user';
import { authSelectors, userProfileSelectors } from '@/store/user/slices/auth/selectors';

import AgentSelect from './AgentSelect';
import { getGreetingKey } from './greeting';

const styles = stylex.create({
  root: { maxWidth: '100%' },
  greeting: {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: '2',
    margin: '0',
    fontSize: '22px',
    lineHeight: 1.4,
    letterSpacing: '-0.01em',
  },
  toolbar: { width: '100%', minWidth: '0', minHeight: '48px' },
});

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
    // Minimal mode keeps the full layout's stacking order — the switcher names
    // who speaks, the greeting answers below — but drops the toolbar chrome and
    // its 48px lane, so the pair reads as one compact block flush with the
    // composer. The layout's lift math (MINIMAL_LIFT) counts on these heights.
    <Flexbox
      className={stylex.props(styles.root).className}
      gap={centered ? 8 : 16}
      justify={'center'}
    >
      {centered ? (
        <AgentSelect />
      ) : (
        <Flexbox horizontal align={'center'} className={stylex.props(styles.toolbar).className}>
          <AgentSelect />
        </Flexbox>
      )}
      <Text as={'h1'} className={stylex.props(styles.greeting).className} weight={600}>
        {greeting}
      </Text>
    </Flexbox>
  );
});

export default HomeHeader;
