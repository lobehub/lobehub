'use client';

import { type FlexboxProps } from '@lobehub/ui';
import { Flexbox, Text } from '@lobehub/ui';
import { type ReactNode } from 'react';
import { memo } from 'react';

import { isEmbeddedAuth } from '@/features/AuthShell/embedded';

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
    // Lobot's sign-in window is a small app window: use its type scale (20px titles, like
    // Lobot's own login window) instead of the website's hero headings.
    const embedded = isEmbeddedAuth();

    return (
      <Flexbox width={'min(100%,440px)'} {...rest}>
        <Flexbox align={centered ? 'center' : undefined} gap={embedded ? 8 : 16}>
          {title && (
            <Text
              fontSize={embedded ? 20 : 28}
              style={{ lineHeight: 1.4, textAlign }}
              weight={embedded ? 600 : 'bold'}
            >
              {title}
            </Text>
          )}
          {subtitle && (
            <Text
              fontSize={embedded ? 14 : 18}
              style={{ lineHeight: 1.4, textAlign }}
              type={'secondary'}
              weight={embedded ? undefined : 500}
            >
              {subtitle}
            </Text>
          )}
        </Flexbox>
        <Flexbox gap={4} paddingBlock={embedded ? 24 : 32}>
          {children}
        </Flexbox>
        {footer}
      </Flexbox>
    );
  },
);

export default AuthCard;
