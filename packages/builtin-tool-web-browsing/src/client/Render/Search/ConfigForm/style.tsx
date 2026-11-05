import type { CenterProps } from '@lobehub/ui';
import { Avatar, Center, cx, Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { memo } from 'react';

export const styles = stylex.create({
  container: {
    borderRadius: '8px',
    color: cssVar.colorText,
  },
  desc: {
    color: cssVar.colorTextTertiary,
    textAlign: 'center',
  },
  form: {
    width: '100%',
    maxWidth: '300px',
    paddingBlock: '12px',
  },
});

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
    gap = 16,
    ...rest
  }) => {
    return (
      <Center className={cx(stylex.props(styles.form).className, className)} gap={gap} {...rest}>
        <Avatar
          animation={animation}
          avatar={avatar}
          background={background ?? cssVar.colorFillContent}
          size={80}
        />
        <Flexbox gap={8} width={'100%'}>
          <Flexbox style={{ fontSize: 18, fontWeight: 'bold', textAlign: 'center' }}>
            {title}
          </Flexbox>
          <Flexbox className={stylex.props(styles.desc).className}>{description}</Flexbox>
        </Flexbox>
        {children}
      </Center>
    );
  },
);
