import { ActionIcon, Avatar, Flexbox, Tag } from '@lobehub/ui';
import { Typography } from 'antd';
import { Heart, Star, Users } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { formatTime } from '@/utils/client/time';

import { useDetailData } from './DetailProvider';

const { Title, Text, Paragraph } = Typography;

const Header = memo(() => {
  const { t } = useTranslation('discover');
  const data = useDetailData();

  const { group, currentVersion, author, memberAgents } = data;

  const avatar = currentVersion?.avatar || group.name?.[0] || '👥';
  const title = currentVersion?.name || group.name;
  const description = currentVersion?.description;
  const category = currentVersion?.category;
  const tags = currentVersion?.tags || [];

  const memberCount = memberAgents?.length || 0;
  const likeCount = group.likeCount || 0;
  const favoriteCount = group.favoriteCount || 0;

  return (
    <Flexbox gap={24} style={{ padding: '24px 0' }}>
      {/* Avatar and Title Section */}
      <Flexbox align="center" gap={16} horizontal>
        <Avatar
          avatar={avatar}
          background={currentVersion?.backgroundColor}
          size={80}
          style={{ flex: 'none' }}
        />
        <Flexbox flex={1} gap={8}>
          <Title level={2} style={{ margin: 0 }}>
            {title}
          </Title>
          {author && (
            <Flexbox align="center" gap={8} horizontal>
              <Avatar avatar={author.avatar} size={24} />
              <Text type="secondary">
                {t('by')} {author.name || author.userName}
              </Text>
            </Flexbox>
          )}
          <Text type="secondary">
            {t('publishedAt')} {formatTime(group.createdAt)}
          </Text>
        </Flexbox>
      </Flexbox>

      {/* Description */}
      {description && (
        <Paragraph style={{ margin: 0 }} type="secondary">
          {description}
        </Paragraph>
      )}

      {/* Metadata Section */}
      <Flexbox align="center" gap={16} horizontal wrap="wrap">
        {/* Category */}
        {category && (
          <Tag bordered={false} color="blue">
            {category}
          </Tag>
        )}

        {/* Member Count */}
        <Flexbox align="center" gap={4} horizontal>
          <Users size={16} />
          <Text type="secondary">
            {memberCount} {memberCount === 1 ? 'Member' : 'Members'}
          </Text>
        </Flexbox>

        {/* Like Count */}
        <Flexbox align="center" gap={4} horizontal>
          <Heart size={16} />
          <Text type="secondary">{likeCount}</Text>
        </Flexbox>

        {/* Favorite Count */}
        <Flexbox align="center" gap={4} horizontal>
          <Star size={16} />
          <Text type="secondary">{favoriteCount}</Text>
        </Flexbox>
      </Flexbox>

      {/* Tags */}
      {tags.length > 0 && (
        <Flexbox gap={8} horizontal wrap="wrap">
          {tags.map((tag) => (
            <Tag key={tag}>{tag}</Tag>
          ))}
        </Flexbox>
      )}
    </Flexbox>
  );
});

export default Header;
