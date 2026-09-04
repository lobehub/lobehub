import { Button, DropdownMenu } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { ChevronDownIcon, ChevronRightIcon, MoreHorizontalIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ConnectorToolPermission } from '@/database/schemas';
import type { ConnectorTool } from '@/store/tool/slices/connector';

import { getConnectorPermissionStatus } from './localization';
import ToolPermissionRow from './ToolPermissionRow';

const styles = createStaticStyles(({ css, cssVar }) => ({
  badge: css`
    display: inline-flex;
    align-items: center;
    justify-content: center;

    padding-block: 1px;
    padding-inline: 6px;
    border-radius: 4px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillSecondary};
  `,
  groupHeader: css`
    cursor: pointer;
    user-select: none;

    display: flex;
    gap: 8px;
    align-items: center;

    padding-block: 10px;
    padding-inline: 0;

    &:hover span {
      color: ${cssVar.colorText};
    }
  `,
  groupLabel: css`
    display: flex;
    flex: 1;
    gap: 6px;
    align-items: center;

    font-size: 13px;
    font-weight: 500;
    color: ${cssVar.colorText};
  `,
}));

interface ToolPermissionGroupProps {
  /** Read-only mode — the caller lacks the manage permission for this connector. */
  connectorIdentifier: string;
  disabled?: boolean;
  label: string;
  onBatchPermission: (toolIds: string[], permission: ConnectorToolPermission) => void;
  onPermissionChange: (toolId: string, permission: ConnectorToolPermission) => void;
  tools: ConnectorTool[];
}

const ToolPermissionGroup = memo<ToolPermissionGroupProps>(
  ({ connectorIdentifier, disabled, label, tools, onPermissionChange, onBatchPermission }) => {
    const { t } = useTranslation('tool');
    const [expanded, setExpanded] = useState(true);

    if (tools.length === 0) return null;

    const toolIds = tools.map((tool) => tool.id);
    const permissionStatus = getConnectorPermissionStatus(tools);
    const permissionStatusLabels = {
      auto: t('connector.permission.auto', 'Auto — AI calls directly'),
      custom: t('connector.permission.custom', 'Custom'),
      disabled: t('connector.permission.disabled', 'Disabled — hidden from AI'),
      needs_approval: t('connector.permission.approval', 'Needs approval'),
    } satisfies Record<typeof permissionStatus, string>;

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
        <div className={styles.groupHeader} onClick={() => setExpanded((e) => !e)}>
          <div className={styles.groupLabel}>
            {expanded ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
            {label}
            <span className={styles.badge}>{tools.length}</span>
          </div>

          {!disabled && (
            <DropdownMenu items={batchItems}>
              <Button
                size="small"
                style={{ fontSize: 12, height: 26 }}
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontalIcon size={12} />
                {permissionStatusLabels[permissionStatus]}
                <ChevronDownIcon size={12} />
              </Button>
            </DropdownMenu>
          )}
        </div>

        {expanded && (
          <div>
            {tools.map((tool) => (
              <ToolPermissionRow
                connectorIdentifier={connectorIdentifier}
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
