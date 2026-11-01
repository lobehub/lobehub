'use client';

import { AgentIcon } from '@lobehub/icons';
import { Avatar, Flexbox, Markdown, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { media } from '@lobehub/ui/stylex/media.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import Rate from '@/components/RatingOverview/Rate';
import { type SkillCommentItem } from '@/types/discover';

import moduleStyles from './CommentItem.module.css';

const styles = stylex.create({
  author: {
    fontSize: { default: '16px', [media.sm]: '15px' },
    fontWeight: 700,
    lineHeight: 1.2,
    color: cssVar.colorText,
    wordBreak: 'break-word',
  },
  avatar: {
    flex: 'none',
    lineHeight: 0,
  },
  card: {
    paddingBlock: { default: '22px', [media.sm]: '18px' },
    paddingInline: { default: '24px', [media.sm]: '16px' },
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: { default: '22px', [media.sm]: '18px' },
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  date: {
    flex: 'none',
    fontSize: '13px',
    fontWeight: 500,
    lineHeight: 1.3,
    color: cssVar.colorTextDescription,
    whiteSpace: 'nowrap',
  },
  rate: {
    lineHeight: 1,
  },
});

const CommentItem = memo<{ item: SkillCommentItem }>(({ item }) => {
  const { i18n, t } = useTranslation('discover');
  const author = item.author;
  const createdAt = useMemo(() => {
    const date = new Date(item.createdAt);

    if (Number.isNaN(date.getTime())) return item.createdAt;

    return new Intl.DateTimeFormat(i18n.language, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(date);
  }, [i18n.language, item.createdAt]);

  const authorName = useMemo(() => {
    const displayName = author?.displayName?.trim();
    const identifier = author?.identifier?.trim();

    if (displayName) {
      if (displayName.startsWith('@') || /\s/.test(displayName)) return displayName;
      return `@${displayName}`;
    }
    if (identifier) return identifier.startsWith('@') ? identifier : `@${identifier}`;

    return t('skills.details.comments.anonymous');
  }, [author?.displayName, author?.identifier, t]);

  const avatar = useMemo(() => {
    if (author?.type === 'agent' && author.sourceType) {
      return <AgentIcon agent={author.sourceType} shape={'circle'} size={32} type={'avatar'} />;
    }

    return (
      <Avatar avatar={author?.avatar || authorName} shape={'circle'} size={32} title={authorName} />
    );
  }, [author?.avatar, author?.sourceType, author?.type, authorName]);

  return (
    <Flexbox className={stylex.props(styles.card).className} gap={14}>
      <Flexbox horizontal align={'center'} gap={12} justify={'space-between'} wrap={'wrap'}>
        <Flexbox horizontal align={'center'} gap={12}>
          <div {...stylex.props(styles.avatar)}>{avatar}</div>
          <Flexbox gap={6}>
            <Text className={stylex.props(styles.author).className}>{authorName}</Text>
            {typeof item.rating === 'number' && (
              <Rate
                className={stylex.props(styles.rate).className}
                gap={3}
                size={16}
                value={item.rating}
              />
            )}
          </Flexbox>
        </Flexbox>
        <Text className={stylex.props(styles.date).className}>{createdAt}</Text>
      </Flexbox>
      <Markdown className={moduleStyles.content} variant={'chat'}>
        {item.content}
      </Markdown>
    </Flexbox>
  );
});

export default CommentItem;
