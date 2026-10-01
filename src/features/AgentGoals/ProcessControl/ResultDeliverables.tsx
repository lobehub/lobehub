'use client';

import { Center, Flexbox, Icon, Markdown } from '@lobehub/ui';
import { ActionIcon, Button, Input, Segmented, Skeleton, Tag, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ArrowRight, PackageOpen, SearchIcon, SearchX, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useEntityMarkdown } from '@/features/EntityLink';
import { useActivityTime } from '@/hooks/useActivityTime';
import { useClientDataSWR } from '@/libs/swr';
import { portalKeys } from '@/libs/swr/keys';
import { documentService } from '@/services/document';

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
import { CitationMark, deliverableIconOf, deliverableTitleOf } from './deliverableVisuals';
import type { GoalGraphView } from './goalGraphViewModel';
import { SectionTitle } from './GoalResultFollowUps';
import type { CriterionOutcome } from './goalResultState';

/**
 * 交付物 on the 结果交付 tab — everything the Goal persisted, in one place.
 *
 * The main deliverable (the document the work wrote) leads as a card with the
 * start of its text; every other artifact is a row naming the task that
 * produced it, when, and whether acceptance evidence cites it. A long list
 * grows the tools a long list needs — grouping by task, a type filter and
 * search — and a short one stays a plain list. Any row, or 逐一查看, opens the
 * full-screen reader to page through them in order.
 */

const styles = createStaticStyles(({ css }) => ({
  card: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgContainer};
  `,
  excerpt: css`
    pointer-events: none;
    overflow: hidden;
    max-height: 148px;

    mask-image: linear-gradient(to bottom, #000 55%, transparent);
  `,
  groupTitle: css`
    padding-block: 12px 4px;
    padding-inline: 12px;
  `,
  primary: css`
    cursor: pointer;

    display: flex;
    flex-direction: column;
    gap: 12px;

    width: 100%;
    padding: 16px;
    border: none;

    text-align: start;

    background: none;

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: -2px;
    }
  `,
  row: css`
    cursor: pointer;

    display: flex;
    gap: 12px;
    align-items: center;

    width: 100%;
    padding-block: 10px;
    padding-inline: 12px;
    border: none;

    text-align: start;

    background: none;

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
  return (
    <button
      className={styles.row}
      data-testid={'goal-deliverable-row'}
      type={'button'}
      onClick={onOpen}
    >
      <Icon color={cssVar.colorTextSecondary} icon={deliverableIconOf(item.artifact)} size={18} />
      <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
        <Text ellipsis weight={500}>
          {deliverableTitleOf(item.artifact, t('goalProcess.deliverables.untitled'))}
        </Text>
        <ProducerAndTime item={item} />
      </Flexbox>
      <CitationMark item={item} />
    </button>
  );
};

const PrimaryExcerpt = ({ documentId }: { documentId: string }) => {
  // The card is a preview, not a reader: `aria-hidden` rows keep the inline
  // entity chips (no raw URLs) but take no click of their own.
  const markdownProps = useEntityMarkdown();
  const { data: document, isLoading } = useClientDataSWR(
    portalKeys.documentHeader(documentId),
    () => documentService.getDocumentById(documentId),
  );
  if (isLoading)
    return (
      <Flexbox gap={8}>
        <Skeleton height={14} radius={4} />
        <Skeleton height={14} radius={4} width={'80%'} />
        <Skeleton height={14} radius={4} width={'60%'} />
      </Flexbox>
    );
  // The card already names the document; its own leading H1 would repeat it.
  const excerpt = document?.content?.replace(/^\s*#\s[^\n]*\n+/, '');
  if (!excerpt) return null;
  return (
    <div aria-hidden className={styles.excerpt}>
      <Markdown fontSize={13} variant={'chat'} {...markdownProps}>
        {excerpt}
      </Markdown>
    </div>
  );
};

const PrimaryCard = ({
  item,
  loading,
  onOpen,
}: {
  item: DeliverableItem;
  loading: boolean;
  onOpen: () => void;
}) => {
  const { t } = useTranslation('chat');
  const { text, title } = useActivityTime(item.artifact.createdAt);
  return (
    <div className={styles.card}>
      <button
        className={styles.primary}
        data-testid={'goal-deliverable-primary'}
        type={'button'}
        onClick={onOpen}
      >
        <Flexbox horizontal align={'center'} gap={8}>
          <Tag color={'blue'}>{t('goalProcess.result.deliverables.primary')}</Tag>
          <Text ellipsis fontSize={15} weight={600}>
            {deliverableTitleOf(item.artifact, t('goalProcess.deliverables.untitled'))}
          </Text>
        </Flexbox>
        {item.artifact.resourceId && <PrimaryExcerpt documentId={item.artifact.resourceId} />}
        <Text fontSize={12} title={title} type={'secondary'}>
          {[
            item.producerTitle &&
              t('goalProcess.result.deliverables.producedBy', { title: item.producerTitle }),
            text,
            loading
              ? undefined
              : item.citedBy.length > 0
                ? t('goalProcess.result.deliverables.citedCount', { count: item.citedBy.length })
                : t('goalProcess.result.deliverables.uncited'),
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </button>
    </div>
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

  const items = useMemo(
    () =>
      buildDeliverables({
        artifacts: graph.artifacts,
        outcomes,
        primaryResourceId,
        titleOf: (nodeId) => graph.byId[nodeId]?.node.title,
      }),
    [graph.artifacts, graph.byId, outcomes, primaryResourceId],
  );

  const primary = items[0]?.primary ? items[0] : undefined;
  const rest = primary ? items.slice(1) : items;
  const many = rest.length >= MANY_DELIVERABLES;
  const visible = many ? filterDeliverables(rest, { query, type }) : rest;
  const groups = many ? groupDeliverables(visible) : [{ items: visible }];
  const counts = deliverableTypeCounts(rest);
  const open = (item: DeliverableItem) => setReaderIndex(items.indexOf(item));

  const title = (
    <SectionTitle
      extra={
        items.length > 0 && (
          <Button icon={ArrowRight} size={'small'} onClick={() => setReaderIndex(0)}>
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
      {primary && <PrimaryCard item={primary} loading={loading} onOpen={() => open(primary)} />}
      {many && (
        <Flexbox horizontal align={'center'} gap={12} wrap={'wrap'}>
          <Segmented
            size={'small'}
            value={type}
            options={[
              {
                label: `${t('goalProcess.result.deliverables.filter.all')} ${rest.length}`,
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
        rest.length > 0 && (
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
        )
      ) : (
        rest.length > 0 && (
          <Flexbox className={styles.card} paddingBlock={4}>
            {groups.map((group) => (
              <Flexbox key={group.nodeId ?? 'rest'}>
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
                    onOpen={() => open(item)}
                  />
                ))}
              </Flexbox>
            ))}
          </Flexbox>
        )
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
