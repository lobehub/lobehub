import { Center, Icon } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import type {LucideIcon} from 'lucide-react';
import { memo } from 'react';

const styles = createStaticStyles(({ css }) => ({
  icon: css`
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 8px;
    background: ${cssVar.colorBgElevated};
  `,
}));

const GroupIcon = memo<{ icon: LucideIcon }>(({ icon }) => {
  return (
    <Center className={styles.icon} flex={'none'} height={40} width={40}>
      <Icon icon={icon} size={24} />
    </Center>
  );
});

export default GroupIcon;
