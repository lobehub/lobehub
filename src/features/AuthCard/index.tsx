'use client';

import { type FlexboxProps } from '@lobehub/ui';
import { Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { type ReactNode } from 'react';
import { memo } from 'react';

export interface AuthCardProps extends Omit<FlexboxProps, 'title'> {
  /**
   * Center the title and subtitle. Use it when the card sits under a centered
   * header such as an application logo, so the text lines up with it.
   */
  centered?: boolean;
  footer?: ReactNode;
  subtitle?: ReactNode;
  title?: ReactNode;
}

export const AuthCard = memo<AuthCardProps>(
  ({ centered, children, title, subtitle, footer, ...rest }) => {
    const textAlign = centered ? 'center' : undefined;

    return (
      <Flexbox width={'min(100%,440px)'} {...rest}>
        <Flexbox align={centered ? 'center' : undefined} gap={16}>
          {title && (
            <Text fontSize={28} style={{ lineHeight: 1.4, textAlign }} weight={'bold'}>
              {title}
            </Text>
          )}
          {subtitle && (
            <Text
              fontSize={18}
              style={{ lineHeight: 1.4, textAlign }}
              type={'secondary'}
              weight={500}
            >
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
  },
);

export default AuthCard;
