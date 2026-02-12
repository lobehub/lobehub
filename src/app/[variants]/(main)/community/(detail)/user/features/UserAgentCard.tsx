'use client';

import {
  Avatar,
  Block,
  DropdownMenu,
  Flexbox,
  Icon,
  Tag as AntTag,
  Tag,
  Text,
  Tooltip,
  TooltipGroup,
  stopPropagation,
} from '@lobehub/ui';
import { App } from 'antd';
import { createStaticStyles, cx } from 'antd-style';
import {
  AlertTriangle,
  ClockIcon,
  CoinsIcon,
  ExternalLink,
  Eye,
  EyeOff,
  GitForkIcon,
  MoreVerticalIcon,
  Pencil,
} from 'lucide-react';
import qs from 'query-string';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import urlJoin from 'url-join';

import PublishedTime from '@/components/PublishedTime';
import { agentService } from '@/services/agent';
import { discoverService } from '@/services/discover';
import { useAgentStore } from '@/store/agent';
import { useHomeStore } from '@/store/home';
import { type AgentStatus, type DiscoverAssistantItem } from '@/types/discover';
import { formatIntergerNumber } from '@/utils/format';

import { useUserDetailContext } from './DetailProvider';

const getStatusTagColor = (status?: AgentStatus) => {
  switch (status) {
    case 'published': {
      return 'green';
    }
    case 'unpublished': {
      return 'orange';
    }
    case 'deprecated': {
      return 'red';
    }
    case 'archived': {
      return 'default';
    }
    default: {
      return 'default';
    }
  }
};

const styles = createStaticStyles(({ css, cssVar }) => {
  return {
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
    moreButton: css`
      position: absolute;
      z-index: 10;
      inset-block-start: 12px;
      inset-inline-end: 12px;

      opacity: 0;

      transition: opacity 0.2s;
    `,
    secondaryDesc: css`
      font-size: 12px;
      color: ${cssVar.colorTextDescription};
    `,
    statTag: css`
      border-radius: 4px;

      font-family: ${cssVar.fontFamilyCode};
      font-size: 11px;
      color: ${cssVar.colorTextSecondary};

      background: ${cssVar.colorFillTertiary};
    `,
    title: css`
      margin: 0 !important;
      font-size: 16px !important;
      font-weight: 500 !important;

      &:hover {
        color: ${cssVar.colorLink};
      }
    `,
    wrapper: css`
      &:hover .more-button {
        opacity: 1;
      }
    `,
  };
});

type UserAgentCardProps = DiscoverAssistantItem;

const UserAgentCard = memo<UserAgentCardProps>(
  ({
    avatar,
    backgroundColor,
    title,
    description,
    createdAt,
    category,
    tokenUsage,
    forkCount,
    status,
    identifier,
    isValidated,
  }) => {
    const { t } = useTranslation(['discover', 'setting']);
    const navigate = useNavigate();
    const { message } = App.useApp();
    const { isOwner, onStatusChange } = useUserDetailContext();

    const [, setIsEditLoading] = useState(false);
    const createAgent = useAgentStore((s) => s.createAgent);
    const refreshAgentList = useHomeStore((s) => s.refreshAgentList);

    const link = qs.stringifyUrl(
      {
        query: { source: 'new' },
        url: urlJoin('/community/agent', identifier),
      },
      { skipNull: true },
    );

    const isPublished = status === 'published';

    const handleViewDetail = useCallback(() => {
      window.open(urlJoin('/community/agent', identifier), '_blank');
    }, [identifier]);

    const handleEdit = useCallback(async () => {
      setIsEditLoading(true);
      try {
        // First, try to find the local agent by market identifier
        const localAgentId = await agentService.getAgentByMarketIdentifier(identifier);

        if (localAgentId) {
          // Agent exists locally, navigate to edit
          navigate(urlJoin('/agent', localAgentId, 'profile'));
        } else {
          // Agent doesn't exist locally, fetch from market and create
          const marketAgent = await discoverService.getAssistantDetail({
            identifier,
            source: 'new',
          });

          if (!marketAgent) {
            message.error(t('setting:myAgents.errors.fetchFailed'));
            return;
          }

          // Create local agent with market data
          const result = await createAgent({
            config: {
              ...marketAgent.config,
              avatar: marketAgent.avatar,
              backgroundColor: marketAgent.backgroundColor,
              description: marketAgent.description,
              editorData: marketAgent.editorData,
              marketIdentifier: identifier,
              tags: marketAgent.tags,
              title: marketAgent.title,
            },
          });

          await refreshAgentList();

          if (result.agentId) {
            navigate(urlJoin('/agent', result.agentId, 'profile'));
          }
        }
      } catch (error) {
        console.error('[UserAgentCard] handleEdit error:', error);
        message.error(t('setting:myAgents.errors.editFailed'));
      } finally {
        setIsEditLoading(false);
      }
    }, [identifier, navigate, createAgent, refreshAgentList, message, t]);

    const handleStatusAction = useCallback(
      (action: 'publish' | 'unpublish' | 'deprecate') => {
        onStatusChange?.(identifier, action);
      },
      [identifier, onStatusChange],
    );

    const menuItems = isOwner
      ? [
          {
            icon: <Icon icon={ExternalLink} />,
            key: 'viewDetail',
            label: t('setting:myAgents.actions.viewDetail'),
            onClick: handleViewDetail,
          },
          {
            icon: <Icon icon={Pencil} />,
            key: 'edit',
            label: t('setting:myAgents.actions.edit'),
            onClick: handleEdit,
          },
          {
            type: 'divider' as const,
          },
          {
            icon: <Icon icon={isPublished ? EyeOff : Eye} />,
            key: 'togglePublish',
            label: isPublished
              ? t('setting:myAgents.actions.unpublish')
              : t('setting:myAgents.actions.publish'),
            onClick: () => handleStatusAction(isPublished ? 'unpublish' : 'publish'),
          },
          {
            danger: true,
            icon: <Icon icon={AlertTriangle} />,
            key: 'deprecate',
            label: t('setting:myAgents.actions.deprecate'),
            onClick: () => handleStatusAction('deprecate'),
          },
        ]
      : [];

    return (
      <Block
        clickable
        className={styles.wrapper}
        height={'100%'}
        variant={'outlined'}
        width={'100%'}
        style={{
          cursor: 'pointer',
          overflow: 'hidden',
          position: 'relative',
        }}
        onClick={() => navigate(link)}
      >
        {isOwner && (
          <div onClick={stopPropagation}>
            <DropdownMenu items={menuItems as any}>
              <div className={cx('more-button', styles.moreButton)}>
                <Icon icon={MoreVerticalIcon} size={16} style={{ cursor: 'pointer' }} />
              </div>
            </DropdownMenu>
          </div>
        )}
        <Flexbox
          horizontal
          align={'flex-start'}
          gap={16}
          justify={'space-between'}
          padding={16}
          width={'100%'}
        >
          <Flexbox
            horizontal
            gap={12}
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
              <Flexbox horizontal align={'center'} gap={8}>
                <Link
                  style={{ color: 'inherit', flex: 1, overflow: 'hidden' }}
                  to={link}
                  onClick={(e) => e.stopPropagation()}
                >
                  <Text ellipsis as={'h3'} className={styles.title} style={{ flex: 1 }}>
                    {title}
                  </Text>
                </Link>
                {isValidated === false ? (
                  <AntTag color="orange" style={{ flexShrink: 0, margin: 0 }}>
                    {t('assistant.underReview', { defaultValue: 'Under Review' })}
                  </AntTag>
                ) : (
                  isOwner &&
                  status && (
                    <AntTag color={getStatusTagColor(status)} style={{ flexShrink: 0, margin: 0 }}>
                      {t(`setting:myAgents.status.${status}`)}
                    </AntTag>
                  )
                )}
              </Flexbox>
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
          <TooltipGroup>
            <Flexbox horizontal align={'center'} gap={4}>
              <Tooltip
                placement={'top'}
                styles={{ root: { pointerEvents: 'none' } }}
                title={t('assistants.tokenUsage')}
              >
                <Tag className={styles.statTag} icon={<Icon icon={CoinsIcon} />}>
                  {formatIntergerNumber(tokenUsage)}
                </Tag>
              </Tooltip>
              {Boolean(forkCount && forkCount > 0) && (
                <Tooltip
                  placement={'top'}
                  styles={{ root: { pointerEvents: 'none' } }}
                  title={t('fork.forksCount', { count: forkCount })}
                >
                  <Tag className={styles.statTag} icon={<Icon icon={GitForkIcon} />}>
                    {formatIntergerNumber(forkCount)}
                  </Tag>
                </Tooltip>
              )}
            </Flexbox>
          </TooltipGroup>
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
                date={createdAt}
                template={'MMM DD, YYYY'}
              />
            </Flexbox>
            {category && t(`category.assistant.${category}` as any)}
          </Flexbox>
        </Flexbox>
      </Block>
    );
  },
);

export default UserAgentCard;
