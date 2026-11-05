import type { TaskStatus } from '@lobechat/types';
import { Icon, Text, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { PanelRightClose, PanelRightOpen } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import TaskStatusIcon from '../features/TaskStatusIcon';

export const HIDDEN_PANEL_WIDTH = {
  collapsed: 36,
  expanded: 220,
};

const styles = stylex.create({
  card: {
    cursor: 'pointer',
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    paddingBlock: '8px',
    paddingInline: '10px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: { 'default': cssVar.colorBorderSecondary, ':hover': cssVar.colorPrimaryBorder },
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
    transition: 'border-color 0.2s',
  },
  collapsedHeader: {
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    alignItems: 'center',
    paddingBlock: '12px',
    paddingInline: '6px',
    color: cssVar.colorTextSecondary,
  },
  count: { marginInlineStart: 'auto', color: cssVar.colorTextTertiary },
  header: {
    cursor: 'pointer',
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
    paddingBlockStart: '10px',
    paddingBlockEnd: '8px',
    paddingInline: '6px',
    color: cssVar.colorTextSecondary,
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    paddingBlockStart: '4px',
    paddingBlockEnd: '12px',
    paddingInline: '2px',
  },
  panel: {
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
    maxHeight: '100%',
    marginInlineStart: 'auto',
    paddingInline: '8px',
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  verticalLabel: {
    writingMode: 'vertical-rl',
    fontSize: '12px',
    fontWeight: 500,
    letterSpacing: '0.02em',
  },
});

interface HiddenColumn {
  columnKey: string;
  label: string;
  statusIcon?: TaskStatus;
  total: number;
}

interface HiddenColumnsPanelProps {
  collapsed: boolean;
  columns: HiddenColumn[];
  onRestore: (columnKey: string) => void;
  onToggleCollapsed: (next: boolean) => void;
}

const HiddenColumnsPanel = memo<HiddenColumnsPanelProps>(
  ({ collapsed, columns, onRestore, onToggleCollapsed }) => {
    const { t } = useTranslation('chat');

    if (columns.length === 0) return null;

    const title = t('taskList.kanban.hiddenColumns');

    if (collapsed) {
      return (
        <div
          className={stylex.props(styles.panel).className}
          style={{ width: HIDDEN_PANEL_WIDTH.collapsed }}
          onClick={() => onToggleCollapsed(false)}
        >
          <Tooltip title={title}>
            <div {...stylex.props(styles.collapsedHeader)}>
              <Icon icon={PanelRightOpen} size={16} />
              <Text className={stylex.props(styles.verticalLabel).className} type={'secondary'}>
                {title}
              </Text>
            </div>
          </Tooltip>
        </div>
      );
    }

    return (
      <div
        className={stylex.props(styles.panel).className}
        style={{ width: HIDDEN_PANEL_WIDTH.expanded }}
      >
        <div {...stylex.props(styles.header)} onClick={() => onToggleCollapsed(true)}>
          <Text fontSize={13} weight={500}>
            {title}
          </Text>
          <Text className={stylex.props(styles.count).className} fontSize={12}>
            {columns.length}
          </Text>
          <Icon icon={PanelRightClose} size={16} />
        </div>
        <div {...stylex.props(styles.list)}>
          {columns.map((column) => (
            <div
              {...stylex.props(styles.card)}
              key={column.columnKey}
              title={t('taskList.kanban.showColumn')}
              onClick={() => onRestore(column.columnKey)}
            >
              {column.statusIcon && <TaskStatusIcon size={16} status={column.statusIcon} />}
              <Text fontSize={13}>{column.label}</Text>
              <Text className={stylex.props(styles.count).className} fontSize={12}>
                {column.total}
              </Text>
            </div>
          ))}
        </div>
      </div>
    );
  },
);

export default HiddenColumnsPanel;
