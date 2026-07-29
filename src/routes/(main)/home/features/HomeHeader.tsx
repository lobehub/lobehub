import { Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import HomePromoBanner from '@/business/client/features/HomePromoBanner';
import { useHomeDailyBrief } from '@/hooks/useHomeDailyBrief';
import { useUserStore } from '@/store/user';
import { authSelectors, userProfileSelectors } from '@/store/user/slices/auth/selectors';

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
  promo: css`
    flex: none;
    min-width: 0;

    @container (width <= 620px) {
      display: none;
    }
  `,
  toolbar: css`
    container-type: inline-size;
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

/** CJK greetings already end on a full-width stop, which carries its own trailing space. */
const greetingSeparator = (greeting: string) => (/[。！？]$/.test(greeting) ? '' : ' ');

const HomeHeader = memo(() => {
  const { t } = useTranslation('home');
  const displayName = useUserStore(userProfileSelectors.displayUserName);
  const isLogin = useUserStore(authSelectors.isLogin);

  const { currentPair } = useHomeDailyBrief();

  const greetingKey = getGreetingKey(new Date().getHours());
  const greeting = isLogin
    ? t(`dashboard.greeting.${greetingKey}`, { name: displayName })
    : t(`dashboard.greeting.${greetingKey}Guest`);
  // Falls back to the static line until the daily brief lands — or forever, for
  // an account the generator has not run for yet.
  const parsed = currentPair?.welcome ? parseGreetingLine(currentPair.welcome) : undefined;

  return (
    <Flexbox gap={16} justify={'center'}>
      <Flexbox
        horizontal
        align={'center'}
        className={styles.toolbar}
        gap={16}
        justify={'space-between'}
      >
        <AgentSelect />
        <div className={styles.promo}>
          <HomePromoBanner />
        </div>
      </Flexbox>
      <Text as={'h1'} className={styles.greeting} weight={600}>
        {greeting}
        {greetingSeparator(greeting)}
        {parsed?.plain ? <GreetingLine parsed={parsed} /> : t('dashboard.greeting.subtitle')}
      </Text>
    </Flexbox>
  );
});

export default HomeHeader;
