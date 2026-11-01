import { type CenterProps } from '@lobehub/ui';
import { Avatar, Center, Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { type ReactNode } from 'react';
import { memo } from 'react';

import { sx } from '@/styles/sx';

const styles = stylex.create({
  desc: {
    color: cssVar.colorTextTertiary,
    textAlign: 'center',
  },
  form: {
    width: '100%',
    maxWidth: '300px',
  },
});

const FormAction = memo<
  {
    animation?: boolean;
    avatar: ReactNode;
    background?: string;
    description: ReactNode;
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
      <Center gap={gap} {...sx([styles.form], className)} {...rest}>
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

export default FormAction;
