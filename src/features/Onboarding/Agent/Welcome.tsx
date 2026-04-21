import { Block, Flexbox, FluentEmoji, Grid, Markdown, Text } from '@lobehub/ui';
import { Divider } from 'antd';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import LobeMessage from '@/routes/onboarding/components/LobeMessage';

import NameSuggestions from './NameSuggestions';
import { staticStyle } from './staticStyle';

interface WelcomeProps {
  content: string;
}

const Welcome = memo<WelcomeProps>(({ content }) => {
  const { t } = useTranslation('onboarding');

  const guids = [
    {
      avatar: '👋',
      title: t('agent.welcome.guide.name.title'),
      desc: t('agent.welcome.guide.name.desc'),
    },
    {
      avatar: '💬',
      title: t('agent.welcome.guide.knowYou.title'),
      desc: t('agent.welcome.guide.knowYou.desc'),
    },
    {
      avatar: '🌱',
      title: t('agent.welcome.guide.growTogether.title'),
      desc: t('agent.welcome.guide.growTogether.desc'),
    },
  ];
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
          sentences={[
            t('agent.welcome.sentence.1'),
            t('agent.welcome.sentence.2'),
            t('agent.welcome.sentence.3'),
          ]}
        />
        <Divider dashed style={{ margin: 0 }} />
        <Text italic style={{ marginBlock: 8 }} type={'secondary'}>
          {t('agent.welcome.footer')}
        </Text>
        <Divider dashed style={{ margin: 0 }} />
        <Grid paddingBlock={24}>
          {guids.map((item, i) => (
            <Block
              shadow
              gap={12}
              key={i}
              padding={16}
              variant={'outlined'}
              style={{
                boxShadow: '0 8px 16px -8px rgba(0,0,0,0.06)',
              }}
            >
              <FluentEmoji emoji={item.avatar} size={24} type={'anim'} />
              <Flexbox gap={8}>
                <Text fontSize={16} weight={500}>
                  {item.title}
                </Text>
                <Text type={'secondary'}>{item.desc}</Text>
              </Flexbox>
            </Block>
          ))}
        </Grid>
        <Markdown fontSize={16} variant={'chat'}>
          {content}
        </Markdown>
        <NameSuggestions />
      </Flexbox>
    </>
  );
});

Welcome.displayName = 'Welcome';

export default Welcome;
