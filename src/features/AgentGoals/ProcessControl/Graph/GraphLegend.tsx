import { Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { GoalGraphNodeKind } from '../../Experiments/model';
import { KindDot } from '../shared';

const styles = stylex.create({
  legend: { fontSize: '12px', color: cssVar.colorTextTertiary },
  legendItem: {
    cursor: 'pointer',
    userSelect: 'none',
    color: { 'default': null, ':hover': cssVar.colorText },
  },
  legendMainlineSwatch: {
    width: '10px',
    height: '10px',
    borderWidth: '1.5px',
    borderStyle: 'solid',
    borderColor: cssVar.colorInfo,
    borderRadius: '3px',
  },
  legendOff: { opacity: { 'default': 0.35, ':hover': 0.65 } },
});

const LegendToggle = ({
  children,
  on,
  onToggle,
  title,
}: {
  children: ReactNode;
  on: boolean;
  onToggle: () => void;
  title: string;
}) => (
  <Flexbox
    horizontal
    align={'center'}
    aria-pressed={on}
    className={stylex.props(styles.legendItem, !on && styles.legendOff).className}
    gap={4}
    role={'button'}
    tabIndex={0}
    title={title}
    onClick={onToggle}
    onKeyDown={(event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onToggle();
      }
    }}
  >
    {children}
  </Flexbox>
);

interface GraphLegendProps {
  hasMainline: boolean;
  hiddenKinds: ReadonlySet<GoalGraphNodeKind>;
  kinds: readonly GoalGraphNodeKind[];
  onToggleKind: (kind: GoalGraphNodeKind) => void;
  onToggleMainline: () => void;
  showMainline: boolean;
}

/**
 * The map's legend. Each kind is a filter — click it off and the map relayouts
 * around what remains. 主线 is a highlight, off by default: a finished map reads
 * plain until the user asks to see the path the wrap-up report marked.
 */
const GraphLegend = memo<GraphLegendProps>(
  ({ hasMainline, hiddenKinds, kinds, onToggleKind, onToggleMainline, showMainline }) => {
    const { t } = useTranslation('chat');
    return (
      <Flexbox
        horizontal
        align={'center'}
        className={stylex.props(styles.legend).className}
        gap={10}
      >
        {hasMainline && (
          <LegendToggle
            on={showMainline}
            title={t('goalProcess.graph.legend.mainlineHint')}
            onToggle={onToggleMainline}
          >
            <span {...stylex.props(styles.legendMainlineSwatch)} />
            <span>{t('goalProcess.graph.legend.mainline')}</span>
          </LegendToggle>
        )}
        {kinds.map((kind) => {
          const off = hiddenKinds.has(kind);
          return (
            <LegendToggle
              key={kind}
              on={!off}
              title={t(off ? 'goalProcess.graph.legend.show' : 'goalProcess.graph.legend.hide')}
              onToggle={() => onToggleKind(kind)}
            >
              <KindDot kind={kind} />
              <span>{t(`goalProcess.kind.${kind}` as const)}</span>
            </LegendToggle>
          );
        })}
      </Flexbox>
    );
  },
);

GraphLegend.displayName = 'GoalGraphLegend';

export default GraphLegend;
