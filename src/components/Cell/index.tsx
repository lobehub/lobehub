import { type IconProps } from '@lobehub/ui';
import { Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { ChevronRight } from 'lucide-react';
import { type ReactNode } from 'react';
import { memo } from 'react';

import Divider from './Divider';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    position: relative;
    border-radius: 0;
    font-size: 15px;

    &:active {
      background: ${cssVar.colorFillTertiary};
    }
  `,
}));

export interface CellProps {
  icon?: IconProps['icon'];
  key?: string | number;
  label?: string | ReactNode;
  onClick?: () => void;
  type?: 'divider';
}

const Cell = memo<CellProps>(({ label, icon, onClick, type }) => {
  if (type === 'divider') return <Divider />;

  return (
    <Flexbox
      horizontal
      align={'center'}
      className={cx(styles.container)}
      gap={12}
      justify={'space-between'}
      padding={16}
      onClick={onClick}
    >
      <Flexbox horizontal align={'center'} gap={12}>
        {icon && <Icon color={cssVar.colorPrimaryBorder} icon={icon} size={{ size: 20 }} />}
        {label}
      </Flexbox>
      <Icon color={cssVar.colorBorder} icon={ChevronRight} size={{ size: 16 }} />
    </Flexbox>
  );
});

export default Cell;
