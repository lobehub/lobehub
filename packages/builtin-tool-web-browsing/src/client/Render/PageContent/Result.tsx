'use client';

import { type CrawlErrorResult, type CrawlSuccessResult } from '@lobechat/web-crawler';
import { ActionIcon, Alert, Block, Flexbox, Text } from '@lobehub/ui';
import { Descriptions } from 'antd';
import { createStaticStyles } from 'antd-style';
import { ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';

import { WebBrowsingManifest } from '../../../manifest';

const styles = createStaticStyles(({ css, cssVar }) => {
  return {
    container: css`
      overflow: hidden;
      min-width: 360px;
      max-width: 360px;
    `,

    detailsSection: css`
      padding-block: ${cssVar.paddingSM};
    `,
    externalLink: css`
      color: ${cssVar.colorTextQuaternary};

      :hover {
        color: ${cssVar.colorText};
      }
    `,
    footer: css`
      padding-block: 4px;
      padding-inline: 12px;
      background-color: ${cssVar.colorFillQuaternary};
    `,
    footerText: css`
      font-size: 12px !important;
      color: ${cssVar.colorTextTertiary} !important;
    `,
    metaInfo: css`
      display: flex;
      align-items: center;
      color: ${cssVar.colorTextSecondary};
    `,
    title: css`
      overflow: hidden;
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 1;

      margin-block-end: 0;
    `,
    titleRow: css`
      overflow: hidden;
    `,
  };
});

interface CrawlerData {
  crawler: string;
  messageId: string;
  originalUrl: string;
  result: CrawlSuccessResult | CrawlErrorResult;
}

const CrawlerResultCard = memo<CrawlerData>(({ result, messageId, crawler, originalUrl }) => {
  const { t } = useTranslation('plugin');
  const [openToolUI, togglePageContent] = useChatStore((s) => [s.openToolUI, s.togglePageContent]);

  if ('errorType' in result) {
    return (
      <Flexbox className={styles.footer} gap={8}>
        <Alert
          title={<div style={{ textAlign: 'start' }}>{result.errorMessage || result.content}</div>}
          type={'error'}
          variant={'borderless'}
        />
        <div>
          <Descriptions
            classNames={{
              content: styles.footerText,
              label: styles.footerText,
            }}
            column={1}
            items={[
              {
                children: crawler,
                label: t('search.crawPages.meta.crawler'),
              },
            ]}
            size="small"
          />
        </div>
      </Flexbox>
    );
  }

  const { url, title, description } = result as CrawlSuccessResult;

  return (
    <Block
      className={styles.container}
      clickable
      justify={'space-between'}
      onClick={() => {
        openToolUI(messageId, WebBrowsingManifest.identifier);
        togglePageContent(originalUrl);
      }}
      variant={'outlined'}
    >
      <Flexbox gap={8} paddingBlock={8} paddingInline={12}>
        <Flexbox align={'center'} className={styles.titleRow} horizontal justify={'space-between'}>
          <Text ellipsis>{title || originalUrl}</Text>
          <Link href={url} onClick={(e) => e.stopPropagation()} target={'_blank'}>
            <ActionIcon icon={ExternalLink} size={'small'} />
          </Link>
        </Flexbox>
        <Text ellipsis={{ rows: 2 }} fontSize={12} type={'secondary'}>
          {description || result.content?.slice(0, 40)}
        </Text>
      </Flexbox>
      <Flexbox className={styles.footer}>
        <Descriptions
          classNames={{
            content: styles.footerText,
            label: styles.footerText,
          }}
          column={2}
          items={[
            {
              children: result.content?.length,
              label: t('search.crawPages.meta.words'),
            },
            {
              children: crawler,
              label: t('search.crawPages.meta.crawler'),
            },
          ]}
          size="small"
        />
      </Flexbox>
    </Block>
  );
});

export default CrawlerResultCard;
