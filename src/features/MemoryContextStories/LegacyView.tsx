import { Button, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArrowLeftIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import MemoryEntities from '@/features/MemoryEntities';

const styles = stylex.create({
  root: { display: 'flex', flexDirection: 'column', height: '100%', width: '100%' },
  banner: {
    alignItems: 'center',
    borderBlockEndColor: cssVar.colorBorderSecondary,
    borderBlockEndStyle: 'solid',
    borderBlockEndWidth: '1px',
    color: cssVar.colorTextSecondary,
    display: 'flex',
    flexShrink: 0,
    flexWrap: 'wrap',
    fontSize: '13px',
    gap: '12px',
    paddingBlock: '8px',
    paddingInline: '16px',
  },
  body: { display: 'flex', flex: '1', minHeight: 0 },
});

/** The per-topic contexts consolidation did not file, in the page they always had. */
const LegacyView = memo<{ onBack: () => void }>(({ onBack }) => {
  const { t } = useTranslation('memory');
  return (
    <div {...stylex.props(styles.root)}>
      <div {...stylex.props(styles.banner)}>
        <Button icon={<Icon icon={ArrowLeftIcon} />} size={'small'} onClick={onBack}>
          {t('story.legacy.back')}
        </Button>
        <span>{t('story.legacy.banner')}</span>
      </div>
      <div {...stylex.props(styles.body)}>
        <MemoryEntities />
      </div>
    </div>
  );
});

LegacyView.displayName = 'StoryLegacyView';

export default LegacyView;
