import { Flexbox, type FlexboxProps, Icon, type IconProps, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { type ReactNode, Suspense, memo, useState } from 'react';

interface GroupBlockProps extends Omit<FlexboxProps, 'title'> {
  action?: ReactNode;
  icon?: IconProps['icon'];
  title?: ReactNode;
}

const styles = createStaticStyles(({ css, cssVar }) => ({
  action: css`
    opacity: 0;
    transition: opacity ${cssVar.motionDurationMid} ${cssVar.motionEaseInOut};
  `,
  actionVisible: css`
    opacity: 1;
  `,
}));

const GroupBlock = memo<GroupBlockProps>(({ title, action, children, icon, ...rest }) => {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <Flexbox
      gap={16}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      {...rest}
    >
      <Flexbox align={'center'} horizontal justify={'space-between'}>
        <Flexbox
          align={'center'}
          flex={1}
          gap={8}
          horizontal
          justify={'flex-start'}
          style={{ overflow: 'hidden' }}
        >
          <Icon color={cssVar.colorTextDescription} icon={icon} size={18} />
          <Text color={cssVar.colorTextSecondary} ellipsis>
            {title}
          </Text>
        </Flexbox>
        <Flexbox
          align={'center'}
          className={cx(styles.action, isHovered && styles.actionVisible)}
          flex={'none'}
          gap={2}
          horizontal
          justify={'flex-end'}
        >
          {action}
        </Flexbox>
      </Flexbox>
      <Suspense fallback={'loading'}>{children}</Suspense>
    </Flexbox>
  );
});

export default GroupBlock;
