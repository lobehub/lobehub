import { Popover } from '@lobehub/ui';
import type { ReactNode } from 'react';
import { memo, useRef } from 'react';

import { useDetailPopoverState } from '../components/useDetailPopoverState';

interface SkillRowProps {
  className?: string;
  /** Rich detail card shown while hovering the label cell. */
  detailContent?: ReactNode;
  detailDisabled?: boolean;
  label: ReactNode;
  labelClassName?: string;
  onContextMenu?: () => void;
  trailing: ReactNode;
  trailingClassName?: string;
}

/**
 * The hover detail card is anchored to the whole row but triggered only by the
 * label cell, so moving right onto the "..." button leaves the trigger and lets
 * the card go — the two used to share one hover, which is why a card could land
 * on top of the policy menu and swallow the click meant for it. The card is
 * also inert (pointer-events: none): a press landing on the portal'd card is
 * read by base-ui as an outside press that dismisses the enclosing menu.
 */
const SkillRow = memo<SkillRowProps>(
  ({
    className,
    detailContent,
    detailDisabled,
    label,
    labelClassName,
    onContextMenu,
    trailing,
    trailingClassName,
  }) => {
    const rowRef = useRef<HTMLSpanElement>(null);
    const { onOpenChange, open } = useDetailPopoverState(detailDisabled);

    const labelCell = <span className={labelClassName}>{label}</span>;

    return (
      <span
        className={className}
        ref={rowRef}
        onContextMenu={
          onContextMenu &&
          ((event) => {
            event.preventDefault();
            event.stopPropagation();
            onContextMenu();
          })
        }
      >
        {detailContent ? (
          <Popover
            arrow={false}
            content={detailContent}
            disabled={detailDisabled}
            mouseEnterDelay={0.3}
            open={open}
            placement={'rightTop'}
            positionerProps={{ anchor: rowRef, sideOffset: 8 }}
            styles={{ content: { padding: 0 }, root: { pointerEvents: 'none' } }}
            onOpenChange={onOpenChange}
          >
            {labelCell}
          </Popover>
        ) : (
          labelCell
        )}
        <span data-tool-trailing className={trailingClassName}>
          {trailing}
        </span>
      </span>
    );
  },
);

SkillRow.displayName = 'SkillRow';

export default SkillRow;
