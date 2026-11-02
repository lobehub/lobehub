'use client';

import {
  Avatar,
  Block,
  DropdownMenu,
  Flexbox,
  Icon,
  stopPropagation,
  Tag as AntTag,
  Tag,
  Text,
  toast,
  Tooltip,
  TooltipGroup,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import {
  AlertTriangle,
  ClockIcon,
  CoinsIcon,
  ExternalLink,
  GitForkIcon,
  MoreVerticalIcon,
  Pencil,
} from 'lucide-react';
import qs from 'query-string';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import PublishedTime from '@/components/PublishedTime';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { usePermission } from '@/hooks/usePermission';
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

const styles = stylex.create({
  desc: { flex: '1', margin: '0', color: cssVar.colorTextSecondary },
  footer: {
    marginBlockStart: '16px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'dashed',
    borderBlockStartColor: cssVar.colorBorder,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  moreButton: {
    position: 'absolute',
    zIndex: 10,
    insetBlockStart: '12px',
    insetInlineEnd: '12px',
    opacity: { default: 0, [stylex.when.ancestor(':hover')]: 1 },
    transition: 'opacity 0.2s',
  },
  secondaryDesc: { fontSize: '12px', color: cssVar.colorTextDescription },
  statTag: {
    borderRadius: '4px',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '11px',
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
  title: {
    margin: '0',
    fontSize: '16px',
    fontWeight: 500,
    color: { 'default': null, ':hover': cssVar.colorLink },
  },
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
    const navigate = useWorkspaceAwareNavigate();

    const { isOwner, onStatusChange } = useUserDetailContext();
    const { allowed: canCreate } = usePermission('create_content');
    const { allowed: canEdit } = usePermission('edit_own_content');
    const activeWorkspaceId = useActiveWorkspaceId();

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

    // Under-review agents stay view-only until the agent has been validated.
    const isUnderReview = isValidated === false;

    const handleViewDetail = useCallback(() => {
      window.open(urlJoin('/community/agent', identifier), '_blank');
    }, [identifier]);

    const handleEdit = useCallback(async () => {
      if (!canEdit || !canCreate) return;
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
            toast.error(t('setting:myAgents.errors.fetchFailed'));
            return;
          }

          // Create local agent with market data. In workspace mode default
          // the install to the user's Private bucket so a community card
          // they're just trying out doesn't immediately surface to teammates.
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
            ...(activeWorkspaceId ? { visibility: 'private' as const } : {}),
          });

          await refreshAgentList();

          if (result.agentId) {
            navigate(urlJoin('/agent', result.agentId, 'profile'));
          }
        }
      } catch (error) {
        console.error('[UserAgentCard] handleEdit error:', error);
        toast.error(t('setting:myAgents.errors.editFailed'));
      } finally {
        setIsEditLoading(false);
      }
    }, [canCreate, canEdit, identifier, navigate, createAgent, refreshAgentList, t]);

    const handleStatusAction = useCallback(
      (action: 'deprecate') => {
        if (!canEdit) return;
        onStatusChange?.(identifier, action);
      },
      [canEdit, identifier, onStatusChange],
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
            disabled: !canEdit || !canCreate,
            icon: <Icon icon={Pencil} />,
            key: 'edit',
            label: t('setting:myAgents.actions.edit'),
            onClick: handleEdit,
          },
          {
            type: 'divider' as const,
          },
          {
            danger: true,
            disabled: !canEdit,
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
        className={stylex.props(stylex.defaultMarker()).className}
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
        {isOwner && !isUnderReview && (
          <div onClick={stopPropagation}>
            <DropdownMenu items={menuItems as any}>
              <div {...stylex.props(styles.moreButton)}>
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
                <WorkspaceLink
                  style={{ color: 'inherit', flex: 1, overflow: 'hidden' }}
                  to={link}
                  onClick={(e) => e.stopPropagation()}
                >
                  <Text
                    ellipsis
                    as={'h3'}
                    className={stylex.props(styles.title).className}
                    style={{ flex: 1 }}
                  >
                    {title}
                  </Text>
                </WorkspaceLink>
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
            className={stylex.props(styles.desc).className}
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
                <Tag
                  className={stylex.props(styles.statTag).className}
                  icon={<Icon icon={CoinsIcon} />}
                >
                  {formatIntergerNumber(tokenUsage)}
                </Tag>
              </Tooltip>
              {Boolean(forkCount && forkCount > 0) && (
                <Tooltip
                  placement={'top'}
                  styles={{ root: { pointerEvents: 'none' } }}
                  title={t('fork.forksCount', { count: forkCount })}
                >
                  <Tag
                    className={stylex.props(styles.statTag).className}
                    icon={<Icon icon={GitForkIcon} />}
                  >
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
                date={createdAt}
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
