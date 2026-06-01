'use client';

import { Avatar, Flexbox, Icon, Text } from '@lobehub/ui';
import { Button, Divider } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { StarIcon } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import urlJoin from 'url-join';

import type { DiscoverSkillItem } from '@/types/discover';

const styles = createStaticStyles(({ css, cssVar }) => ({
  author: css`
    font-size: 12px;
    color: ${cssVar.colorTextDescription};
  `,
  container: css`
    width: 100%;
    max-width: 720px;
    margin-block: 0;
    margin-inline: auto;
  `,
  count: css`
    font-size: 13px;
    color: ${cssVar.colorTextDescription};
  `,
  description: css`
    margin: 0;
    font-size: 13px;
    line-height: 1.5;
    color: ${cssVar.colorTextSecondary};
  `,
  getButton: css`
    padding-inline: 16px;
    border-radius: 20px;
  `,
  item: css`
    padding-block: 16px;
    border-radius: 8px;

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  name: css`
    font-size: 15px;
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
  rating: css`
    font-size: 13px;
    font-weight: 500;
    color: ${cssVar.colorWarning};
  `,
  sectionTitle: css`
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
}));

interface SkillItemProps extends DiscoverSkillItem {}

const SkillItem = memo<SkillItemProps>(
  ({ name, icon, identifier, author, description, ratingAvg }) => {
    const { t } = useTranslation('discover');
    const navigate = useNavigate();

    const handleClick = useCallback(() => {
      navigate(urlJoin('/community/skill', identifier));
    }, [navigate, identifier]);

    const handleGet = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation();
        navigate(urlJoin('/community/skill', identifier));
      },
      [navigate, identifier],
    );

    // Use ratingAvg, fallback to a default display if not available
    const rating = ratingAvg || 0;

    return (
      <Flexbox
        horizontal
        align={'center'}
        className={styles.item}
        gap={16}
        paddingInline={8}
        style={{ cursor: 'pointer' }}
        onClick={handleClick}
      >
        <Avatar avatar={icon || name} size={56} style={{ flexShrink: 0 }} />
        <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
          <Text ellipsis className={styles.name}>
            {name}
          </Text>
          <Text className={styles.author}>{author}</Text>
          <Text ellipsis className={styles.description}>
            {description}
          </Text>
        </Flexbox>
        <Flexbox align={'center'} gap={8} style={{ flexShrink: 0 }}>
          {rating > 0 && (
            <Flexbox horizontal align={'center'} className={styles.rating} gap={4}>
              <Icon fill={cssVar.colorWarning} fillOpacity={1} icon={StarIcon} size={14} />
              {rating.toFixed(1)}
            </Flexbox>
          )}
          <Button className={styles.getButton} shape="round" onClick={handleGet}>
            {t('skills.collection.get')}
          </Button>
        </Flexbox>
      </Flexbox>
    );
  },
);

interface SkillsListProps {
  skills: DiscoverSkillItem[];
}

const SkillsList = memo<SkillsListProps>(({ skills }) => {
  const { t } = useTranslation('discover');

  if (!skills || skills.length === 0) return null;

  return (
    <Flexbox className={styles.container} gap={16}>
      <Divider style={{ margin: 0 }} />
      <Flexbox horizontal align={'center'} justify={'space-between'}>
        <h2 className={styles.sectionTitle}>{t('skills.collection.skillsInCollection')}</h2>
        <span className={styles.count}>
          {t('skills.collection.skillCount', { count: skills.length })}
        </span>
      </Flexbox>
      <Flexbox>
        {skills.map((skill) => (
          <SkillItem key={skill.identifier} {...skill} />
        ))}
      </Flexbox>
    </Flexbox>
  );
});

export default SkillsList;
