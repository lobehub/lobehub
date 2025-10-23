'use client';

import { Github, MCP } from '@lobehub/icons';
import { ActionIcon, Avatar, Button, Icon, Text, Tooltip } from '@lobehub/ui';
import { createStyles, useResponsive } from 'antd-style';
import { BookTextIcon, CoinsIcon, DotIcon } from 'lucide-react';
import NextLink from 'next/link';
import qs from 'query-string';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Link as RouterLink } from 'react-router-dom';
import urlJoin from 'url-join';

import { formatIntergerNumber } from '@/utils/format';

import { useCategory } from '../../../../(list)/assistant/features/Category/useCategory';
import PublishedTime from '../../../../../../../../components/PublishedTime';
import { useDetailContext } from './DetailProvider';

const useStyles = createStyles(({ css, token }) => {
  return {
    desc: css`
      color: ${token.colorTextSecondary};
    `,
    time: css`
      font-size: 12px;
      color: ${token.colorTextDescription};
    `,
    version: css`
      font-family: ${token.fontFamilyCode};
      font-size: 13px;
    `,
  };
});

const Header = memo<{ mobile?: boolean }>(({ mobile: isMobile }) => {
  const { t } = useTranslation('discover');
  const {
    author,
    identifier,
    createdAt,
    category,
    avatar,
    title,
    tokenUsage,
    pluginCount,
    knowledgeCount,
  } = useDetailContext();
  const { styles, theme } = useStyles();
  const { mobile = isMobile } = useResponsive();
  const categories = useCategory();
  const cate = categories.find((c) => c.key === category);

  const cateButton = (
    <RouterLink
      to={qs.stringifyUrl({
        query: { category: cate?.key },
        url: '/assistant',
      })}
    >
      <Button icon={cate?.icon} size={'middle'} variant={'outlined'}>
        {cate?.label}
      </Button>
    </RouterLink>
  );

  return (
    <Flexbox gap={12}>
      <Flexbox align={'flex-start'} gap={16} horizontal width={'100%'}>
        <Avatar avatar={avatar} size={mobile ? 48 : 64} />
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
                {title}
              </Text>
            </Flexbox>
            <Flexbox align={'center'} gap={6} horizontal>
              <NextLink
                href={urlJoin(
                  'https://github.com/lobehub/lobe-chat-agents/tree/main/locales',
                  identifier as string,
                )}
                onClick={(e) => e.stopPropagation()}
                target={'_blank'}
              >
                <ActionIcon fill={theme.colorTextDescription} icon={Github} />
              </NextLink>
            </Flexbox>
          </Flexbox>
          <Flexbox align={'center'} gap={4} horizontal>
            {author && (
              <NextLink href={urlJoin('https://github.com', author)} target={'_blank'}>
                {author}
              </NextLink>
            )}
            <Icon icon={DotIcon} />
            <PublishedTime
              className={styles.time}
              date={createdAt as string}
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
          color: theme.colorTextSecondary,
        }}
      >
        {!mobile && cateButton}
        {Boolean(tokenUsage) && (
          <Tooltip styles={{ root: { pointerEvents: 'none' } }} title={t('assistants.tokenUsage')}>
            <Flexbox align={'center'} gap={6} horizontal>
              <Icon icon={CoinsIcon} />
              {formatIntergerNumber(tokenUsage)}
            </Flexbox>
          </Tooltip>
        )}
        {Boolean(pluginCount) && (
          <Tooltip styles={{ root: { pointerEvents: 'none' } }} title={t('assistants.withPlugin')}>
            <Flexbox align={'center'} gap={6} horizontal>
              <Icon fill={theme.colorTextSecondary} icon={MCP} />
              {pluginCount}
            </Flexbox>
          </Tooltip>
        )}
        {Boolean(knowledgeCount) && (
          <Tooltip
            styles={{ root: { pointerEvents: 'none' } }}
            title={t('assistants.withKnowledge')}
          >
            <Flexbox align={'center'} gap={6} horizontal>
              <Icon icon={BookTextIcon} />
              {knowledgeCount}
            </Flexbox>
          </Tooltip>
        )}
      </Flexbox>
    </Flexbox>
  );
});

export default Header;
