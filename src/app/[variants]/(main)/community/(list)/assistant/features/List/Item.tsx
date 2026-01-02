import { Avatar, Block, Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { ClockIcon } from 'lucide-react';
import qs from 'query-string';
import React, { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import urlJoin from 'url-join';

import PublishedTime from '@/components/PublishedTime';
import { useQuery } from '@/hooks/useQuery';
import { type AssistantMarketSource, type DiscoverAssistantItem } from '@/types/discover';

import TokenTag from './TokenTag';

const styles = createStaticStyles(({ css, cssVar }) => {
  return {
    author: css`
      cursor: pointer;
      color: ${cssVar.colorTextDescription};

      &:hover {
        color: ${cssVar.colorPrimary};
      }
    `,
    code: css`
      font-family: ${cssVar.fontFamilyCode};
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

const AssistantItem = memo<DiscoverAssistantItem>(
  ({
    createdAt,
    author,
    avatar,
    title,
    description,
    category,
    identifier,
    tokenUsage,
    pluginCount,
    knowledgeCount,
    installCount,
    backgroundColor,
    userName,
  }) => {
    const navigate = useNavigate();
    const { source } = useQuery() as { source?: AssistantMarketSource };
    const link = qs.stringifyUrl(
      {
        query: { source },
        url: urlJoin('/community/assistant', identifier),
      },
      { skipNull: true },
    );

    const { t } = useTranslation('discover');

    const handleAuthorClick = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation();
        // Use userName for navigation if available, otherwise don't navigate
        if (userName) {
          navigate(`/community/user/${userName}`);
        }
      },
      [userName, navigate],
    );

    return (
      <Block
        clickable
        data-testid="assistant-item"
        height={'100%'}
        onClick={() => {
          navigate(link);
        }}
        style={{
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
            title={identifier}
          >
            <Avatar
              avatar={avatar}
              background={backgroundColor || 'transparent'}
              shape={'square'}
              size={40}
              style={{ flex: 'none' }}
            />
            <Flexbox
              flex={1}
              gap={2}
              style={{
                overflow: 'hidden',
              }}
            >
              <Flexbox
                align={'center'}
                flex={1}
                gap={8}
                horizontal
                style={{
                  overflow: 'hidden',
                }}
              >
                <Link style={{ color: 'inherit', overflow: 'hidden' }} to={link}>
                  <Text as={'h2'} className={styles.title} ellipsis>
                    {title}
                  </Text>
                </Link>
              </Flexbox>
              {author && (
                <div
                  className={userName ? styles.author : undefined}
                  onClick={userName ? handleAuthorClick : undefined}
                  style={userName ? undefined : { color: 'inherit' }}
                >
                  {author}
                </div>
              )}
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
          <TokenTag
            installCount={installCount}
            knowledgeCount={knowledgeCount}
            pluginCount={pluginCount}
            tokenUsage={tokenUsage}
          />
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
            {t(`category.assistant.${category}` as any)}
          </Flexbox>
        </Flexbox>
      </Block>
    );
  },
);

export default AssistantItem;
