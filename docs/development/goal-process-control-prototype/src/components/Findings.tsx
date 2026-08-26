import { Button, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { ChevronRight, ExternalLink, Lightbulb } from 'lucide-react';
import { memo, useState } from 'react';

import { ago, clock, short } from '../model/format';
import type { GoalState } from '../types';
import { KindDot, useSharedStyles } from './shared';

// What the system currently believes. Borderless rows; clicking one expands its evidence in place
// (source task · attempt · open run), instead of opening the side panel.

const useStyles = createStyles(({ css, token }) => ({
  row: css`
    cursor: pointer;
    padding-block: 8px;
    padding-inline: 8px;
    border-radius: ${token.borderRadiusSM}px;

    &:hover {
      background: ${token.colorFillQuaternary};
    }
  `,
  arrow: css`
    flex: none;
    color: ${token.colorTextQuaternary};
    transition: transform 0.2s;
  `,
  arrowOpen: css`
    transform: rotate(90deg);
  `,
  body: css`
    padding-block: 0 10px;
    padding-inline: 30px 8px;
  `,
}));

export const Findings = memo<{
  state: GoalState;
  hotId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
}>(({ state, hotId, onHover, onSelect }) => {
  const { styles, cx } = useStyles();
  const { styles: shared } = useSharedStyles();
  const [openId, setOpenId] = useState<string | null>(null);
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
    <Flexbox gap={0}>
      {findings.map((f) => {
        const open = openId === f.id;
        const producer = state.nodes.find((n) => n.id === f.from);
        const attempt = producer?.attempts?.find((a) => a.outcome === 'passed');
        return (
          <Flexbox key={f.id} gap={0}>
            <Flexbox
              horizontal
              gap={8}
              align="center"
              className={styles.row}
              onClick={() => setOpenId(open ? null : f.id)}
              onMouseEnter={() => onHover(f.id)}
              onMouseLeave={() => onHover(null)}
            >
              <Icon
                icon={ChevronRight}
                size={14}
                className={cx(styles.arrow, open && styles.arrowOpen)}
              />
              <KindDot kind="finding" />
              <Text weight={500} ellipsis style={{ flexShrink: 1, minWidth: 0 }}>
                {f.title}
              </Text>
              <Text
                fontSize={12}
                className={shared.muted}
                ellipsis
                style={{ flexShrink: 1, minWidth: 0 }}
              >
                来自「{producer?.title}」
              </Text>
              <Text
                fontSize={12}
                className={cx(shared.muted, shared.mono)}
                style={{ marginLeft: 'auto', flexShrink: 0 }}
              >
                {short(clock.now - (f.at ?? clock.now))}
              </Text>
            </Flexbox>
            {open && (
              <Flexbox className={styles.body} gap={8}>
                {f.body && <Text fontSize={13}>{f.body}</Text>}
                <Flexbox horizontal gap={8} align="center" wrap="wrap">
                  {attempt && (
                    <>
                      <Text fontSize={12} type="secondary">
                        第 {attempt.n} 次尝试 · {attempt.taskId} · {ago(clock.now - attempt.ended)}
                      </Text>
                      <Button type="text" size="small" icon={<Icon icon={ExternalLink} />}>
                        打开这次运行
                      </Button>
                      <Tag size="small">证据版本 #1</Tag>
                    </>
                  )}
                  <Button
                    size="small"
                    type="text"
                    icon={<Icon icon={Lightbulb} />}
                    onClick={() => onSelect(f.id)}
                  >
                    基于这个结论开一条任务
                  </Button>
                </Flexbox>
              </Flexbox>
            )}
          </Flexbox>
        );
      })}
    </Flexbox>
  );
});
