import { Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { useHomeDailyBrief } from '@/hooks/useHomeDailyBrief';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/slices/auth/selectors';

import AgentSelect from './AgentSelect';
import GreetingLine from './GreetingLine';
import { parseGreetingLine } from './welcomeText';

const styles = createStaticStyles(({ css }) => ({
  // The dynamic half is generated prose of unpredictable length, and the
  // composer sits directly below — clamp to two lines so a wordy brief can
  // never push the input down the page.
  greeting: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;

    margin: 0;

    font-size: 22px;
    line-height: 1.4;
    letter-spacing: -0.01em;
  `,
}));

/** Matches the pause the welcome typewriter used to hold each sentence for. */
const ROTATE_INTERVAL_MS = 30_000;

const getGreetingKey = (hour: number): 'afternoon' | 'evening' | 'morning' => {
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
};

/** CJK greetings already end on a full-width stop, which carries its own trailing space. */
const greetingSeparator = (greeting: string) => (/[。！？]$/.test(greeting) ? '' : ' ');

const HomeHeader = memo(() => {
  const { t } = useTranslation('home');
  const displayName = useUserStore(userProfileSelectors.displayUserName);

  const { advance, currentPair, pairs } = useHomeDailyBrief();

  // The rotation used to be driven by the welcome typewriter's completion
  // callback. Without a driver both this line and the composer's paired hint
  // freeze on the first pair forever, so the greeting owns the cadence now.
  useEffect(() => {
    if (pairs.length < 2) return;

    const timer = setInterval(advance, ROTATE_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [advance, pairs.length]);

  const greeting = t(`dashboard.greeting.${getGreetingKey(new Date().getHours())}`, {
    name: displayName,
  });
  // Falls back to the static line until the daily brief lands — or forever, for
  // an account the generator has not run for yet.
  const parsed = currentPair?.welcome ? parseGreetingLine(currentPair.welcome) : undefined;

  return (
    <Flexbox gap={16} justify={'center'}>
      <AgentSelect />
      <Text as={'h1'} className={styles.greeting} weight={600}>
        {greeting}
        {greetingSeparator(greeting)}
        {parsed?.plain ? <GreetingLine parsed={parsed} /> : t('dashboard.greeting.subtitle')}
      </Text>
    </Flexbox>
  );
});

export default HomeHeader;
