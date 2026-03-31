'use client';

import { Github } from '@lobehub/icons';
import { ActionIcon, Avatar, Block, Flexbox, Icon, stopPropagation, Tag, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ClockIcon, FileTextIcon, StarIcon } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import urlJoin from 'url-join';

import PublishedTime from '@/components/PublishedTime';
import { discoverService } from '@/services/discover';
import { type DiscoverSkillItem } from '@/types/discover';

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

type UserSkillCardProps = DiscoverSkillItem;

const UserSkillCard = memo<UserSkillCardProps>(
  ({
    name,
    icon,
    author,
    description,
    identifier,
    category,
    updatedAt,
    installCount,
    github,
    ratingAvg,
    commentCount,
    resourcesCount = 0,
  }) => {
    const { t } = useTranslation('discover');
    const navigate = useNavigate();
    const link = urlJoin('/community/skill', identifier);

    const handleClick = useCallback(() => {
      discoverService
        .reportSkillEvent({
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
        data-testid="user-skill-item"
        height={'100%'}
        variant={'outlined'}
        width={'100%'}
        style={{
          overflow: 'hidden',
          position: 'relative',
        }}
        onClick={handleClick}
      >
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
            title={identifier}
            style={{
              overflow: 'hidden',
            }}
          >
            <Avatar avatar={icon || name} size={40} style={{ flex: 'none' }} />
            <Flexbox
              flex={1}
              gap={6}
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
                    {name}
                  </Text>
                </Link>
              </Flexbox>
              <Flexbox horizontal align={'center'} className={styles.author} gap={8}>
                {Boolean(ratingAvg) && (
                  <Flexbox horizontal align={'center'} gap={4} style={{ fontSize: 13 }}>
                    <Icon fill={cssVar.colorTextDescription} icon={StarIcon} size={12} />
                    {ratingAvg?.toFixed(1)}
                  </Flexbox>
                )}
                {author && <div>{author}</div>}
              </Flexbox>
            </Flexbox>
          </Flexbox>
          <Flexbox horizontal align={'center'} gap={4}>
            {github?.url && (
              <a
                href={github.url}
                rel="noopener noreferrer"
                target={'_blank'}
                onClick={stopPropagation}
              >
                <ActionIcon fill={cssVar.colorTextDescription} icon={Github} />
              </a>
            )}
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
          <Flexbox
            horizontal
            align={'center'}
            className={styles.secondaryDesc}
            justify={'space-between'}
          >
            <Tag
              icon={<Icon icon={FileTextIcon} />}
              size={'small'}
              variant={'filled'}
              style={{
                color: 'inherit',
                fontSize: 'inherit',
              }}
            >
              {(resourcesCount || 0) + 1}
            </Tag>
            <Flexbox horizontal align={'center'} className={styles.secondaryDesc} gap={8}>
              {category && t(`skills.categories.${category}.name` as any)}
            </Flexbox>
          </Flexbox>
        </Flexbox>
        <Flexbox
          horizontal
          align={'center'}
          className={styles.footer}
          justify={'space-between'}
          padding={16}
        >
          <Flexbox horizontal align={'center'} gap={4}>
            <Icon className={styles.secondaryDesc} icon={ClockIcon} size={14} />
            <PublishedTime className={styles.secondaryDesc} date={updatedAt} />
          </Flexbox>
        </Flexbox>
      </Block>
    );
  },
);

export default UserSkillCard;
