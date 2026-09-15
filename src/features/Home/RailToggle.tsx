import { ActionIcon } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { PanelRightCloseIcon, PanelRightOpenIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css }) => ({
  root: css`
    &:dir(rtl) svg {
      transform: scaleX(-1);
    }
  `,
}));

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
      className={styles.root}
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
