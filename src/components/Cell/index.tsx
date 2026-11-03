import { type IconProps } from '@lobehub/ui';
import { Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronRight } from 'lucide-react';
import { type ReactNode } from 'react';
import { memo } from 'react';

import Divider from './Divider';

const styles = stylex.create({
  container: {
    position: 'relative',
    borderRadius: '0',
    fontSize: '15px',
    backgroundColor: { 'default': null, ':active': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':active': 'none' },
  },
});

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
      className={stylex.props(styles.container).className}
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
