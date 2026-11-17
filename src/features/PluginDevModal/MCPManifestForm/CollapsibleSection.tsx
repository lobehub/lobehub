import { createStaticStyles, cx } from '@lobehub/ui';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { type ReactNode } from 'react';
import { useState } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => ({
  header: css`
    cursor: pointer;

    display: flex;
    align-items: center;

    /* Same block padding as a Form.Field, so the row sits one field-gap from its neighbours */
    padding-block: var(--lobe-form-item-padding-block, ${cssVar.padding});
    border-radius: ${cssVar.borderRadius};

    color: ${cssVar.colorTextTertiary};

    transition: all ${cssVar.motionDurationMid} ease;

    &:hover {
      color: ${cssVar.colorText};
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

  const toggle = () => {
    setInnerExpanded(!isExpanded);
    onExpandedChange?.(!isExpanded);
  };

  return (
    <div>
      <div className={cx(styles.header)} onClick={toggle}>
        {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span className={styles.title}>{title}</span>
      </div>
      {isExpanded && <div>{children}</div>}
    </div>
  );
};

export default CollapsibleSection;
