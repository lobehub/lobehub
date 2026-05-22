import { Flexbox, Markdown } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import LobeMessage from '@/routes/onboarding/components/LobeMessage';

import { staticStyle } from './staticStyle';

const WelcomeMobile = memo(() => {
  const { t } = useTranslation('onboarding');

  return (
    <>
      <Flexbox flex={1} />
      <Flexbox
        className={staticStyle.greetingTextAnimated}
        gap={12}
        paddingBlock={'0 12px'}
        paddingInline={6}
        width={'100%'}
      >
        <LobeMessage
          disableTypewriter
          avatarSize={36}
          fontSize={18}
          gap={10}
          sentences={[t('agent.welcome.sentence.1'), t('agent.welcome.sentence.2')]}
        />
        <Markdown fontSize={13} variant={'chat'}>
          {t('agent.welcome')}
        </Markdown>
      </Flexbox>
    </>
  );
});

WelcomeMobile.displayName = 'WelcomeMobile';

export default WelcomeMobile;
