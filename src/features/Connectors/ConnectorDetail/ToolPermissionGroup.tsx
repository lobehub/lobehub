import { Button, DropdownMenu } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronDownIcon, ChevronRightIcon, MoreHorizontalIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ConnectorToolPermission } from '@/database/schemas';
import type { ConnectorTool } from '@/store/tool/slices/connector';
import { sx } from '@/styles/sx';

import moduleStyles from './ToolPermissionGroup.module.css';
import ToolPermissionRow from './ToolPermissionRow';

const styles = stylex.create({
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    paddingBlock: '1px',
    paddingInline: '6px',
    borderRadius: '4px',
    fontSize: '12px',
    color: {
      default: cssVar.colorTextSecondary,
      [stylex.when.ancestor(':hover')]: cssVar.colorText,
    },
    backgroundColor: cssVar.colorFillSecondary,
    backgroundImage: 'none',
  },
  groupHeader: {
    cursor: 'pointer',
    userSelect: 'none',
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    paddingBlock: '10px',
    paddingInline: 0,
  },
  groupLabel: {
    display: 'flex',
    flex: '1',
    gap: '6px',
    alignItems: 'center',
    fontSize: '13px',
    fontWeight: 500,
    color: cssVar.colorText,
  },
});

interface ToolPermissionGroupProps {
  /** Read-only mode — the caller lacks the manage permission for this connector. */
  disabled?: boolean;
  label: string;
  onBatchPermission: (toolIds: string[], permission: ConnectorToolPermission) => void;
  onPermissionChange: (toolId: string, permission: ConnectorToolPermission) => void;
  tools: ConnectorTool[];
}

const ToolPermissionGroup = memo<ToolPermissionGroupProps>(
  ({ disabled, label, tools, onPermissionChange, onBatchPermission }) => {
    const { t } = useTranslation('tool');
    const [expanded, setExpanded] = useState(true);

    if (tools.length === 0) return null;

    const toolIds = tools.map((tool) => tool.id);

    const batchItems = [
      {
        key: 'auto',
        label: t('connector.permission.autoAll', 'Auto all'),
        onClick: () => onBatchPermission(toolIds, ConnectorToolPermission.auto),
      },
      {
        key: 'approval',
        label: t('connector.permission.approvalAll', 'Needs approval all'),
        onClick: () => onBatchPermission(toolIds, ConnectorToolPermission.needs_approval),
      },
      {
        key: 'disable',
        label: t('connector.permission.disableAll', 'Disable all'),
        onClick: () => onBatchPermission(toolIds, ConnectorToolPermission.disabled),
      },
    ];

    return (
      <div>
        <div
          {...sx([styles.groupHeader, stylex.defaultMarker()], moduleStyles.groupHeader)}
          onClick={() => setExpanded((e) => !e)}
        >
          <div {...stylex.props(styles.groupLabel)}>
            {expanded ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
            {label}
            <span {...stylex.props(styles.badge)}>{tools.length}</span>
          </div>

          {!disabled && (
            <DropdownMenu items={batchItems}>
              <Button
                size="small"
                style={{ fontSize: 12, height: 26 }}
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontalIcon size={12} />
                {t('connector.permission.custom', 'Custom')}
                <ChevronDownIcon size={12} />
              </Button>
            </DropdownMenu>
          )}
        </div>

        {expanded && (
          <div>
            {tools.map((tool) => (
              <ToolPermissionRow
                disabled={disabled}
                key={tool.id}
                tool={tool}
                onPermissionChange={onPermissionChange}
              />
            ))}
          </div>
        )}
      </div>
    );
  },
);

ToolPermissionGroup.displayName = 'ToolPermissionGroup';

export default ToolPermissionGroup;
