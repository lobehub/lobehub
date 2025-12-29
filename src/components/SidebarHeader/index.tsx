import { Flexbox, type FlexboxProps } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { type ReactNode, memo } from 'react';

const styles = createStaticStyles(({ css }) => ({
  header: css`
    z-index: 10;
  `,
}));

interface SidebarHeaderProps extends Omit<FlexboxProps, 'title'> {
  actions?: ReactNode;
  onClick?: () => void;
  title: ReactNode;
}

const SidebarHeader = memo<SidebarHeaderProps>(({ title, style, actions, onClick, ...rest }) => {
  return (
    <Flexbox
      align={'center'}
      className={styles.header}
      distribution={'space-between'}
      flex={'none'}
      horizontal
      onClick={onClick}
      padding={8}
      style={style}
      {...rest}
    >
      <Flexbox align={'center'} gap={4} horizontal width={'100%'}>
        {title}
      </Flexbox>
      <Flexbox align={'center'} gap={2} horizontal>
        {actions}
      </Flexbox>
    </Flexbox>
  );
});

export default SidebarHeader;
