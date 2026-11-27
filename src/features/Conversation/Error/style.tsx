import { type CenterProps } from '@lobehub/ui';
import { Avatar, Center, Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { type ReactNode } from 'react';
import { memo } from 'react';

import { useDensity } from '@/styles/density';
import { sx } from '@/styles/sx';

export const styles = stylex.create({
  container: {
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorSplit,
    borderRadius: '8px',
    color: cssVar.colorText,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  desc: { color: cssVar.colorTextTertiary, textAlign: 'center' },
  descCompact: { fontSize: '13px' },
  form: {
    width: '100%',
    maxWidth: { 'default': '360px', '@media (width <= 768px)': '90%' },
  },
});

export const ErrorActionContainer = memo<CenterProps>(
  ({ children, className, gap, padding, style, ...rest }) => {
    const { compact } = useDensity();
    const spacing = compact ? 16 : 24;
    return (
      <Center
        {...sx(styles.container, className, style)}
        gap={gap ?? spacing}
        padding={padding ?? spacing}
        {...rest}
      >
        {children}
      </Center>
    );
  },
);

export const FormAction = memo<
  {
    animation?: boolean;
    avatar: ReactNode;
    background?: string;
    description: string;
    title: string;
  } & CenterProps
>(
  ({
    children,
    background,
    title,
    description,
    avatar,
    animation,
    className,
    gap,
    style,
    ...rest
  }) => {
    const { compact } = useDensity();
    return (
      <Center {...sx(styles.form, className, style)} gap={gap ?? (compact ? 12 : 16)} {...rest}>
        <Avatar
          animation={animation}
          avatar={avatar}
          background={background ?? cssVar.colorFillContent}
          shape={'square'}
          size={compact ? 56 : 80}
        />
        <Flexbox gap={8} width={'100%'}>
          <Flexbox style={{ fontSize: compact ? 15 : 18, fontWeight: 'bold', textAlign: 'center' }}>
            {title}
          </Flexbox>
          <Flexbox {...stylex.props(styles.desc, compact && styles.descCompact)}>
            {description}
          </Flexbox>
        </Flexbox>
        {children}
      </Center>
    );
  },
);
