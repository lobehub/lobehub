import { Avatar, type FlexboxProps } from '@lobehub/ui';
import { Flexbox, Text } from '@lobehub/ui';
import { type TypewriterEffectProps } from '@lobehub/ui/awesome';
import { memo } from 'react';

import { ProductLogo } from '@/components/Branding';
import ScriptAwareTypewriter from '@/components/ScriptAwareTypewriter';

interface LobeMessageProps extends Omit<FlexboxProps, 'children'> {
  avatar?: string;
  avatarSize?: number;
  disableTypewriter?: boolean;
  fontSize?: number;
  gap?: number;
  horizontal?: boolean;
  sentences: TypewriterEffectProps['sentences'];
}

const LobeMessage = memo<LobeMessageProps>(
  ({
    gap = 8,
    align,
    avatar,
    avatarSize,
    horizontal,
    disableTypewriter,
    sentences,
    fontSize = 24,
    ...rest
  }) => {
    const resolvedAlign = align ?? 'flex-start';
    const textCentered = resolvedAlign === 'center';

    return (
      <Flexbox align={resolvedAlign} gap={gap} horizontal={horizontal} {...rest}>
        {avatar ? (
          <Avatar avatar={avatar} size={avatarSize || fontSize * 2} style={{ flexShrink: 0 }} />
        ) : (
          <ProductLogo size={avatarSize || fontSize * 2} style={{ flexShrink: 0 }} />
        )}
        <Text
          as={'h1'}
          fontSize={fontSize}
          weight={'bold'}
          style={{
            lineHeight: 1.3,
            textAlign: textCentered ? 'center' : undefined,
            wordBreak: 'break-word',
          }}
        >
          {disableTypewriter ? (
            (sentences[0] ?? '')
          ) : (
            <ScriptAwareTypewriter
              deletePauseDuration={1000}
              deletingSpeed={16}
              fontSize={fontSize}
              pauseDuration={16_000}
              sentences={sentences}
              typingSpeed={32}
            />
          )}
        </Text>
      </Flexbox>
    );
  },
);

export default LobeMessage;
