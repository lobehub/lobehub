import { Github } from '@lobehub/icons';
import { ActionIcon, Avatar, Block, Icon, Text } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { ClockIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Link, useNavigate } from 'react-router-dom';
import urlJoin from 'url-join';

import PublishedTime from '@/components/PublishedTime';
import { DiscoverAssistantItem } from '@/types/discover';

import TokenTag from './TokenTag';

const useStyles = createStyles(({ css, token }) => {
  return {
    author: css`
      color: ${token.colorTextDescription};
    `,
    code: css`
      font-family: ${token.fontFamilyCode};
    `,
    desc: css`
      flex: 1;
      margin: 0 !important;
      color: ${token.colorTextSecondary};
    `,
    footer: css`
      margin-block-start: 16px;
      border-block-start: 1px dashed ${token.colorBorder};
      background: ${token.colorBgContainerSecondary};
    `,
    secondaryDesc: css`
      font-size: 12px;
      color: ${token.colorTextDescription};
    `,
    title: css`
      margin: 0 !important;
      font-size: 16px !important;
      font-weight: 500 !important;

      &:hover {
        color: ${token.colorLink};
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
    backgroundColor,
  }) => {
    const { styles, theme } = useStyles();
    const navigate = useNavigate();
    const link = urlJoin('/assistant', identifier);
    const { t } = useTranslation('discover');

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
              {author && <div className={styles.author}>{author}</div>}
            </Flexbox>
          </Flexbox>
          <Flexbox align={'center'} gap={4} horizontal>
            <a
              href={urlJoin(
                'https://github.com/lobehub/lobe-chat-agents/tree/main/locales',
                identifier,
              )}
              onClick={(e) => e.stopPropagation()}
              rel="noopener noreferrer"
              target={'_blank'}
            >
              <ActionIcon fill={theme.colorTextDescription} icon={Github} />
            </a>
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
