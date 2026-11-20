import { createStaticStyles, cx, Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserStore } from '@/store/user';
import { authSelectors, userProfileSelectors } from '@/store/user/slices/auth/selectors';
import { densityVars } from '@/styles/densityVars';

import AgentSelect from './AgentSelect';
import { getGreetingKey } from './greeting';

const styles = createStaticStyles(({ css }) => ({
  root: css`
    /* Unbroken names must stay inside the start-aligned header's text lane. */
    max-width: 100%;
  `,
  greeting: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;

    margin: 0;

    font-size: 22px;
    line-height: 1.4;
    letter-spacing: -0.01em;

    html[data-density='compact'] & {
      font-size: 20px;
    }
  `,
  /* The nav header floats over the scroll area, so the page padding alone would
     tuck the switcher right under it; clear the header by one section gap. */
  dashboard: css`
    padding-block-start: calc(
      ${densityVars.headerHeight} + ${densityVars.sectionGap} - ${densityVars.pagePaddingBlockStart}
    );
  `,
}));

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
    // The switcher names who speaks and the greeting answers right below it, so
    // the pair reads as one block. The minimal layout's lift math (MINIMAL_LIFT)
    // counts on these heights.
    <Flexbox className={cx(styles.root, !centered && styles.dashboard)} gap={8} justify={'center'}>
      <AgentSelect />
      <Text as={'h1'} className={styles.greeting} weight={600}>
        {greeting}
      </Text>
    </Flexbox>
  );
});

export default HomeHeader;
