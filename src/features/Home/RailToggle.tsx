import { ActionIcon } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { PanelRightCloseIcon, PanelRightOpenIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = stylex.create({
  icon: {
    transform: { 'default': null, ':dir(rtl)': 'scaleX(-1)' },
  },
});

interface RailToggleProps {
  onToggle: () => void;
  railVisible: boolean;
}

const RailToggle = memo<RailToggleProps>(({ onToggle, railVisible }) => {
  const { t } = useTranslation('home');
  const label = railVisible ? t('dashboard.rail.hide') : t('dashboard.rail.show');

  return (
    <ActionIcon
      aria-controls={'home-rail'}
      aria-expanded={railVisible}
      aria-label={label}
      classNames={{ icon: stylex.props(styles.icon).className }}
      data-testid={'home-rail-toggle'}
      icon={railVisible ? PanelRightCloseIcon : PanelRightOpenIcon}
      size={'small'}
      title={label}
      variant={'borderless'}
      onClick={onToggle}
    />
  );
});

RailToggle.displayName = 'RailToggle';

export default RailToggle;
