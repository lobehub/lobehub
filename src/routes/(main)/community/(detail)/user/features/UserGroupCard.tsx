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
  Tooltip,
  TooltipGroup,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import {
  AlertTriangle,
  ClockIcon,
  DownloadIcon,
  GitForkIcon,
  MoreVerticalIcon,
  Pencil,
  UsersIcon,
} from 'lucide-react';
import qs from 'query-string';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import PublishedTime from '@/components/PublishedTime';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { type DiscoverGroupAgentItem, type GroupAgentStatus } from '@/types/discover';
import { formatIntergerNumber } from '@/utils/format';

import { useUserDetailContext } from './DetailProvider';

const getStatusTagColor = (status?: GroupAgentStatus) => {
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

type UserGroupCardProps = DiscoverGroupAgentItem;

const UserGroupCard = memo<UserGroupCardProps>(
  ({
    avatar,
    title,
    description,
    createdAt,
    category,
    forkCount,
    installCount,
    identifier,
    memberCount,
    status,
    isValidated,
  }) => {
    const { t } = useTranslation(['discover', 'setting']);
    const navigate = useWorkspaceAwareNavigate();
    const { isOwner, onStatusChange } = useUserDetailContext();

    const link = qs.stringifyUrl(
      {
        query: { source: 'new' },
        url: urlJoin('/community/group_agent', identifier),
      },
      { skipNull: true },
    );

    // Under-review groups stay view-only until the group has been validated.
    const isUnderReview = isValidated === false;

    const handleCardClick = useCallback(() => {
      navigate(link);
    }, [link, navigate]);

    const handleEdit = useCallback(() => {
      navigate(urlJoin('/group', identifier, 'profile'));
    }, [identifier, navigate]);

    const handleStatusAction = useCallback(
      (action: 'deprecate') => {
        onStatusChange?.(identifier, action, 'group');
      },
      [identifier, onStatusChange],
    );

    const menuItems = isOwner
      ? [
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
        className={stylex.props(stylex.defaultMarker()).className}
        height={'100%'}
        variant={'outlined'}
        width={'100%'}
        style={{
          cursor: 'pointer',
          overflow: 'hidden',
          position: 'relative',
        }}
        onClick={handleCardClick}
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
            <Avatar avatar={avatar} shape={'square'} size={40} style={{ flex: 'none' }} />
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
                  onClick={stopPropagation}
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
                    {t('groupAgents.underReview', { defaultValue: 'Under Review' })}
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
              {memberCount !== undefined && memberCount > 0 && (
                <Tooltip
                  placement={'top'}
                  styles={{ root: { pointerEvents: 'none' } }}
                  title={t('groupAgents.memberCount', { defaultValue: 'Members' })}
                >
                  <Tag
                    className={stylex.props(styles.statTag).className}
                    icon={<Icon icon={UsersIcon} />}
                  >
                    {formatIntergerNumber(memberCount)}
                  </Tag>
                </Tooltip>
              )}
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
              {installCount !== undefined && installCount > 0 && (
                <Tooltip
                  placement={'top'}
                  styles={{ root: { pointerEvents: 'none' } }}
                  title={t('groupAgents.downloads', { defaultValue: 'Downloads' })}
                >
                  <Tag
                    className={stylex.props(styles.statTag).className}
                    icon={<Icon icon={DownloadIcon} />}
                  >
                    {formatIntergerNumber(installCount)}
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
            {category && t(`category.groupAgent.${category}` as any, { defaultValue: category })}
          </Flexbox>
        </Flexbox>
      </Block>
    );
  },
);

export default UserGroupCard;
