'use client';

import { Center, Flexbox, Icon } from '@lobehub/ui';
import { ActionIcon, Button, Input, Segmented, Skeleton, Tag, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { ArrowRight, PackageOpen, SearchIcon, SearchX, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActivityTime } from '@/hooks/useActivityTime';

import { coordinatorNodeTitleKey } from './coordinatorCopy';
import {
  buildDeliverables,
  type DeliverableItem,
  type DeliverableType,
  deliverableTypeCounts,
  filterDeliverables,
  groupDeliverables,
  MANY_DELIVERABLES,
} from './deliverableList';
import DeliverableReader from './DeliverableReader';
import { openTargetOf, useOpenGoalArtifact } from './Deliverables';
import { CitationMark, deliverableIconOf, deliverableTitleOf } from './deliverableVisuals';
import type { GoalGraphView } from './goalGraphViewModel';
import { SectionTitle } from './GoalResultFollowUps';
import type { CriterionOutcome } from './goalResultState';
import { anchorProps } from './resultAnchors';

/**
 * 交付物 on the 结果交付 tab — everything the Goal persisted, in one place.
 *
 * One row per artifact, naming the task that produced it, when, and whether
 * acceptance evidence cites it; the main deliverable leads, tagged, and every
 * other one follows. The main deliverable's own text is not previewed here:
 * it is the document 交付文档 reads in full further down the page. A long list
 * grows the tools a long list needs — grouping by task, a type filter and
 * search — and a short one stays a plain list. A row opens where the artifact
 * lives: a document in the side panel, a file or link at its own target.
 */

const styles = createStaticStyles(({ css }) => ({
  card: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgContainer};
  `,
  groupTitle: css`
    padding-block: 12px 4px;
    padding-inline: 12px;
  `,
  row: css`
    display: flex;
    gap: 12px;
    align-items: center;

    width: 100%;
    padding-block: 10px;
    padding-inline: 12px;
    border: none;

    text-align: start;

    background: none;
  `,
  rowOpenable: css`
    cursor: pointer;

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: -2px;
    }
  `,
}));

const ProducerAndTime = ({ item }: { item: DeliverableItem }) => {
  const { t } = useTranslation('chat');
  const { text, title } = useActivityTime(item.artifact.createdAt);
  return (
    <Text ellipsis fontSize={12} title={title} type={'secondary'}>
      {[
        item.producerTitle &&
          t('goalProcess.result.deliverables.producedBy', { title: item.producerTitle }),
        text,
      ]
        .filter(Boolean)
        .join(' · ')}
    </Text>
  );
};

const DeliverableRow = ({ item, onOpen }: { item: DeliverableItem; onOpen: () => void }) => {
  const { t } = useTranslation('chat');
  // A row that goes nowhere stays inert rather than faking an affordance it
  // cannot honour — see `openTargetOf`.
  const openable = !!openTargetOf(item.artifact);

  return (
    <Flexbox
      horizontal
      align={'center'}
      as={openable ? 'button' : 'div'}
      className={cx(styles.row, openable && styles.rowOpenable)}
      data-testid={'goal-deliverable-row'}
      gap={12}
      {...(openable ? { onClick: onOpen, type: 'button' as const } : {})}
    >
      <Icon color={cssVar.colorTextSecondary} icon={deliverableIconOf(item.artifact)} size={18} />
      <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
        <Flexbox horizontal align={'center'} gap={8}>
          <Text ellipsis weight={500}>
            {deliverableTitleOf(item.artifact, t('goalProcess.deliverables.untitled'))}
          </Text>
          {item.primary && (
            <Tag color={'blue'} size={'small'}>
              {t('goalProcess.result.deliverables.primary')}
            </Tag>
          )}
        </Flexbox>
        <ProducerAndTime item={item} />
      </Flexbox>
      <CitationMark item={item} />
    </Flexbox>
  );
};

const LoadingRows = () => (
  <Flexbox className={styles.card} data-testid={'goal-deliverables-loading'} gap={14} padding={16}>
    {[0, 1, 2].map((key) => (
      <Flexbox horizontal align={'center'} gap={12} key={key}>
        <Skeleton height={18} radius={4} width={18} />
        <Flexbox flex={1} gap={6}>
          <Skeleton height={14} radius={4} width={'45%'} />
          <Skeleton height={12} radius={4} width={'30%'} />
        </Flexbox>
      </Flexbox>
    ))}
  </Flexbox>
);

const EmptyState = () => {
  const { t } = useTranslation('chat');
  return (
    <Center className={styles.card} data-testid={'goal-deliverables-empty'} gap={8} padding={32}>
      <Icon color={cssVar.colorTextQuaternary} icon={PackageOpen} size={28} />
      <Text weight={600}>{t('goalProcess.result.deliverables.empty.title')}</Text>
      <Text align={'center'} fontSize={13} style={{ maxWidth: 420 }} type={'secondary'}>
        {t('goalProcess.result.deliverables.empty.description')}
      </Text>
    </Center>
  );
};

const TYPE_ORDER = ['document', 'file', 'external'] as const;

interface ResultDeliverablesProps {
  graph: GoalGraphView;
  /** Citation marks read the acceptance bundle; until it lands they are unknown. */
  loading: boolean;
  outcomes: CriterionOutcome[];
  primaryResourceId?: string;
}

const ResultDeliverables = ({
  graph,
  loading,
  outcomes,
  primaryResourceId,
}: ResultDeliverablesProps) => {
  const { t } = useTranslation('chat');
  const [readerIndex, setReaderIndex] = useState<number>();
  const [type, setType] = useState<DeliverableType | 'all'>('all');
  const [query, setQuery] = useState('');
  const open = useOpenGoalArtifact();

  const items = useMemo(
    () =>
      buildDeliverables({
        artifacts: graph.artifacts,
        outcomes,
        primaryResourceId,
        // The coordinator's own nodes carry fixed English titles (the terminal
        // acceptance Task among them); name them as the rest of the goal view
        // does, since these titles also label the rail's group ticks.
        titleOf: (nodeId) => {
          const view = graph.byId[nodeId];
          if (!view) return undefined;
          const key = coordinatorNodeTitleKey(view);
          return key ? t(key as any) : view.node.title;
        },
      }),
    [graph.artifacts, graph.byId, outcomes, primaryResourceId, t],
  );

  const many = items.length >= MANY_DELIVERABLES;
  const visible = many ? filterDeliverables(items, { query, type }) : items;
  const groups = many ? groupDeliverables(visible) : [{ items: visible }];
  const counts = deliverableTypeCounts(items);

  const title = (
    <SectionTitle
      extra={
        items.length > 0 && (
          <Button icon={ArrowRight} size={'small'} type={'text'} onClick={() => setReaderIndex(0)}>
            {t('goalProcess.result.deliverables.viewAll', { count: items.length })}
          </Button>
        )
      }
    >
      {items.length > 0
        ? t('goalProcess.result.deliverables.titleWithCount', { count: items.length })
        : t('goalProcess.deliverables.title')}
    </SectionTitle>
  );

  if (items.length === 0)
    return (
      <Flexbox gap={12}>
        {title}
        <EmptyState />
      </Flexbox>
    );

  return (
    <Flexbox data-testid={'goal-result-deliverables'} gap={12}>
      {title}
      {many && (
        <Flexbox horizontal align={'center'} gap={12} wrap={'wrap'}>
          <Segmented
            size={'small'}
            value={type}
            options={[
              {
                label: `${t('goalProcess.result.deliverables.filter.all')} ${items.length}`,
                value: 'all',
              },
              ...TYPE_ORDER.filter((key) => counts.has(key)).map((key) => ({
                label: `${t(`goalProcess.result.deliverables.filter.${key}` as const)} ${counts.get(key)}`,
                value: key,
              })),
            ]}
            onChange={(value) => setType(value as DeliverableType | 'all')}
          />
          <Input
            aria-label={t('goalProcess.result.deliverables.search')}
            data-testid={'goal-deliverables-search'}
            placeholder={t('goalProcess.result.deliverables.search')}
            prefix={<Icon icon={SearchIcon} size={14} />}
            size={'small'}
            style={{ width: 240 }}
            value={query}
            suffix={
              query && (
                <ActionIcon
                  icon={X}
                  size={'small'}
                  title={t('goalProcess.result.deliverables.clearFilter')}
                  onClick={() => setQuery('')}
                />
              )
            }
            onChange={(event) => setQuery(event.target.value)}
          />
        </Flexbox>
      )}
      {loading ? (
        <LoadingRows />
      ) : visible.length === 0 ? (
        <Center
          className={styles.card}
          data-testid={'goal-deliverables-no-match'}
          gap={8}
          padding={24}
        >
          <Icon color={cssVar.colorTextQuaternary} icon={SearchX} size={24} />
          <Text weight={500}>
            {query.trim()
              ? t('goalProcess.result.deliverables.noMatch', { query: query.trim() })
              : t('goalProcess.result.deliverables.noMatchType')}
          </Text>
          <Button
            size={'small'}
            type={'text'}
            onClick={() => {
              setQuery('');
              setType('all');
            }}
          >
            {t('goalProcess.result.deliverables.clearFilter')}
          </Button>
        </Center>
      ) : (
        <Flexbox className={styles.card} paddingBlock={4}>
          {groups.map((group) => (
            <Flexbox
              key={group.nodeId ?? 'rest'}
              {...(groups.length > 1 &&
                anchorProps(
                  `deliverables:${group.nodeId ?? 'rest'}`,
                  group.title ?? t('goalProcess.result.deliverables.otherTasks'),
                  1,
                ))}
            >
              {groups.length > 1 && (
                <Text
                  className={styles.groupTitle}
                  data-testid={'goal-deliverables-group'}
                  fontSize={12}
                  type={'secondary'}
                >
                  {`${group.title ?? t('goalProcess.result.deliverables.otherTasks')} · ${group.items.length}`}
                </Text>
              )}
              {group.items.map((item) => (
                <DeliverableRow
                  item={item}
                  key={item.artifact.workVersionId}
                  onOpen={() => open(item.artifact)}
                />
              ))}
            </Flexbox>
          ))}
        </Flexbox>
      )}
      {readerIndex !== undefined && (
        <DeliverableReader
          index={readerIndex}
          items={items}
          onClose={() => setReaderIndex(undefined)}
          onIndexChange={setReaderIndex}
        />
      )}
    </Flexbox>
  );
};

export default ResultDeliverables;
