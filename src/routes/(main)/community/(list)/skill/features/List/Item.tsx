'use client';

import { Github } from '@lobehub/icons';
import { ActionIcon, Avatar, Block, Flexbox, Icon, stopPropagation, Tag, Text } from '@lobehub/ui';
import { Spotlight } from '@lobehub/ui/awesome';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ClockIcon, FileTextIcon, StarIcon } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import PublishedTime from '@/components/PublishedTime';
import { createSkillDetailModal } from '@/features/CommunitySkillDetail';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { discoverService } from '@/services/discover';
import { type DiscoverSkillItem } from '@/types/discover';

import MetaInfo from './MetaInfo';

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

const SkillItem = memo<DiscoverSkillItem>(
  ({
    name,
    icon,
    author,
    description,
    identifier,
    category,
    isFeatured,
    updatedAt,
    installCount,
    github,
    ratingAvg,
    commentCount,
    resourcesCount = 0,
  }) => {
    const { t } = useTranslation('discover');
    const link = urlJoin('/community/skill', identifier);

    const handleClick = useCallback(() => {
      discoverService
        .reportSkillEvent({
          event: 'click',
          identifier,
          source: location.pathname,
        })
        .catch(() => {});

      createSkillDetailModal({ identifier });
    }, [identifier]);

    return (
      <Block
        clickable
        data-testid="skill-item"
        height={'100%'}
        variant={'outlined'}
        width={'100%'}
        style={{
          overflow: 'hidden',
          position: 'relative',
        }}
        onClick={handleClick}
      >
        {isFeatured && <Spotlight size={400} />}
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
                {/* Keep the deep link for cmd/ctrl-click; plain clicks open the modal */}
                <WorkspaceLink
                  style={{ color: 'inherit', overflow: 'hidden' }}
                  to={link}
                  onClick={(e) => {
                    // Never let the click bubble to the card (it would open the
                    // modal on top of the browser's new-tab navigation)
                    e.stopPropagation();
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                    e.preventDefault();
                    handleClick();
                  }}
                >
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
              {isFeatured && (
                <Tag
                  size={'small'}
                  variant={'outlined'}
                  style={{
                    color: 'inherit',
                    fontSize: 'inherit',
                  }}
                >
                  {t('isFeatured')}
                </Tag>
              )}
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
          <MetaInfo
            className={stylex.props(styles.secondaryDesc).className}
            commentCount={commentCount}
            installCount={installCount}
            stars={github?.stars}
          />
        </Flexbox>
      </Block>
    );
  },
);

export default SkillItem;
