import { Icon, type IconProps } from '@lobehub/ui';
import { type ContextMenuItem, ContextMenuTrigger } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { PinIcon, XIcon } from 'lucide-react';
import { memo, type ReactNode } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => ({
  close: css`
    cursor: pointer;

    position: absolute;
    inset-block-start: 50%;
    inset-inline-end: 4px;
    transform: translateY(-50%);

    display: grid;
    place-items: center;

    width: 20px;
    height: 20px;
    padding: 0;
    border: none;
    border-radius: 4px;

    color: ${cssVar.colorTextTertiary};

    background: transparent;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillSecondary};
    }
  `,
  container: css`
    position: relative;

    display: flex;
    flex-shrink: 0;
    align-items: center;

    border-radius: 6px;

    transition: background 0.15s;

    &:hover {
      background: ${cssVar.colorFillSecondary};
    }
  `,
  containerActive: css`
    background: ${cssVar.colorFillTertiary};
  `,
  pinned: css`
    pointer-events: none;

    position: absolute;
    inset-block-start: 50%;
    inset-inline-end: 8px;
    transform: translateY(-50%);

    display: grid;
    place-items: center;

    color: ${cssVar.colorTextSecondary};
  `,
  tab: css`
    cursor: pointer;

    padding-block: 4px;
    padding-inline: 10px;
    border: none;
    border-radius: 6px;

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
    white-space: nowrap;

    background: transparent;

    transition: color 0.15s;

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
  tabActive: css`
    color: ${cssVar.colorText};
  `,
  tabClosable: css`
    padding-inline-end: 30px;
  `,
  trigger: css`
    display: flex;
    gap: 4px;
    align-items: center;
  `,
}));

interface WorkspaceTabProps {
  active: boolean;
  closeLabel?: string;
  contextMenuItems?: ContextMenuItem[];
  fixed?: boolean;
  icon: IconProps['icon'];
  label: ReactNode;
  onClose?: () => void;
  onSelect: () => void;
  pinned?: boolean;
  pinnedLabel?: string;
  tabKey: string;
}

const WorkspaceTab = memo<WorkspaceTabProps>(
  ({
    active,
    closeLabel,
    contextMenuItems,
    fixed,
    icon,
    label,
    onClose,
    onSelect,
    pinned,
    pinnedLabel,
    tabKey,
  }) => {
    const content = (
      <div
        className={`${styles.container} ${active ? styles.containerActive : ''}`}
        data-pinned={pinned ? 'true' : undefined}
      >
        <button
          aria-pressed={active}
          className={`${styles.tab} ${active ? styles.tabActive : ''} ${!fixed && (onClose || pinned) ? styles.tabClosable : ''}`}
          data-tab-key={tabKey}
          type="button"
          onClick={onSelect}
        >
          <span className={styles.trigger}>
            <Icon icon={icon} size={14} />
            {label}
          </span>
        </button>
        {!fixed && pinned ? (
          <span aria-label={pinnedLabel} className={styles.pinned} role="img">
            <Icon icon={PinIcon} size={12} />
          </span>
        ) : !fixed && onClose ? (
          <button aria-label={closeLabel} className={styles.close} type="button" onClick={onClose}>
            <Icon icon={XIcon} size={12} />
          </button>
        ) : null}
      </div>
    );

    return contextMenuItems ? (
      <ContextMenuTrigger items={contextMenuItems}>{content}</ContextMenuTrigger>
    ) : (
      content
    );
  },
);

WorkspaceTab.displayName = 'WorkingSidebarTab';

export default WorkspaceTab;
