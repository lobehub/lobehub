import { Button, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Handle, type NodeProps, Position } from '@xyflow/react';
import { ChevronDown, FlaskConical } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { KIND_ICON } from '../shared';
import { experimentStatusVisual } from './experimentStatus';
import type { GraphNodeData } from './GraphNode';

export interface ExperimentGroupData extends GraphNodeData {
  onEnter: () => void;
  onInspect: () => void;
  onToggle: () => void;
}

const styles = stylex.create({
  frame: {
    boxSizing: 'border-box',
    width: '100%',
    height: '100%',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorder,
    borderRadius: '12px',
    backgroundColor: `color-mix(in srgb, ${cssVar.colorInfo} 3%, transparent)`,
    backgroundImage: 'none',
  },
  header: {
    paddingBlock: '12px',
    paddingInline: '16px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
    borderTopLeftRadius: '12px',
    borderTopRightRadius: '12px',
    borderBottomRightRadius: '0',
    borderBottomLeftRadius: '0',
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  title: { overflow: 'hidden', minWidth: '0', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
});

/** An expanded container encloses its work without replacing the surrounding map. */
const ExperimentGroup = ({ data }: NodeProps) => {
  const { containerStatus, view, memberCount, onToggle, onInspect, onEnter, kind } =
    data as ExperimentGroupData;
  const { t } = useTranslation('chat');
  const nodeStatus = containerStatus ?? view.node.status;
  const status = experimentStatusVisual(nodeStatus);
  // A batch folds like an experiment but is not one: it wears its own icon and
  // the batch label, so the two containers never read as the same thing.
  const isBatch = kind === 'batch';
  const ContainerIcon = KIND_ICON[kind ?? view.node.kind] ?? FlaskConical;
  return (
    <div {...stylex.props(styles.frame)}>
      <Handle position={Position.Top} type={'target'} />
      <Flexbox
        horizontal
        align={'center'}
        className={stylex.props(styles.header).className}
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
          <Icon icon={ContainerIcon} size={14} />
          <span {...stylex.props(styles.title)}>
            {isBatch
              ? `${t('goalProcess.kind.batch')} · ${view.node.title}`
              : `${t('goalExperiment.number', { number: view.seq })} · ${view.node.title}`}
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
            {t(`goalExperiment.status.${nodeStatus}`)}
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
