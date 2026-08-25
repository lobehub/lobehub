import { Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import type { ReactNode } from 'react';
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
  promo: css`
    overflow: hidden;
    justify-self: center;

    min-width: 0;
    max-width: 100%;

    white-space: nowrap;

    @container home (width <= 720px) {
      justify-self: end;
      max-width: 280px;
    }
  `,
  spacer: css`
    @container home (width <= 720px) {
      display: none;
    }
  `,
  toolbar: css`
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 480px) minmax(0, 1fr);
    align-items: center;

    width: 100%;
    min-width: 0;
    min-height: 48px;

    @container home (width <= 720px) {
      grid-template-columns: minmax(0, 1fr) auto;
    }
  `,
}));

const getGreetingKey = (hour: number): 'afternoon' | 'evening' | 'morning' => {
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
};

interface HomeHeaderProps {
  centered?: boolean;
  promo?: ReactNode;
}

const HomeHeader = memo<HomeHeaderProps>(({ centered, promo }) => {
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
    <Flexbox gap={centered ? 8 : 16} justify={'center'}>
      {centered ? (
        <AgentSelect />
      ) : (
        <div className={styles.toolbar}>
          <AgentSelect />
          {promo && <div className={styles.promo}>{promo}</div>}
          <div aria-hidden className={styles.spacer} />
        </div>
      )}
      <Text as={'h1'} className={styles.greeting} weight={600}>
        {greeting}
      </Text>
    </Flexbox>
  );
});

export default HomeHeader;
