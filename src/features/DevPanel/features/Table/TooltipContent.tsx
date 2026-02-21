import { Flexbox, Highlighter } from '@lobehub/ui';
import { type ReactNode } from 'react';
import { memo } from 'react';

import Image from '@/libs/next/Image';

const TooltipContent = memo<{ children: ReactNode }>(({ children }) => {
  if (typeof children !== 'string') return children;

  if (children.startsWith('data:image')) {
    return (
      <Image
        unoptimized
        alt={'tooltip-image'}
        src={children}
        style={{ height: 'auto', maxWidth: '100%' }}
      />
    );
  }

  if (children.startsWith('http'))
    return (
      <a href={children} rel="noreferrer" target="_blank">
        {children}
      </a>
    );

  const code = children.trim().trimEnd();

  if ((code.startsWith('{') && code.endsWith('}')) || (code.startsWith('[') && code.endsWith(']')))
    return (
      <Highlighter
        language={'json'}
        variant={'borderless'}
        style={{
          maxHeight: 400,
          overflow: 'auto',
        }}
      >
        {JSON.stringify(JSON.parse(code), null, 2)}
      </Highlighter>
    );

  return <Flexbox>{children}</Flexbox>;
});

export default TooltipContent;
