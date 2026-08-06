'use client';

import { type FlexboxProps } from '@lobehub/ui';
import { Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { type ReactNode } from 'react';
import { memo } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    width: min(100%, 420px);
    padding-block: 28px 24px;
    padding-inline: 28px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 16px;

    background: ${cssVar.colorBgElevated};
    box-shadow: ${cssVar.boxShadowSecondary};
  `,
  title: css`
    margin: 0;
    text-align: center;
  `,
}));

export interface AuthCardProps extends Omit<FlexboxProps, 'title'> {
  footer?: ReactNode;
  subtitle?: ReactNode;
  title?: ReactNode;
}

export const AuthCard = memo<AuthCardProps>(
  ({ children, title, subtitle, footer, className, ...rest }) => {
    return (
      <Flexbox
        className={className ? `${styles.card} ${className}` : styles.card}
        gap={20}
        {...rest}
      >
        {(title || subtitle) && (
          <Flexbox gap={8}>
            {title && (
              <Text className={styles.title} fontSize={22} weight={'bold'}>
                {title}
              </Text>
            )}
            {subtitle && (
              <Text align="center" fontSize={14} type={'secondary'} weight={500}>
                {subtitle}
              </Text>
            )}
          </Flexbox>
        )}
        <Flexbox gap={16}>{children}</Flexbox>
        {footer}
      </Flexbox>
    );
  },
);

export default AuthCard;
