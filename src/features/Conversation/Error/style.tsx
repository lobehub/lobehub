import { type InterfaceDensity } from '@lobechat/types';
import { type CenterProps } from '@lobehub/ui';
import { Avatar, Center, Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { type ReactNode } from 'react';
import { memo } from 'react';

import { useDensity } from '@/styles/density';
import { sx } from '@/styles/sx';

const DESC_FONT_SIZE = {
  compact: '13px',
  loose: null,
} as const satisfies Record<InterfaceDensity, string | null>;

const ACTION_CONTAINER_SPACING = {
  compact: 16,
  loose: 24,
} as const satisfies Record<InterfaceDensity, number>;

const FORM_AVATAR_SIZE = {
  compact: 56,
  loose: 80,
} as const satisfies Record<InterfaceDensity, number>;

const FORM_TITLE_FONT_SIZE = {
  compact: 15,
  loose: 18,
} as const satisfies Record<InterfaceDensity, number>;

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
  desc: { color: cssVar.colorTextTertiary, textAlign: 'center', fontSize: DESC_FONT_SIZE.loose },
  descCompact: { fontSize: DESC_FONT_SIZE.compact },
  form: {
    width: '100%',
    maxWidth: { 'default': '360px', '@media (width <= 768px)': '90%' },
  },
});

export const ErrorActionContainer = memo<CenterProps>(
  ({ children, className, gap, padding, style, ...rest }) => {
    const { density } = useDensity();
    const spacing = ACTION_CONTAINER_SPACING[density];
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
    const { compact, density, tokens } = useDensity();
    return (
      <Center {...sx(styles.form, className, style)} gap={gap ?? tokens.sectionGap} {...rest}>
        <Avatar
          animation={animation}
          avatar={avatar}
          background={background ?? cssVar.colorFillContent}
          shape={'square'}
          size={FORM_AVATAR_SIZE[density]}
        />
        <Flexbox gap={8} width={'100%'}>
          <Flexbox
            style={{
              fontSize: FORM_TITLE_FONT_SIZE[density],
              fontWeight: 'bold',
              textAlign: 'center',
            }}
          >
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
