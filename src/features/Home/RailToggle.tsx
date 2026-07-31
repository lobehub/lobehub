import { ActionIcon } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
} from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css, cssVar }) => ({
  edge: css`
    color: ${cssVar.colorTextQuaternary};
    opacity: 0.56;
    background: ${cssVar.colorFillQuaternary};
    transition:
      color ${cssVar.motionDurationFast} ${cssVar.motionEaseOut},
      background ${cssVar.motionDurationFast} ${cssVar.motionEaseOut},
      opacity ${cssVar.motionDurationFast} ${cssVar.motionEaseOut};

    &[aria-expanded='false'] {
      opacity: 0.8;
    }

    &:hover,
    &:focus-visible {
      color: ${cssVar.colorTextSecondary};
      opacity: 1;
      background: ${cssVar.colorFillSecondary};
    }

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
  root: css`
    &:dir(rtl) svg {
      transform: scaleX(-1);
    }
  `,
}));

const EDGE_SIZE = { blockSize: 40, borderRadius: 999, size: 14, strokeWidth: 2 } as const;
const EDGE_STYLE = { width: 18 } as const;

interface RailToggleProps {
  edge?: boolean;
  onToggle: () => void;
  railVisible: boolean;
  testId: string;
}

const RailToggle = memo<RailToggleProps>(({ edge, onToggle, railVisible, testId }) => {
  const { t } = useTranslation('home');
  const label = railVisible ? t('dashboard.rail.hide') : t('dashboard.rail.show');
  const icon = edge
    ? railVisible
      ? ChevronRightIcon
      : ChevronLeftIcon
    : railVisible
      ? PanelRightCloseIcon
      : PanelRightOpenIcon;

  return (
    <ActionIcon
      aria-controls={'home-rail'}
      aria-expanded={railVisible}
      aria-label={label}
      className={cx(styles.root, edge && styles.edge)}
      data-testid={testId}
      icon={icon}
      size={edge ? EDGE_SIZE : 'small'}
      style={edge ? EDGE_STYLE : undefined}
      title={label}
      variant={'borderless'}
      onClick={onToggle}
    />
  );
});

RailToggle.displayName = 'RailToggle';

export default RailToggle;
