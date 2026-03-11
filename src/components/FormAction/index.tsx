import { type CenterProps } from '@lobehub/ui';
import { Avatar, Center, Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { type ReactNode } from 'react';
import { memo } from 'react';

export const styles = createStaticStyles(({ css }) => ({
  container: css`
    border: 1px solid ${cssVar.colorSplit};
    border-radius: 8px;
    color: ${cssVar.colorText};
    background: ${cssVar.colorBgContainer};
  `,
  desc: css`
    color: ${cssVar.colorTextTertiary};
    text-align: center;
  `,
  form: css`
    width: 100%;
    max-width: 300px;
  `,
}));

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
      <Center className={cx(styles.form, className)} gap={gap} {...rest}>
        <Avatar
          animation={animation}
          avatar={avatar}
          background={background ?? cssVar.colorFillContent}
          gap={12}
          size={80}
        />
        <Flexbox gap={8} width={'100%'}>
          <Flexbox style={{ fontSize: 18, fontWeight: 'bold', textAlign: 'center' }}>
            {title}
          </Flexbox>
          <Flexbox className={styles.desc}>{description}</Flexbox>
        </Flexbox>
        {children}
      </Center>
    );
  },
);

export default FormAction;
