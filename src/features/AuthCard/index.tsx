'use client';

import { type FlexboxProps } from '@lobehub/ui';
import { Flexbox, Text } from '@lobehub/ui';
import { type ReactNode } from 'react';
import { memo } from 'react';

export interface AuthCardProps extends Omit<FlexboxProps, 'title'> {
  footer?: ReactNode;
  subtitle?: ReactNode;
  title?: ReactNode;
}

export const AuthCard = memo<AuthCardProps>(({ children, title, subtitle, footer, ...rest }) => {
  return (
    <Flexbox width={'min(100%,440px)'} {...rest}>
      <Flexbox gap={16}>
        {title && (
          <Text fontSize={28} style={{ lineHeight: 1.4 }} weight={'bold'}>
            {title}
          </Text>
        )}
        {subtitle && (
          <Text fontSize={18} style={{ lineHeight: 1.4 }} type={'secondary'} weight={500}>
            {subtitle}
          </Text>
        )}
      </Flexbox>
      <Flexbox gap={4} paddingBlock={32}>
        {children}
      </Flexbox>
      {footer}
    </Flexbox>
  );
});

export default AuthCard;
