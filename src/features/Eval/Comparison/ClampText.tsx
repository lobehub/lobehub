'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { type CSSProperties, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { styles } from './style';

interface ClampTextProps {
  children: string;
  className?: string;
  lines?: number;
  style?: CSSProperties;
}

/**
 * Long text clamped to a few lines, with a "Show more" toggle that appears
 * only when the text actually overflows.
 */
const ClampText = ({ children, className, lines = 3, style }: ClampTextProps) => {
  const { t } = useTranslation('eval');
  const ref = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || expanded) return;
    const measure = () => setOverflows(el.scrollHeight - el.clientHeight > 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [children, expanded, lines]);

  return (
    <Flexbox gap={4}>
      <div
        className={`${styles.clamp} ${className ?? ''}`}
        ref={ref}
        style={{ ...style, WebkitLineClamp: expanded ? 'unset' : lines }}
      >
        {children}
      </div>
      {(overflows || expanded) && (
        <button className={styles.linkButton} type="button" onClick={() => setExpanded(!expanded)}>
          {expanded ? t('comparison.clamp.less') : t('comparison.clamp.more')}
          <Icon icon={expanded ? ChevronUp : ChevronDown} size={12} />
        </button>
      )}
    </Flexbox>
  );
};

export default ClampText;
