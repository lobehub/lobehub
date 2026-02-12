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
import { createStaticStyles, cx } from 'antd-style';
import {
  AlertTriangle,
  ClockIcon,
  DownloadIcon,
  Eye,
  EyeOff,
  GitForkIcon,
  MoreVerticalIcon,
  Pencil,
  UsersIcon,
} from 'lucide-react';
import qs from 'query-string';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import urlJoin from 'url-join';

import PublishedTime from '@/components/PublishedTime';
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

const styles = createStaticStyles(({ css, cssVar }) => {
  return {
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
    const navigate = useNavigate();
    const { isOwner, onStatusChange } = useUserDetailContext();

    const link = qs.stringifyUrl(
      {
        query: { source: 'new' },
        url: urlJoin('/community/group_agent', identifier),
      },
      { skipNull: true },
    );

    const isPublished = status === 'published';

    const handleCardClick = useCallback(() => {
      navigate(link);
    }, [link, navigate]);

    const handleEdit = useCallback(() => {
      navigate(urlJoin('/group', identifier, 'profile'));
    }, [identifier, navigate]);

    const handleStatusAction = useCallback(
      (action: 'publish' | 'unpublish' | 'deprecate') => {
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
        onClick={handleCardClick}
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
            <Avatar avatar={avatar} shape={'square'} size={40} style={{ flex: 'none' }} />
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
                  onClick={stopPropagation}
                >
                  <Text ellipsis as={'h3'} className={styles.title} style={{ flex: 1 }}>
                    {title}
                  </Text>
                </Link>
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
            className={styles.desc}
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
                  <Tag className={styles.statTag} icon={<Icon icon={UsersIcon} />}>
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
                  <Tag className={styles.statTag} icon={<Icon icon={GitForkIcon} />}>
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
                  <Tag className={styles.statTag} icon={<Icon icon={DownloadIcon} />}>
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
            {category && t(`category.groupAgent.${category}` as any, { defaultValue: category })}
          </Flexbox>
        </Flexbox>
      </Block>
    );
  },
);

export default UserGroupCard;
