import { Markdown } from '@lobehub/ui';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { COLLAPSED_MAX_HEIGHT } from './const';
import { styles } from './style';

interface BriefCardSummaryProps {
  summary: string;
}

const BriefCardSummary = memo<BriefCardSummaryProps>(({ summary }) => {
  const { t } = useTranslation('home');
  const [expanded, setExpanded] = useState(false);
  const [isOverflow, setIsOverflow] = useState(false);

  const handleRef = useCallback((node: HTMLDivElement | null) => {
    if (node) {
      setIsOverflow(node.scrollHeight > COLLAPSED_MAX_HEIGHT);
    }
  }, []);

  return (
    <div className={styles.summaryBox}>
      <div className={!expanded && isOverflow ? styles.collapsed : undefined} ref={handleRef}>
        <Markdown variant={'chat'}>{summary}</Markdown>
      </div>
      {isOverflow && (
        <button className={styles.expandLink} type="button" onClick={() => setExpanded(!expanded)}>
          {expanded ? t('brief.collapse') : t('brief.expandAll')}
        </button>
      )}
    </div>
  );
});

export default BriefCardSummary;
