import {
  type ContextMenuItem,
  ContextMenuTrigger,
  createStaticStyles,
  Icon,
  type IconProps,
  keyframes,
} from '@lobehub/ui';
import { PinIcon, XIcon } from 'lucide-react';
import { memo, type MouseEvent, type ReactNode } from 'react';

/**
 * Room the trailing pin badge or close button needs at the tab's end. Pinned
 * tabs always reserve it; the active tab reserves it for its close button so the
 * label keeps its full width, and unselected tabs carry no empty gap.
 */
const TRAILING_SLOT = 24;
const TAB_PADDING = 8;
const CLOSE_INSET = 4;
const CLOSE_SIZE = 16;

const fadeIn = keyframes`
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
`;

const styles = createStaticStyles(({ css, cssVar }) => ({
  close: css`
    cursor: pointer;

    position: absolute;
    inset-block-start: 50%;
    inset-inline-end: ${CLOSE_INSET}px;
    transform: translateY(-50%);

    display: grid;
    place-items: center;

    width: ${CLOSE_SIZE}px;
    height: ${CLOSE_SIZE}px;
    padding: 0;
    border: none;
    border-radius: 4px;

    color: ${cssVar.colorTextTertiary};

    background: transparent;

    transition:
      color 0.15s,
      background 0.15s;
    animation: ${fadeIn} 0.15s ease-out;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillSecondary};
    }

    @media (prefers-reduced-motion: reduce) {
      animation: none;
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
    inset-inline-end: 6px;
    transform: translateY(-50%);

    display: grid;
    place-items: center;

    color: ${cssVar.colorTextSecondary};
  `,
  icon: css`
    display: flex;
    flex-shrink: 0;
  `,
  label: css`
    overflow: hidden;
    min-width: 24px;
    max-width: 160px;
    text-overflow: ellipsis;
  `,
  tab: css`
    cursor: pointer;

    padding-block: 4px;
    padding-inline: ${TAB_PADDING}px;
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

    /* attribute selector outranks the base class so the active color can't lose
       to stylesheet ordering */
    &[aria-pressed='true'] {
      color: ${cssVar.colorText};
    }
  `,
  tabTrailing: css`
    padding-inline-end: ${TRAILING_SLOT}px;
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
  icon: IconProps['icon'];
  iconNode?: ReactNode;
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
    icon,
    iconNode,
    label,
    onClose,
    onSelect,
    pinned,
    pinnedLabel,
    tabKey,
  }) => {
    const closable = !pinned && !!onClose;
    const showClose = closable && active;

    // Middle click closes any closable tab — a shortcut on top of the active
    // tab's close button and the context menu, never the only way to close.
    const handleMouseDown = (e: MouseEvent) => {
      // keep the browser from entering autoscroll mode on middle press
      if (closable && e.button === 1) e.preventDefault();
    };
    const handleAuxClick = (e: MouseEvent) => {
      if (!closable || e.button !== 1) return;
      e.preventDefault();
      onClose?.();
    };

    const content = (
      <div
        className={`${styles.container} ${active ? styles.containerActive : ''}`}
        data-pinned={pinned ? 'true' : undefined}
        onAuxClick={handleAuxClick}
        onMouseDown={handleMouseDown}
      >
        <button
          aria-pressed={active}
          className={`${styles.tab} ${pinned || showClose ? styles.tabTrailing : ''}`}
          data-tab-key={tabKey}
          title={typeof label === 'string' ? label : undefined}
          type="button"
          onClick={onSelect}
        >
          <span className={styles.trigger}>
            <span className={styles.icon}>{iconNode ?? <Icon icon={icon} size={14} />}</span>
            <span className={styles.label}>{label}</span>
          </span>
        </button>
        {pinned ? (
          <span aria-label={pinnedLabel} className={styles.pinned} role="img">
            <Icon icon={PinIcon} size={12} />
          </span>
        ) : showClose ? (
          // Only the selected tab exposes a close button, so dense strips of
          // short labels never fill up with close targets.
          <button
            data-tab-close
            aria-label={closeLabel}
            className={styles.close}
            type="button"
            onClick={onClose}
          >
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
