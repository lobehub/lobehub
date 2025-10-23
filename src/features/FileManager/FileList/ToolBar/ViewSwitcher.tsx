import { ActionIcon } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { Grid3x3Icon, ListIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

export type ViewMode = 'list' | 'masonry';

interface ViewSwitcherProps {
  onViewChange: (view: ViewMode) => void;
  view: ViewMode;
}

const useStyles = createStyles(({ css }) => ({
  container: css`
    gap: 4px;
  `,
}));

const ViewSwitcher = memo<ViewSwitcherProps>(({ onViewChange, view }) => {
  const { t } = useTranslation('components');
  const { styles } = useStyles();

  return (
    <Flexbox className={styles.container} horizontal>
      <ActionIcon
        active={view === 'list'}
        icon={ListIcon}
        onClick={() => onViewChange('list')}
        size={16}
        title={t('FileManager.view.list')}
      />
      <ActionIcon
        active={view === 'masonry'}
        icon={Grid3x3Icon}
        onClick={() => onViewChange('masonry')}
        size={16}
        title={t('FileManager.view.masonry')}
      />
    </Flexbox>
  );
});

export default ViewSwitcher;
