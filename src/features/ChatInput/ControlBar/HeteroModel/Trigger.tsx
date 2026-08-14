import { Icon } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { ChevronDownIcon, ZapIcon } from 'lucide-react';
import type { ComponentPropsWithRef } from 'react';
import { memo } from 'react';

const styles = createStaticStyles(({ css }) => ({
  label: css`
    overflow: hidden;
    max-width: 150px;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  trigger: css`
    cursor: pointer;

    display: flex;
    flex: none;
    gap: 6px;
    align-items: center;

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
    }
  `,
}));

/**
 * `DropdownMenuTrigger` clones its child to inject the open handler, ref and
 * `aria-haspopup`/`aria-expanded`. Swallowing the rest props here leaves a
 * chip that renders correctly and never opens, so they must reach the element.
 */
interface TriggerProps extends ComponentPropsWithRef<'div'> {
  ariaLabel: string;
  fast?: boolean;
  text: string;
}

const Trigger = memo<TriggerProps>(({ ariaLabel, className, fast, text, ...rest }) => (
  <div {...rest} aria-label={ariaLabel} className={cx(styles.trigger, className)}>
    {fast && <Icon icon={ZapIcon} size={12} />}
    <span className={styles.label}>{text}</span>
    <Icon icon={ChevronDownIcon} size={12} />
  </div>
));

Trigger.displayName = 'HeteroModelTrigger';

export default Trigger;
