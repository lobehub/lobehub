import { Icon, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronDownIcon, LockIcon, ZapIcon } from 'lucide-react';
import type { ComponentPropsWithRef } from 'react';
import { memo } from 'react';

import { sx } from '@/styles/sx';

const styles = stylex.create({
  // The chip's content as one hover target, so the reason tooltip covers the whole label.
  content: {
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
    minWidth: '0',
  },
  label: {
    overflow: 'hidden',
    minWidth: '0',
    maxWidth: '200px',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  lock: { flex: 'none', color: cssVar.colorWarning },
  // Dims one step while the trigger (the default marker) is idle, and follows it on hover.
  secondary: {
    flex: 'none',
    color: {
      default: cssVar.colorTextTertiary,
      [stylex.when.ancestor(':hover')]: cssVar.colorTextSecondary,
    },
    transition: 'color 0.2s',
  },
  trigger: {
    cursor: 'pointer',
    display: 'flex',
    flexGrow: '0',
    flexShrink: '1',
    flexBasis: 'auto',
    gap: '6px',
    alignItems: 'center',
    minWidth: '0',
    maxWidth: '100%',
    height: '28px',
    paddingInline: '8px',
    borderRadius: '6px',
    fontSize: '12px',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    whiteSpace: 'nowrap',
    transition: 'all 0.2s',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillSecondary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
});

/**
 * The chip both composer model selectors open from — the heterogeneous one and
 * the standard model + reasoning-effort one. Text only by design: the label
 * already names the model, so an icon would only add noise next to Send.
 *
 * The chip reads as two halves, the way the Codex composer does ("5.6 Sol 极高"):
 * `text` is the model, `secondaryText` the reasoning effort. Only the model half
 * may be ellipsised; the effort half never shrinks, so a long model name can
 * no longer push the effort out of view, and it renders a step dimmer so the
 * two values scan as name + qualifier instead of one run-on label.
 * The trigger can shrink with its send area on narrow panels; only the model
 * label gives up width so the effort and adjacent Send control remain visible.
 *
 * `DropdownMenuTrigger` clones its child to inject the open handler, ref and
 * `aria-haspopup`/`aria-expanded`. Swallowing the rest props here leaves a
 * chip that renders correctly and never opens, so they must reach the element.
 */
interface TriggerProps extends ComponentPropsWithRef<'div'> {
  ariaLabel: string;
  /**
   * Why the selected model cannot run for this viewer (e.g. above the tier a workspace
   * admin allows them): a lock before the name, and the reason on hover. The chip still
   * opens its menu, which is where another model is picked.
   */
  disabledReason?: string;
  /** Leave the reason tooltip to a host that already wraps the chip in its own tooltip. */
  disabledReasonTooltip?: boolean;
  fast?: boolean;
  secondaryText?: string;
  text: string;
}

const SelectorTrigger = memo<TriggerProps>(
  ({
    ariaLabel,
    className,
    disabledReason,
    disabledReasonTooltip = true,
    fast,
    secondaryText,
    style,
    text,
    ...rest
  }) => {
    const label = (
      <>
        {disabledReason && (
          <span {...stylex.props(styles.lock)}>
            <Icon icon={LockIcon} size={12} />
          </span>
        )}
        {fast && <Icon icon={ZapIcon} size={12} />}
        <span {...stylex.props(styles.label)}>{text}</span>
        {secondaryText && <span {...stylex.props(styles.secondary)}>{secondaryText}</span>}
      </>
    );

    return (
      <div
        {...rest}
        aria-label={disabledReason ? `${ariaLabel} · ${disabledReason}` : ariaLabel}
        {...sx(styles.trigger, stylex.defaultMarker(), className, style)}
      >
        {/* The tooltip wraps the content, not the chip: the menu trigger clones the chip itself. */}
        {disabledReason && disabledReasonTooltip ? (
          <Tooltip title={disabledReason}>
            <span {...stylex.props(styles.content)}>{label}</span>
          </Tooltip>
        ) : (
          label
        )}
        <Icon icon={ChevronDownIcon} size={12} />
      </div>
    );
  },
);

SelectorTrigger.displayName = 'SelectorTrigger';

export default SelectorTrigger;
