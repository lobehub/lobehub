import { Icon } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { ChevronRight } from 'lucide-react';
import { memo } from 'react';

const styles = stylex.create({
  root: { display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 },
});

const SubmenuChevron = memo(() => (
  <Icon
    className={`lobe-submenu-chevron ${stylex.props(styles.root).className}`}
    icon={ChevronRight}
    size={16}
  />
));

SubmenuChevron.displayName = 'SubmenuChevron';

export default SubmenuChevron;
