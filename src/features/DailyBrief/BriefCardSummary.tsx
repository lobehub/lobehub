import { Flexbox, MaskShadow } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { useSize } from 'ahooks';
import { ChevronsDownUpIcon, ChevronsUpDownIcon } from 'lucide-react';
import { lazy, memo, Suspense, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { styles } from './style';

const Markdown = lazy(() => import('@lobehub/ui/es/Markdown/index'));

export const COLLAPSED_MAX_HEIGHT = 180;

interface BriefCardSummaryProps {
  summary: string;
}

const BriefCardSummary = memo<BriefCardSummaryProps>(({ summary }) => {
  const { t } = useTranslation('home');
  const [expanded, setExpanded] = useState(false);
  const [isOverflow, setIsOverflow] = useState(false);
  const ref = useRef<any>(null);
  const size = useSize(ref);

  useEffect(() => {
    if (!size) return;
    setIsOverflow(size.height > COLLAPSED_MAX_HEIGHT);
  }, [size]);

  const content = (
    <Suspense fallback={null}>
      <Markdown ref={ref} style={{ overflow: 'unset' }} variant={'chat'}>
        {summary}
      </Markdown>
    </Suspense>
  );

  return (
    <Flexbox gap={4}>
      {isOverflow && !expanded ? (
        <MaskShadow
          size={32}
          style={{
            maxHeight: expanded ? undefined : COLLAPSED_MAX_HEIGHT,
          }}
        >
          {content}
        </MaskShadow>
      ) : (
        content
      )}

      {isOverflow && (
        <Button
          block
          className={styles.expandLink}
          icon={expanded ? ChevronsDownUpIcon : ChevronsUpDownIcon}
          iconPosition={'end'}
          size={'small'}
          type={'text'}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? t('brief.collapse') : t('brief.expandAll')}
        </Button>
      )}
    </Flexbox>
  );
});

export default BriefCardSummary;
