import { createStaticStyles, cx } from 'antd-style';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { type ReactNode } from 'react';
import { useState } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    margin-block-end: ${cssVar.marginLG};
  `,

  header: css`
    cursor: pointer;

    display: flex;
    align-items: center;

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
  /** 子组件内容 */
  children: ReactNode;
  /** 默认是否展开 */
  defaultExpanded?: boolean;
  /** 标题文本 */
  title: string;
}

const CollapsibleSection = ({
  title,
  children,
  defaultExpanded = false,
}: CollapsibleSectionProps) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  return (
    <div className={styles.container}>
      <div className={cx(styles.header)} onClick={() => setIsExpanded(!isExpanded)}>
        {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span className={styles.title}>{title}</span>
      </div>
      {isExpanded && <div>{children}</div>}
    </div>
  );
};

export default CollapsibleSection;
