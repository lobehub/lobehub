import { Avatar } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { ReactNode, memo } from 'react';
import { Center, CenterProps, Flexbox } from 'react-layout-kit';

export const useStyles = createStyles(({ css, token }) => ({
  container: css`
    border: 1px solid ${token.colorSplit};
    border-radius: 8px;
    color: ${token.colorText};
    background: ${token.colorBgContainer};
  `,
  desc: css`
    color: ${token.colorTextTertiary};
    text-align: center;
  `,
  form: css`
    width: 100%;
    max-width: 360px;

    @media (max-width: 768px) {
      max-width: 90%;
    }
  `,
}));

export const ErrorActionContainer = memo<CenterProps>(
  ({ children, className, gap = 24, padding = 24, ...rest }) => {
    const { cx, styles } = useStyles();

    return (
      <Center className={cx(styles.container, className)} gap={gap} padding={padding} {...rest}>
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
    gap = 16,
    ...rest
  }) => {
    const { cx, styles, theme } = useStyles();

    return (
      <Center className={cx(styles.form, className)} gap={gap} {...rest}>
        <Avatar
          animation={animation}
          avatar={avatar}
          background={background ?? theme.colorFillContent}
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
