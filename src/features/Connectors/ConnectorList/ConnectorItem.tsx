import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { LinkIcon } from 'lucide-react';
import { memo } from 'react';

import type { ConnectorWithTools } from '@/store/tool/slices/connector';

const styles = stylex.create({
  active: { backgroundColor: cssVar.colorFillSecondary, backgroundImage: 'none' },
  item: {
    cursor: 'pointer',
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    marginBlock: '0',
    marginInline: '4px',
    paddingBlock: '6px',
    paddingInline: '12px',
    borderRadius: '6px',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
});

interface ConnectorItemProps {
  active?: boolean;
  connector: ConnectorWithTools;
  onClick: () => void;
}

const ConnectorItem = memo<ConnectorItemProps>(({ connector, active, onClick }) => {
  const itemClass = active
    ? stylex.props(styles.item, styles.active).className
    : stylex.props(styles.item).className;

  return (
    <div className={itemClass} onClick={onClick}>
      <LinkIcon size={14} />
      <span style={{ flex: 1, fontSize: 14 }}>{connector.name}</span>
    </div>
  );
});

ConnectorItem.displayName = 'ConnectorItem';

export default ConnectorItem;
