'use client';

import { Avatar, Block, Flexbox, Icon, Tag, Text, Tooltip, TooltipGroup } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { ClockIcon, DownloadIcon, HeartIcon, UsersIcon } from 'lucide-react';
import qs from 'query-string';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import urlJoin from 'url-join';

import PublishedTime from '@/components/PublishedTime';
import { type DiscoverGroupAgentItem } from '@/types/discover';
import { formatIntergerNumber } from '@/utils/format';

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
  };
});

type UserGroupCardProps = DiscoverGroupAgentItem;

const UserGroupCard = memo<UserGroupCardProps>(
  ({ avatar, title, description, createdAt, category, installCount, identifier, memberCount }) => {
    const { t } = useTranslation(['discover']);
    const navigate = useNavigate();

    const link = qs.stringifyUrl(
      {
        query: { source: 'new' },
        url: urlJoin('/community/group_agent', identifier),
      },
      { skipNull: true },
    );

    const handleCardClick = useCallback(() => {
      navigate(link);
    }, [link, navigate]);

    return (
      <Block
        clickable
        height={'100%'}
        onClick={handleCardClick}
        style={{
          cursor: 'pointer',
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
          >
            <Avatar avatar={avatar} shape={'square'} size={40} style={{ flex: 'none' }} />
            <Flexbox
              flex={1}
              gap={2}
              style={{
                overflow: 'hidden',
              }}
            >
              <Link
                onClick={(e) => e.stopPropagation()}
                style={{ color: 'inherit', flex: 1, overflow: 'hidden' }}
                to={link}
              >
                <Text as={'h3'} className={styles.title} ellipsis style={{ flex: 1 }}>
                  {title}
                </Text>
              </Link>
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
            <Flexbox align={'center'} gap={4} horizontal>
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
            {category && t(`category.groupAgent.${category}` as any, { defaultValue: category })}
          </Flexbox>
        </Flexbox>
      </Block>
    );
  },
);

export default UserGroupCard;
