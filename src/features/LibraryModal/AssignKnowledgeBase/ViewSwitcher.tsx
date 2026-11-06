import { ActionIcon, Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { Grid3x3Icon, ListIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

export type ViewMode = 'list' | 'masonry';

interface ViewSwitcherProps {
  onViewChange: (view: ViewMode) => void;
  view: ViewMode;
}

const styles = stylex.create({ container: { gap: '4px' } });

const ViewSwitcher = memo<ViewSwitcherProps>(({ onViewChange, view }) => {
  const { t } = useTranslation('components');

  return (
    <Flexbox horizontal className={stylex.props(styles.container).className}>
      <ActionIcon
        active={view === 'list'}
        icon={ListIcon}
        size={16}
        title={t('FileManager.view.list')}
        onClick={() => onViewChange('list')}
      />
      <ActionIcon
        active={view === 'masonry'}
        icon={Grid3x3Icon}
        size={16}
        title={t('FileManager.view.masonry')}
        onClick={() => onViewChange('masonry')}
      />
    </Flexbox>
  );
});

export default ViewSwitcher;
