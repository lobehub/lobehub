import { type ContextMenuItem, ContextMenuTrigger, Icon, type IconProps } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
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

const fadeIn = stylex.keyframes({ from: { opacity: 0 }, to: { opacity: 1 } });

const styles = stylex.create({
  close: {
    cursor: 'pointer',
    position: 'absolute',
    insetBlockStart: '50%',
    insetInlineEnd: CLOSE_INSET,
    transform: 'translateY(-50%)',
    display: 'grid',
    placeItems: 'center',
    width: CLOSE_SIZE,
    height: CLOSE_SIZE,
    padding: 0,
    borderWidth: 0,
    borderStyle: 'none',
    borderRadius: '4px',
    color: { 'default': cssVar.colorTextTertiary, ':hover': cssVar.colorText },
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillSecondary },
    backgroundImage: { 'default': 'none', ':hover': 'none' },
    transition: 'color 0.15s, background 0.15s',
    animationName: { 'default': fadeIn, '@media (prefers-reduced-motion: reduce)': 'none' },
    animationDuration: { 'default': '0.15s', '@media (prefers-reduced-motion: reduce)': '0s' },
    animationTimingFunction: {
      'default': 'ease-out',
      '@media (prefers-reduced-motion: reduce)': 'ease',
    },
  },
  container: {
    position: 'relative',
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    borderRadius: '6px',
    transition: 'background 0.15s',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillSecondary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  // Composed after `container`: a conditional value replaces the whole property,
  // so the hover colour is restated here.
  containerActive: {
    backgroundColor: { 'default': cssVar.colorFillTertiary, ':hover': cssVar.colorFillSecondary },
    backgroundImage: { 'default': 'none', ':hover': 'none' },
  },
  pinned: {
    pointerEvents: 'none',
    position: 'absolute',
    insetBlockStart: '50%',
    insetInlineEnd: '6px',
    transform: 'translateY(-50%)',
    display: 'grid',
    placeItems: 'center',
    color: cssVar.colorTextSecondary,
  },
  icon: { display: 'flex', flexShrink: 0 },
  label: { overflow: 'hidden', minWidth: '24px', maxWidth: '160px', textOverflow: 'ellipsis' },
  tab: {
    cursor: 'pointer',
    paddingBlock: '4px',
    paddingInline: TAB_PADDING,
    borderWidth: 0,
    borderStyle: 'none',
    borderRadius: '6px',
    fontSize: '12px',
    // attribute selector outranks the base class so the active color can't lose
    // to stylesheet ordering
    color: {
      'default': cssVar.colorTextTertiary,
      ':hover': cssVar.colorText,
      "[aria-pressed='true']": cssVar.colorText,
    },
    whiteSpace: 'nowrap',
    backgroundColor: 'transparent',
    backgroundImage: 'none',
    transition: 'color 0.15s',
  },
  tabTrailing: { paddingInlineEnd: TRAILING_SLOT },
  trigger: { display: 'flex', gap: '4px', alignItems: 'center' },
});

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
        {...stylex.props(
          styles.container,
          stylex.defaultMarker(),
          active && styles.containerActive,
        )}
        data-pinned={pinned ? 'true' : undefined}
        onAuxClick={handleAuxClick}
        onMouseDown={handleMouseDown}
      >
        <button
          aria-pressed={active}
          {...stylex.props(styles.tab, (pinned || showClose) && styles.tabTrailing)}
          data-tab-key={tabKey}
          title={typeof label === 'string' ? label : undefined}
          type="button"
          onClick={onSelect}
        >
          <span className={stylex.props(styles.trigger).className}>
            <span className={stylex.props(styles.icon).className}>
              {iconNode ?? <Icon icon={icon} size={14} />}
            </span>
            <span className={stylex.props(styles.label).className}>{label}</span>
          </span>
        </button>
        {pinned ? (
          <span aria-label={pinnedLabel} {...stylex.props(styles.pinned)} role="img">
            <Icon icon={PinIcon} size={12} />
          </span>
        ) : showClose ? (
          // Only the selected tab exposes a close button, so dense strips of
          // short labels never fill up with close targets.
          <button
            data-tab-close
            aria-label={closeLabel}
            {...stylex.props(styles.close)}
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
