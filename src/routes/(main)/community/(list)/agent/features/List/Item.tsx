import { Avatar, Block, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ClockIcon } from 'lucide-react';
import qs from 'query-string';
import React, { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import PublishedTime from '@/components/PublishedTime';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useQuery } from '@/hooks/useQuery';
import { resolveCommunityProfileLink } from '@/routes/(main)/community/(detail)/utils/profileLink';
import { discoverService } from '@/services/discover';
import { sx } from '@/styles/sx';
import { type AssistantMarketSource, type DiscoverAssistantItem } from '@/types/discover';

import TokenTag from './TokenTag';

const styles = stylex.create({
  author: {
    cursor: 'pointer',
    color: { 'default': cssVar.colorTextDescription, ':hover': cssVar.colorPrimary },
  },
  desc: { flex: '1', margin: '0', color: cssVar.colorTextSecondary },
  footer: {
    marginBlockStart: '16px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'dashed',
    borderBlockStartColor: cssVar.colorBorder,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  secondaryDesc: { fontSize: '12px', color: cssVar.colorTextDescription },
  title: {
    margin: '0',
    fontSize: '16px',
    fontWeight: 500,
    color: { 'default': null, ':hover': cssVar.colorLink },
  },
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
    ownerType,
    type,
  }) => {
    const navigate = useWorkspaceAwareNavigate();
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
        // Open the public author profile outside the current workspace scope.
        if (userName) {
          window.open(
            resolveCommunityProfileLink(userName, ownerType),
            '_blank',
            'noopener,noreferrer',
          );
        }
      },
      [ownerType, userName],
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
        data-agent-type={type ?? 'agent'}
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
                <WorkspaceLink style={{ color: 'inherit', overflow: 'hidden' }} to={link}>
                  <Text ellipsis as={'h2'} className={stylex.props(styles.title).className}>
                    {title}
                  </Text>
                </WorkspaceLink>
              </Flexbox>
              {author && (
                <div
                  {...sx(
                    !!userName && styles.author,
                    undefined,
                    userName ? undefined : { color: 'inherit' },
                  )}
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
            className={stylex.props(styles.desc).className}
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
          className={stylex.props(styles.footer).className}
          justify={'space-between'}
          padding={16}
        >
          <Flexbox
            horizontal
            align={'center'}
            className={stylex.props(styles.secondaryDesc).className}
            justify={'space-between'}
          >
            <Flexbox horizontal align={'center'} gap={4}>
              <Icon icon={ClockIcon} size={14} />
              <PublishedTime
                className={stylex.props(styles.secondaryDesc).className}
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
