import { ActionIcon, type ActionIconProps, Flexbox, type FlexboxProps } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import React, { type ReactNode } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => ({
  header: css`
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  title: css`
    font-weight: 550;
  `,
}));

interface HeaderProps extends Omit<FlexboxProps, 'title' | 'children'> {
  actions?: ActionIconProps[];
  extra?: ReactNode;
  title?: ReactNode;
}

const Header = ({ title, actions = [], extra, ...rest }: HeaderProps) => {

  return (
    <Flexbox
      align={'center'}
      className={styles.header}
      flex={'none'}
      height={46}
      horizontal
      justify={'space-between'}
      paddingInline={16}
      {...rest}
    >
      <div className={styles.title}>{title}</div>
      <Flexbox align={'center'} gap={4} horizontal>
        {extra}
        {actions.map((action, index) => (
          <ActionIcon {...action} key={index} size={{ blockSize: 28, size: 16 }} />
        ))}
      </Flexbox>
    </Flexbox>
  );
};

export default Header;
