import { type FlexboxProps } from '@lobehub/ui';
import { Flexbox, Text } from '@lobehub/ui';
import { type TypewriterEffectProps } from '@lobehub/ui/awesome';
import { memo } from 'react';

import { ProductLogo } from '@/components/Branding';
import ScriptAwareTypewriter from '@/components/ScriptAwareTypewriter';

interface LobeMessageProps extends Omit<FlexboxProps, 'children'> {
  fontSize?: number;
  sentences: TypewriterEffectProps['sentences'];
}

const LobeMessage = memo<LobeMessageProps>(({ sentences, fontSize = 24, ...rest }) => {
  return (
    <Flexbox gap={8} {...rest}>
      <ProductLogo size={fontSize * 2} />
      <Text as={'h1'} fontSize={fontSize} weight={'bold'}>
        <ScriptAwareTypewriter
          deletePauseDuration={1000}
          deletingSpeed={32}
          fontSize={fontSize}
          pauseDuration={16_000}
          sentences={sentences}
          typingSpeed={64}
        />
      </Text>
    </Flexbox>
  );
});

export default LobeMessage;
