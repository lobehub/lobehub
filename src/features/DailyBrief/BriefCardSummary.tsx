import { Button, Flexbox, Markdown, MaskShadow } from '@lobehub/ui';
import { useSize } from 'ahooks';
import { Divider } from 'antd';
import { ChevronsDownUpIcon, ChevronsUpDownIcon } from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { styles } from './style';

export const COLLAPSED_MAX_HEIGHT = 240;

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
    <Markdown ref={ref} style={{ overflow: 'unset' }} variant={'chat'}>
      {summary}
    </Markdown>
  );

  return (
    <Flexbox gap={4}>
      <Divider dashed style={{ marginTop: 0, marginBottom: 8 }} />
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
          iconPlacement={'end'}
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
