import { Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';

import type { HomeView } from './useHomeView';

const VIEWS: HomeView[] = ['mine', 'team'];

const styles = stylex.create({
  tab: {
    backgroundColor: 'transparent',
    borderStyle: 'none',
    borderWidth: 0,
    color: { 'default': cssVar.colorTextTertiary, ':hover': cssVar.colorTextSecondary },
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 400,
    paddingBlock: 4,
    paddingInline: 8,
    position: 'relative',
  },
  active: {
    color: { 'default': cssVar.colorText, ':hover': cssVar.colorText },
    fontWeight: 600,
  },
  dot: {
    backgroundColor: cssVar.colorText,
    borderRadius: 2,
    bottom: -2,
    height: 4,
    insetInlineStart: 'calc(50% - 2px)',
    position: 'absolute',
    width: 4,
  },
});

interface HomeViewTabsProps {
  onChange: (view: HomeView) => void;
  value: HomeView;
}

const HomeViewTabs = ({ onChange, value }: HomeViewTabsProps) => {
  const { t } = useTranslation('home');

  return (
    <Flexbox horizontal gap={4} role={'tablist'}>
      {VIEWS.map((view) => (
        <button
          aria-selected={value === view}
          data-testid={`home-view-${view}`}
          key={view}
          role={'tab'}
          type={'button'}
          {...stylex.props(styles.tab, value === view && styles.active)}
          onClick={() => onChange(view)}
        >
          {t(`inbox.scope.${view}`)}
          {value === view && <span {...stylex.props(styles.dot)} />}
        </button>
      ))}
    </Flexbox>
  );
};

export default HomeViewTabs;
