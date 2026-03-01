import { Avatar, Block, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { ClockIcon } from 'lucide-react';
import qs from 'query-string';
import React, { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import urlJoin from 'url-join';

import PublishedTime from '@/components/PublishedTime';
import { useQuery } from '@/hooks/useQuery';
import { discoverService } from '@/services/discover';
import { type AssistantMarketSource, type DiscoverAssistantItem } from '@/types/discover';

import TokenTag from './TokenTag';

const styles = createStaticStyles(({ css, cssVar }) => {
  return {
    author: css`
      cursor: pointer;
      color: ${cssVar.colorTextDescription};

      &:hover {
        color: ${cssVar.colorPrimary};
      }
    `,
    code: css`
      font-family: ${cssVar.fontFamilyCode};
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
  };
});

const AssistantItem = memo<DiscoverAssistantItem>(
  ({
    createdAt,
    updatedAt,
    author,
    avatar,
    title,
    description,
    category,
    identifier,
    tokenUsage,
    pluginCount,
    knowledgeCount,
    forkCount,
    backgroundColor,
    userName,
    type,
  }) => {
    const navigate = useNavigate();
    const { source } = useQuery() as { source?: AssistantMarketSource };
    const isGroupAgent = type === 'agent-group';
    const basePath = isGroupAgent ? '/community/group_agent' : '/community/agent';
    const link = qs.stringifyUrl(
      {
        query: { source },
        url: urlJoin(basePath, identifier),
      },
      { skipNull: true },
    );

    const { t } = useTranslation('discover');

    const handleAuthorClick = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation();
        // Use userName for navigation if available, otherwise don't navigate
        if (userName) {
          navigate(`/community/user/${userName}`);
        }
      },
      [userName, navigate],
    );

    const handleClick = useCallback(() => {
      discoverService
        .reportAgentEvent({
          event: 'click',
          identifier,
          source: location.pathname,
        })
        .catch(() => {});

      navigate(link);
    }, [identifier, link, navigate]);

    return (
      <Block
        clickable
        data-testid="assistant-item"
        height={'100%'}
        variant={'outlined'}
        width={'100%'}
        style={{
          overflow: 'hidden',
          position: 'relative',
        }}
        onClick={handleClick}
      >
        {isGroupAgent && (
          <Tag
            color="info"
            style={{
              position: 'absolute',
              right: 12,
              top: 12,
              zIndex: 1,
            }}
          >
            {t('groupAgents.tag', { defaultValue: '群组' })}
          </Tag>
        )}
        <Flexbox
          horizontal
          align={'flex-start'}
          gap={16}
          justify={'space-between'}
          padding={16}
          style={{ paddingRight: isGroupAgent ? 80 : 16 }}
          width={'100%'}
        >
          <Flexbox
            horizontal
            gap={12}
            title={identifier}
            style={{
              overflow: 'hidden',
            }}
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
              <Flexbox
                horizontal
                align={'center'}
                flex={1}
                gap={8}
                style={{
                  overflow: 'hidden',
                }}
              >
                <Link style={{ color: 'inherit', overflow: 'hidden' }} to={link}>
                  <Text ellipsis as={'h2'} className={styles.title}>
                    {title}
                  </Text>
                </Link>
              </Flexbox>
              {author && (
                <div
                  className={userName ? styles.author : undefined}
                  style={userName ? undefined : { color: 'inherit' }}
                  onClick={userName ? handleAuthorClick : undefined}
                >
                  {author}
                </div>
              )}
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
          <TokenTag
            forkCount={forkCount}
            knowledgeCount={knowledgeCount}
            pluginCount={pluginCount}
            tokenUsage={tokenUsage}
          />
        </Flexbox>
        <Flexbox
          horizontal
          align={'center'}
          className={styles.footer}
          justify={'space-between'}
          padding={16}
        >
          <Flexbox
            horizontal
            align={'center'}
            className={styles.secondaryDesc}
            justify={'space-between'}
          >
            <Flexbox horizontal align={'center'} gap={4}>
              <Icon icon={ClockIcon} size={14} />
              <PublishedTime
                className={styles.secondaryDesc}
                date={updatedAt || createdAt}
                template={'MMM DD, YYYY'}
              />
            </Flexbox>
            {t(`category.assistant.${category}` as any)}
          </Flexbox>
        </Flexbox>
      </Block>
    );
  },
);

export default AssistantItem;
