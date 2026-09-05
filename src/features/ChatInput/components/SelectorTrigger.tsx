import { Icon } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { ChevronDownIcon, ZapIcon } from 'lucide-react';
import type { ComponentPropsWithRef } from 'react';
import { memo } from 'react';

const styles = createStaticStyles(({ css }) => ({
  label: css`
    overflow: hidden;

    min-width: 0;
    max-width: 200px;

    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  secondary: css`
    flex: none;
    color: ${cssVar.colorTextTertiary};
    transition: color 0.2s;
  `,
  trigger: css`
    cursor: pointer;

    display: flex;
    flex: 0 1 auto;
    gap: 6px;
    align-items: center;

    min-width: 0;
    max-width: 100%;
    height: 28px;
    padding-inline: 8px;
    border-radius: 6px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    white-space: nowrap;

    transition: all 0.2s;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillSecondary};

      [data-secondary] {
        color: ${cssVar.colorTextSecondary};
      }
    }
  `,
}));

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
  fast?: boolean;
  secondaryText?: string;
  text: string;
}

const SelectorTrigger = memo<TriggerProps>(
  ({ ariaLabel, className, fast, secondaryText, text, ...rest }) => (
    <div {...rest} aria-label={ariaLabel} className={cx(styles.trigger, className)}>
      {fast && <Icon icon={ZapIcon} size={12} />}
      <span className={styles.label}>{text}</span>
      {secondaryText && (
        <span data-secondary className={styles.secondary}>
          {secondaryText}
        </span>
      )}
      <Icon icon={ChevronDownIcon} size={12} />
    </div>
  ),
);

SelectorTrigger.displayName = 'SelectorTrigger';

export default SelectorTrigger;
