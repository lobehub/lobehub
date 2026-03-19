'use client';

import { Github } from '@lobehub/icons';
import { ActionIcon, Avatar, Button, Flexbox, Icon, stopPropagation, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  DotIcon,
  DownloadIcon,
  FileTextIcon,
  MessageSquare,
  ScaleIcon,
  StarIcon,
} from 'lucide-react';
import qs from 'query-string';
import { memo } from 'react';
import { Link } from 'react-router-dom';

import PublishedTime from '@/components/PublishedTime';
import { useSkillCategoryItem } from '@/hooks/useSkillCategory';

import { useDetailContext } from './DetailProvider';

export const styles = createStaticStyles(({ css, cssVar }) => {
  return {
    desc: css`
      color: ${cssVar.colorTextSecondary};
    `,
    extraTag: css`
      padding-block: 4px;
      padding-inline: 10px 12px;
      border-radius: 16px;

      color: ${cssVar.colorTextSecondary};

      background: ${cssVar.colorFillTertiary};
    `,
    extraTagActive: css`
      &:hover {
        color: ${cssVar.colorText};
      }
    `,
    time: css`
      font-size: 12px;
      color: ${cssVar.colorTextDescription};
    `,
    version: css`
      font-family: ${cssVar.fontFamilyCode};
      font-size: 13px;
    `,
  };
});

const formatCompactNumber = (num?: number): string => {
  if (!num) return '0';
  if (num < 1000) return num.toString();
  if (num < 1000000) return `${(num / 1000).toFixed(1)}k`;
  return `${(num / 1000000).toFixed(1)}M`;
};

const Header = memo<{ mobile?: boolean }>(({ mobile }) => {
  const {
    name,
    author,
    version,
    identifier,
    updatedAt,
    createdAt,
    ratingAverage,
    category,
    installCount,
    github,
    homepage,
    resources,
    comments,
    license,
    icon,
  } = useDetailContext();

  const cate = useSkillCategoryItem(category);
  const resourcesCount = (Object.values(resources || {})?.length || 0) + 1;

  const scores = (
    <Flexbox align={'center'} className={styles.extraTag} gap={16} horizontal>
      <Flexbox align={'center'} className={styles.extraTagActive} gap={8} horizontal>
        <Icon icon={FileTextIcon} size={14} />
        {resourcesCount}
      </Flexbox>
    </Flexbox>
  );

  const cateButton = cate ? (
    <Link
      to={qs.stringifyUrl({
        query: { category: cate.key },
        url: '/community/skill',
      })}
    >
      <Button icon={<Icon icon={cate.icon} />} size={'middle'} variant={'outlined'}>
        {cate.label}
      </Button>
    </Link>
  ) : null;

  return (
    <Flexbox gap={12}>
      <Flexbox align={'flex-start'} gap={16} horizontal width={'100%'}>
        <Avatar avatar={icon || name} size={mobile ? 48 : 64} />
        <Flexbox
          flex={1}
          gap={4}
          style={{
            overflow: 'hidden',
          }}
        >
          <Flexbox
            align={'center'}
            gap={8}
            horizontal
            justify={'space-between'}
            style={{
              overflow: 'hidden',
              position: 'relative',
            }}
          >
            <Flexbox
              align={'center'}
              flex={1}
              gap={12}
              horizontal
              style={{
                overflow: 'hidden',
                position: 'relative',
              }}
            >
              <Text
                as={'h1'}
                ellipsis
                style={{ fontSize: mobile ? 18 : 24, margin: 0 }}
                title={identifier}
              >
                {name}
              </Text>
              {!mobile && scores}
            </Flexbox>
            <Flexbox align={'center'} gap={6} horizontal>
              {homepage && (
                <a
                  href={homepage}
                  onClick={stopPropagation}
                  rel="noopener noreferrer"
                  target={'_blank'}
                >
                  <ActionIcon fill={cssVar.colorTextDescription} icon={Github} />
                </a>
              )}
            </Flexbox>
          </Flexbox>
          <Flexbox align={'center'} gap={4} horizontal>
            {Boolean(ratingAverage) ? (
              <Flexbox align={'center'} gap={8} horizontal>
                <Icon fill={cssVar.colorWarning} icon={StarIcon} size={14} />
                <Text weight={500}>{ratingAverage?.toFixed(1)}</Text>
              </Flexbox>
            ) : (
              <div className={styles.version}>{version}</div>
            )}
            <Icon icon={DotIcon} />
            {author?.url ? (
              <a href={author.url} rel="noopener noreferrer" target={'_blank'}>
                {author.name}
              </a>
            ) : (
              <span>{author?.name}</span>
            )}
            <Icon icon={DotIcon} />
            <PublishedTime
              className={styles.time}
              date={(updatedAt || createdAt) as string}
              template={'MMM DD, YYYY'}
            />
          </Flexbox>
        </Flexbox>
      </Flexbox>
      <Flexbox
        align={'center'}
        gap={mobile ? 12 : 24}
        horizontal
        style={{
          color: cssVar.colorTextSecondary,
        }}
        wrap={'wrap'}
      >
        {mobile && scores}
        {!mobile && cateButton}
        <Flexbox align={'center'} gap={mobile ? 12 : 24} horizontal wrap={'wrap'}>
          {Boolean(license?.name) && (
            <Flexbox align={'center'} gap={6} horizontal>
              <Icon icon={ScaleIcon} size={14} />
              {license?.name}
            </Flexbox>
          )}
          {Boolean(installCount) && (
            <Flexbox align={'center'} gap={6} horizontal>
              <Icon icon={DownloadIcon} size={14} />
              {formatCompactNumber(installCount)}
            </Flexbox>
          )}
          {Boolean(github?.stars) && (
            <Flexbox align={'center'} gap={6} horizontal>
              <Icon icon={StarIcon} size={14} />
              {formatCompactNumber(github?.stars)}
            </Flexbox>
          )}
          {Boolean(comments?.totalCount) && (
            <Flexbox align={'center'} gap={6} horizontal>
              <Icon icon={MessageSquare} size={14} />
              {formatCompactNumber(comments?.totalCount)}
            </Flexbox>
          )}
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
});

export default Header;
