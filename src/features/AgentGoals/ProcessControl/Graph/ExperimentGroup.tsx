import { Flexbox, Icon } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import { Handle, type NodeProps, Position } from '@xyflow/react';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronDown, FlaskConical } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { experimentStatusVisual } from './experimentStatus';
import type { GraphNodeData } from './GraphNode';

export interface ExperimentGroupData extends GraphNodeData {
  onEnter: () => void;
  onInspect: () => void;
  onToggle: () => void;
}

const styles = createStaticStyles(({ css }) => ({
  frame: css`
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: 12px;

    background: color-mix(in srgb, ${cssVar.colorInfo} 3%, transparent);
  `,
  header: css`
    padding-block: 12px;
    padding-inline: 16px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 12px 12px 0 0;

    background: ${cssVar.colorBgContainer};
  `,
  title: css`
    overflow: hidden;
    min-width: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

/** An expanded answer encloses its work without replacing the surrounding map. */
const ExperimentGroup = ({ data }: NodeProps) => {
  const { view, memberCount, onToggle, onInspect, onEnter } = data as ExperimentGroupData;
  const { t } = useTranslation('chat');
  const status = experimentStatusVisual(view.node.status);
  return (
    <div className={styles.frame}>
      <Handle position={Position.Top} type={'target'} />
      <Flexbox
        horizontal
        align={'center'}
        className={styles.header}
        gap={12}
        justify={'space-between'}
      >
        <Button
          aria-expanded
          aria-label={t('goalExperiment.collapseNamed', { title: view.node.title })}
          className={'nodrag'}
          size={'small'}
          style={{ minWidth: 0 }}
          title={view.node.title}
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
        >
          <Icon icon={ChevronDown} size={14} />
          <Icon icon={FlaskConical} size={14} />
          <span className={styles.title}>
            {t('goalExperiment.number', { number: view.seq })} · {view.node.title}
          </span>
        </Button>
        <Flexbox horizontal gap={4} style={{ flexShrink: 0 }}>
          <Button
            className={'nodrag'}
            size={'small'}
            onClick={(event) => {
              event.stopPropagation();
              onInspect();
            }}
          >
            {t('goalExperiment.inspect')}
          </Button>
          <Button
            aria-label={t('goalExperiment.drillNamed', { title: view.node.title })}
            className={'nodrag'}
            size={'small'}
            onClick={(event) => {
              event.stopPropagation();
              onEnter();
            }}
          >
            {t('goalExperiment.drill')}
          </Button>
        </Flexbox>
      </Flexbox>
      <Flexbox horizontal gap={12} paddingBlock={6} paddingInline={16}>
        <Flexbox horizontal align={'center'} gap={5}>
          <Icon color={status.color} icon={status.icon} size={13} />
          <Text fontSize={12} style={{ color: status.color }}>
            {t(`goalExperiment.status.${view.node.status}`)}
          </Text>
        </Flexbox>
        <Text fontSize={12} type={'secondary'}>
          {t('goalExperiment.members', { count: memberCount ?? 0 })}
        </Text>
      </Flexbox>
      <Handle position={Position.Bottom} type={'source'} />
    </div>
  );
};

export default ExperimentGroup;
