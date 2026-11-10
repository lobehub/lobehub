import { createStaticStyles, cssVar, cx, Flexbox } from '@lobehub/ui';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { GoalGraphNodeKind } from '../../Experiments/model';
import { KindDot } from '../shared';

const styles = createStaticStyles(({ css }) => ({
  legend: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  legendItem: css`
    cursor: pointer;
    user-select: none;

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
  /* The mainline is drawn as a ring on its cards, so the swatch is a ring too. */
  legendMainlineSwatch: css`
    width: 10px;
    height: 10px;
    border: 1.5px solid ${cssVar.colorInfo};
    border-radius: 3px;
  `,
  /* A hidden kind stays in the legend as a dimmed toggle — the way back must
     be exactly where the way in was. */
  legendOff: css`
    opacity: 0.35;

    &:hover {
      opacity: 0.65;
    }
  `,
}));

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
    className={cx(styles.legendItem, !on && styles.legendOff)}
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
      <Flexbox horizontal align={'center'} className={styles.legend} gap={10}>
        {hasMainline && (
          <LegendToggle
            on={showMainline}
            title={t('goalProcess.graph.legend.mainlineHint')}
            onToggle={onToggleMainline}
          >
            <span className={styles.legendMainlineSwatch} />
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
