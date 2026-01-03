import { ActionIcon, Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { Grid3x3Icon, ListIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

export type ViewMode = 'list' | 'masonry';

interface ViewSwitcherProps {
  onViewChange: (view: ViewMode) => void;
  view: ViewMode;
}

const styles = createStaticStyles(({ css }) => ({
  container: css`
    gap: 4px;
  `,
}));

const ViewSwitcher = memo<ViewSwitcherProps>(({ onViewChange, view }) => {
  const { t } = useTranslation('components');

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
