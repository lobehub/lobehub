'use client';

import { Github } from '@lobehub/icons';
import { ActionIcon, Avatar, Block, Flexbox, Icon, stopPropagation, Tag, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ClockIcon, FileTextIcon, StarIcon } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import PublishedTime from '@/components/PublishedTime';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { discoverService } from '@/services/discover';
import { type DiscoverSkillItem } from '@/types/discover';

const styles = stylex.create({
  author: { color: cssVar.colorTextDescription },
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
    const navigate = useWorkspaceAwareNavigate();
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
                <WorkspaceLink style={{ color: 'inherit', overflow: 'hidden' }} to={link}>
                  <Text ellipsis as={'h2'} className={stylex.props(styles.title).className}>
                    {name}
                  </Text>
                </WorkspaceLink>
              </Flexbox>
              <Flexbox
                horizontal
                align={'center'}
                className={stylex.props(styles.author).className}
                gap={8}
              >
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
            className={stylex.props(styles.desc).className}
            ellipsis={{
              rows: 3,
            }}
          >
            {description}
          </Text>
          <Flexbox
            horizontal
            align={'center'}
            className={stylex.props(styles.secondaryDesc).className}
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
            <Flexbox
              horizontal
              align={'center'}
              className={stylex.props(styles.secondaryDesc).className}
              gap={8}
            >
              {category && t(`skills.categories.${category}.name` as any)}
            </Flexbox>
          </Flexbox>
        </Flexbox>
        <Flexbox
          horizontal
          align={'center'}
          className={stylex.props(styles.footer).className}
          justify={'space-between'}
          padding={16}
        >
          <Flexbox horizontal align={'center'} gap={4}>
            <Icon
              className={stylex.props(styles.secondaryDesc).className}
              icon={ClockIcon}
              size={14}
            />
            <PublishedTime
              className={stylex.props(styles.secondaryDesc).className}
              date={updatedAt}
            />
          </Flexbox>
        </Flexbox>
      </Block>
    );
  },
);

export default UserSkillCard;
