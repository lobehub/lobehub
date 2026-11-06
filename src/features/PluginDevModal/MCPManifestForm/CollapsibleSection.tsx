import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { type ReactNode } from 'react';
import { useState } from 'react';

const styles = stylex.create({
  container: { marginBlockEnd: cssVar.marginLG },
  header: {
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    borderRadius: cssVar.borderRadius,
    color: { 'default': cssVar.colorTextTertiary, ':hover': cssVar.colorText },
    transition: `all ${cssVar.motionDurationMid} ease`,
  },
  title: { marginInlineStart: '4px', fontWeight: cssVar.fontWeightStrong, color: cssVar.colorText },
});

interface CollapsibleSectionProps {
  /** Child component content */
  children: ReactNode;
  /** Whether expanded by default */
  defaultExpanded?: boolean;
  /** Title text */
  title: string;
}

const CollapsibleSection = ({
  title,
  children,
  defaultExpanded = false,
}: CollapsibleSectionProps) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  return (
    <div {...stylex.props(styles.container)}>
      <div {...stylex.props(styles.header)} onClick={() => setIsExpanded(!isExpanded)}>
        {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span {...stylex.props(styles.title)}>{title}</span>
      </div>
      {isExpanded && <div>{children}</div>}
    </div>
  );
};

export default CollapsibleSection;
