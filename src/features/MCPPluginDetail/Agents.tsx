'use client';

import { Avatar, Block, Center, Flexbox, Grid, Icon, Skeleton, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ClockIcon, InboxIcon, ServerCrash } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { VirtuosoGrid } from 'react-virtuoso';

import PublishedTime from '@/components/PublishedTime';
import VirtuosoLoading from '@/features/SkillStore/SkillList/VirtuosoLoading';
import { virtuosoGridStyles } from '@/features/SkillStore/SkillList/style';
import { useClientDataSWR } from '@/libs/swr';
import { discoverService } from '@/services/discover';
import { type DiscoverAssistantItem } from '@/types/discover';

import { useDetailContext } from './DetailProvider';

const PAGE_SIZE = 6;

const styles = createStaticStyles(({ css, cssVar }) => ({
  author: css`
    color: ${cssVar.colorTextDescription};
  `,
  desc: css`
    flex: 1;
    margin: 0 !important;
    color: ${cssVar.colorTextSecondary};
  `,
  footer: css`
    margin-block-start: 16px;
    border-block-start: 1px dashed ${cssVar.colorBorder};
    background: ${cssVar.colorBgContainer};
  `,
  secondaryDesc: css`
    font-size: 12px;
    color: ${cssVar.colorTextDescription};
  `,
  title: css`
    margin: 0 !important;
    font-size: 16px !important;
    font-weight: 500 !important;

    &:hover {
      color: ${cssVar.colorLink};
    }
  `,
}));

const AgentItem = memo<DiscoverAssistantItem>(
  ({ createdAt, author, avatar, title, description, identifier, category, backgroundColor }) => {
    return (
      <a
        href={`/community/agent/${identifier}`}
        rel="noopener noreferrer"
        style={{ display: 'block', height: '100%' }}
        target="_blank"
      >
        <Block
          clickable
          height={'100%'}
          style={{
            overflow: 'hidden',
            position: 'relative',
          }}
          variant={'outlined'}
          width={'100%'}
        >
          <Flexbox
            align={'flex-start'}
            gap={16}
            horizontal
            justify={'space-between'}
            padding={16}
            width={'100%'}
          >
            <Flexbox
              gap={12}
              horizontal
              style={{
                overflow: 'hidden',
              }}
              title={identifier}
            >
              <Avatar
                avatar={avatar}
                background={backgroundColor || 'transparent'}
                shape={'square'}
                size={40}
                style={{ flex: 'none' }}
              />
              <Flexbox
                flex={1}
                gap={2}
                style={{
                  overflow: 'hidden',
                }}
              >
                <Text as={'h2'} className={styles.title} ellipsis>
                  {title}
                </Text>
                {author && <div className={styles.author}>{author}</div>}
              </Flexbox>
            </Flexbox>
          </Flexbox>
          <Flexbox flex={1} gap={12} paddingInline={16}>
            <Text
              as={'p'}
              className={styles.desc}
              ellipsis={{
                rows: 3,
              }}
            >
              {description}
            </Text>
          </Flexbox>
          <Flexbox
            align={'center'}
            className={styles.footer}
            horizontal
            justify={'space-between'}
            padding={16}
          >
            <Flexbox
              align={'center'}
              className={styles.secondaryDesc}
              horizontal
              justify={'space-between'}
            >
              <Flexbox align={'center'} gap={4} horizontal>
                <Icon icon={ClockIcon} size={14} />
                <PublishedTime
                  className={styles.secondaryDesc}
                  date={createdAt}
                  template={'MMM DD, YYYY'}
                />
              </Flexbox>
              {category && <span style={{ marginLeft: 12 }}>{category}</span>}
            </Flexbox>
          </Flexbox>
        </Block>
      </a>
    );
  },
);

interface AgentsProps {
  inModal?: boolean;
}

const Agents = memo<AgentsProps>(({ inModal }) => {
  const { t } = useTranslation('discover');
  const { identifier } = useDetailContext();

  // Local state for pagination
  const [items, setItems] = useState<DiscoverAssistantItem[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [isInitialized, setIsInitialized] = useState(false);
  const prevPageRef = useRef(currentPage);

  // SWR fetch data (lazy loading - only requests when component mounts)
  const { data, isLoading, error } = useClientDataSWR(
    identifier ? ['mcp-agents', identifier, currentPage] : null,
    () =>
      discoverService.getAgentsByPlugin({
        page: currentPage,
        pageSize: PAGE_SIZE,
        pluginId: identifier!,
      }),
  );

  // Data accumulation logic
  useEffect(() => {
    if (data) {
      if (currentPage === 1) {
        setItems(data.items);
      } else if (currentPage > prevPageRef.current) {
        setItems((prev) => [...prev, ...data.items]);
      }
      setTotalCount(data.totalCount);
      setIsInitialized(true);
      prevPageRef.current = currentPage;
    }
  }, [data, currentPage]);

  const hasMore = items.length < totalCount;

  const loadMore = useCallback(() => {
    if (!isLoading && hasMore) {
      setCurrentPage((prev) => prev + 1);
    }
  }, [isLoading, hasMore]);

  // Initial loading state
  if (!isInitialized && isLoading) {
    return (
      <Grid gap={16} rows={2} width={'100%'}>
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton active key={index} paragraph={{ rows: 4 }} />
        ))}
      </Grid>
    );
  }

  // Error state
  if (error) {
    return (
      <Center gap={12} padding={40}>
        <Icon color={cssVar.colorTextDescription} icon={ServerCrash} size={80} />
        <Text type={'secondary'}>{t('mcp.details.agents.networkError')}</Text>
      </Center>
    );
  }

  // Empty state
  if (isInitialized && items.length === 0) {
    return (
      <Center gap={12} padding={40}>
        <Icon color={cssVar.colorTextDescription} icon={InboxIcon} size={80} />
        <Text type={'secondary'}>{t('mcp.details.agents.empty')}</Text>
      </Center>
    );
  }

  // Use VirtuosoGrid for rendering
  return (
    <VirtuosoGrid
      components={{
        Footer: isLoading ? VirtuosoLoading : () => <div style={{ height: 16 }} />,
      }}
      data={items}
      endReached={loadMore}
      increaseViewportBy={typeof window !== 'undefined' ? window.innerHeight : 0}
      itemClassName={virtuosoGridStyles.item}
      itemContent={(_, item) => <AgentItem key={item.identifier} {...item} />}
      listClassName={virtuosoGridStyles.list}
      overscan={24}
      style={inModal ? { height: '50vh', width: '100%' } : { width: '100%' }}
      useWindowScroll={!inModal}
    />
  );
});

export default Agents;
