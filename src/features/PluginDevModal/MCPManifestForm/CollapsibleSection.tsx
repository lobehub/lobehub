import { createStaticStyles, cx } from '@lobehub/ui';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { type ReactNode } from 'react';
import { useId, useState } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => ({
  header: css`
    cursor: pointer;

    display: flex;
    align-items: center;

    width: 100%;
    /* Same block padding as a Form.Field, so the row sits one field-gap from its neighbours */
    padding-block: var(--lobe-form-item-padding-block, ${cssVar.padding});
    padding-inline: 0;
    border: none;
    border-radius: ${cssVar.borderRadius};

    font: inherit;
    color: ${cssVar.colorTextTertiary};
    text-align: start;

    background: transparent;

    transition: all ${cssVar.motionDurationMid} ease;

    &:hover {
      color: ${cssVar.colorText};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimaryBorder};
      outline-offset: 1px;
    }
  `,

  title: css`
    margin-inline-start: 4px;
    font-weight: ${cssVar.fontWeightStrong};
    color: ${cssVar.colorText};
  `,
}));

interface CollapsibleSectionProps {
  /** Child component content */
  children: ReactNode;
  /** Whether expanded by default */
  defaultExpanded?: boolean;
  /** Controlled expanded state; pair with `onExpandedChange` */
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  /** Title text */
  title: string;
}

const CollapsibleSection = ({
  title,
  children,
  defaultExpanded = false,
  expanded,
  onExpandedChange,
}: CollapsibleSectionProps) => {
  const [innerExpanded, setInnerExpanded] = useState(defaultExpanded);
  const isExpanded = expanded ?? innerExpanded;
  const triggerId = useId();
  const panelId = useId();

  const toggle = () => {
    setInnerExpanded(!isExpanded);
    onExpandedChange?.(!isExpanded);
  };

  return (
    <div>
      {/* A real button so keyboard users can reach the fields kept collapsed here */}
      <button
        aria-controls={isExpanded ? panelId : undefined}
        aria-expanded={isExpanded}
        className={cx(styles.header)}
        id={triggerId}
        type="button"
        onClick={toggle}
      >
        {isExpanded ? (
          <ChevronDown aria-hidden size={16} />
        ) : (
          <ChevronRight aria-hidden size={16} />
        )}
        <span className={styles.title}>{title}</span>
      </button>
      {isExpanded && (
        <div aria-labelledby={triggerId} id={panelId} role="region">
          {children}
        </div>
      )}
    </div>
  );
};

export default CollapsibleSection;
