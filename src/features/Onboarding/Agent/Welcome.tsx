import { Flexbox, Markdown } from '@lobehub/ui';
import { Divider } from 'antd';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import LobeMessage from '@/routes/onboarding/components/LobeMessage';

import { staticStyle } from './staticStyle';

const Welcome = memo(() => {
  const { t } = useTranslation('onboarding');

  return (
    <>
      <Flexbox flex={1} />
      <Flexbox
        className={staticStyle.greetingTextAnimated}
        gap={12}
        width={'100%'}
        style={{
          paddingBottom: 'max(10vh, 32px)',
        }}
      >
        <LobeMessage
          avatarSize={72}
          fontSize={32}
          gap={16}
          sentences={[t('agent.welcome.sentence.1'), t('agent.welcome.sentence.2')]}
        />
        <Divider dashed style={{ margin: 0 }} />
        <Markdown fontSize={16} variant={'chat'}>
          {t('agent.welcome')}
        </Markdown>
      </Flexbox>
    </>
  );
});

Welcome.displayName = 'Welcome';

export default Welcome;
