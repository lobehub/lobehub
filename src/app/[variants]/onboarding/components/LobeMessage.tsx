import { Flexbox, type FlexboxProps, Text } from '@lobehub/ui';
import { TypewriterEffect, type TypewriterEffectProps } from '@lobehub/ui/awesome';
import { LoadingDots } from '@lobehub/ui/chat';
import { memo } from 'react';

import { ProductLogo } from '@/components/Branding';

interface LobeMessageProps extends Omit<FlexboxProps, 'children'> {
  fontSize?: number;
  sentences: TypewriterEffectProps['sentences'];
}

const LobeMessage = memo<LobeMessageProps>(({ sentences, fontSize = 24, ...rest }) => {
  return (
    <Flexbox gap={8} {...rest}>
      <ProductLogo size={fontSize * 2} />
      <Text as={'h1'} fontSize={fontSize} weight={'bold'}>
        <TypewriterEffect
          cursorCharacter={<LoadingDots size={fontSize} variant={'pulse'} />}
          cursorFade={false}
          deletePauseDuration={1000}
          deletingSpeed={32}
          hideCursorWhileTyping={'afterTyping'}
          pauseDuration={16_000}
          sentences={sentences}
          typingSpeed={64}
        />
      </Text>
    </Flexbox>
  );
});

export default LobeMessage;
