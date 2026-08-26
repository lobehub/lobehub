import { Block, Flexbox, Text } from '@lobehub/ui';
import { Divider } from 'antd';
import { createStyles } from 'antd-style';
import { Fragment, memo } from 'react';

import { clock, short } from '../model/format';
import type { GoalState } from '../types';
import { KindDot, useSharedStyles } from './shared';

const useStyles = createStyles(({ css, token }) => ({
  rowHot: css`
    box-shadow: inset 3px 0 0 ${token.colorPrimary};
  `,
}));

/** What the system currently believes — latest Findings, each traceable to the task that produced it. */
export const Findings = memo<{
  state: GoalState;
  hotId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
}>(({ state, hotId, onHover, onSelect }) => {
  const { styles, cx } = useStyles();
  const { styles: shared } = useSharedStyles();
  const findings = state.nodes
    .filter((n) => n.kind === 'finding')
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  if (findings.length === 0)
    return (
      <Text fontSize={13} className={shared.muted}>
        还没有任何结论。
      </Text>
    );
  return (
    <div className={shared.list}>
      <Block variant="borderless" gap={0} padding={2}>
        {findings.map((f, i) => (
          <Fragment key={f.id}>
            {i > 0 && <Divider dashed style={{ margin: 0 }} />}
            <Block
              clickable
              padding={12}
              className={cx(hotId === f.id && styles.rowHot)}
              onMouseEnter={() => onHover(f.id)}
              onMouseLeave={() => onHover(null)}
              onClick={() => onSelect(f.id)}
            >
              <Flexbox horizontal gap={10} align="center">
                <KindDot kind="finding" />
                <Text weight={500} ellipsis style={{ minWidth: 0 }}>
                  {f.title}
                </Text>
                <Text
                  fontSize={12}
                  className={shared.muted}
                  ellipsis
                  style={{ flexShrink: 1, minWidth: 0 }}
                >
                  来自「{state.nodes.find((n) => n.id === f.from)?.title}」
                </Text>
                <Text
                  fontSize={12}
                  className={cx(shared.muted, shared.mono)}
                  style={{ marginLeft: 'auto', flexShrink: 0 }}
                >
                  {short(clock.now - (f.at ?? clock.now))}
                </Text>
              </Flexbox>
            </Block>
          </Fragment>
        ))}
      </Block>
    </div>
  );
});
