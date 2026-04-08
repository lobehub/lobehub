import { Block, Flexbox, Markdown } from '@lobehub/ui';
import { cx } from 'antd-style';
import { memo } from 'react';

import LobeMessage from '@/routes/onboarding/components/LobeMessage';

import { staticStyle } from './staticStyle';

interface WelcomeProps {
  content: string;
}

const Welcome = memo<WelcomeProps>(({ content }) => (
  <>
    <Flexbox flex={1} />
    <Flexbox
      gap={12}
      width={'100%'}
      style={{
        paddingBottom: 'max(10vh, 32px)',
      }}
    >
      <LobeMessage sentences={['开始定制你的专属 Agent']} />
      <Block padding={16}>
        <Markdown
          className={cx(staticStyle.greetingText, staticStyle.greetingTextAnimated)}
          variant={'chat'}
        >
          {content}
        </Markdown>
      </Block>
    </Flexbox>
  </>
));

Welcome.displayName = 'Welcome';

export default Welcome;
