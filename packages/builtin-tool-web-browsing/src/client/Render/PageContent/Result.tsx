'use client';

import type { CrawlErrorResult, CrawlSuccessResult } from '@lobechat/web-crawler';
import { ActionIcon, Alert, Block, Flexbox, Text, stopPropagation } from '@lobehub/ui';
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
            column={1}
            size="small"
            classNames={{
              content: styles.footerText,
              label: styles.footerText,
            }}
            items={[
              {
                children: crawler,
                label: t('search.crawPages.meta.crawler'),
              },
            ]}
          />
        </div>
      </Flexbox>
    );
  }

  const { url, title, description } = result as CrawlSuccessResult;

  return (
    <Block
      clickable
      className={styles.container}
      justify={'space-between'}
      variant={'outlined'}
      onClick={() => {
        openToolUI(messageId, WebBrowsingManifest.identifier);
        togglePageContent(originalUrl);
      }}
    >
      <Flexbox gap={8} paddingBlock={8} paddingInline={12}>
        <Flexbox horizontal align={'center'} className={styles.titleRow} justify={'space-between'}>
          <Text ellipsis>{title || originalUrl}</Text>
          <Link href={url} target={'_blank'} onClick={stopPropagation}>
            <ActionIcon icon={ExternalLink} size={'small'} />
          </Link>
        </Flexbox>
        <Text ellipsis={{ rows: 2 }} fontSize={12} type={'secondary'}>
          {description || result.content?.slice(0, 40)}
        </Text>
      </Flexbox>
      <Flexbox className={styles.footer}>
        <Descriptions
          column={2}
          size="small"
          classNames={{
            content: styles.footerText,
            label: styles.footerText,
          }}
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
        />
      </Flexbox>
    </Block>
  );
});

export default CrawlerResultCard;
