import { createStaticStyles } from 'antd-style';
import { LinkIcon } from 'lucide-react';
import { memo } from 'react';

import type { ConnectorWithTools } from '@/store/tool/slices/connector';

const styles = createStaticStyles(({ css, cssVar }) => ({
  active: css`
    background: ${cssVar.colorFillSecondary};
  `,
  item: css`
    cursor: pointer;

    display: flex;
    gap: 8px;
    align-items: center;

    margin-block: 0;
    margin-inline: 4px;
    padding-block: 6px;
    padding-inline: 12px;
    border-radius: 6px;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
}));

interface ConnectorItemProps {
  active?: boolean;
  connector: ConnectorWithTools;
  onClick: () => void;
}

const ConnectorItem = memo<ConnectorItemProps>(({ connector, active, onClick }) => {
  const itemClass = active ? `${styles.item} ${styles.active}` : styles.item;

  return (
    <div className={itemClass} onClick={onClick}>
      <LinkIcon size={14} />
      <span style={{ flex: 1, fontSize: 14 }}>{connector.name}</span>
    </div>
  );
});

ConnectorItem.displayName = 'ConnectorItem';

export default ConnectorItem;
