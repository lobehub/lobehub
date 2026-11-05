'use client';

import type { CrawlErrorResult, CrawlSuccessResult } from '@lobechat/web-crawler';
import {
  ActionIcon,
  Alert,
  Block,
  Descriptions,
  Flexbox,
  stopPropagation,
  Text,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ExternalLink } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';

import { WebBrowsingManifest } from '../../../manifest';

const styles = stylex.create({
  container: {
    overflow: 'hidden',
    minWidth: '360px',
    maxWidth: '360px',
  },
  footer: {
    paddingBlock: '4px',
    paddingInline: '12px',
    backgroundColor: cssVar.colorFillQuaternary,
  },
  footerText: {
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
  },
  titleRow: {
    overflow: 'hidden',
  },
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
      <Flexbox className={stylex.props(styles.footer).className} gap={8}>
        <Alert
          title={<div style={{ textAlign: 'start' }}>{result.errorMessage || result.content}</div>}
          type={'error'}
          variant={'borderless'}
        />
        <div>
          <Descriptions
            column={1}
            classNames={{
              content: stylex.props(styles.footerText).className,
              label: stylex.props(styles.footerText).className,
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

  const { url, title, description, length } = result as CrawlSuccessResult;

  return (
    <Block
      clickable
      className={stylex.props(styles.container).className}
      justify={'space-between'}
      variant={'outlined'}
      onClick={() => {
        openToolUI(messageId, WebBrowsingManifest.identifier);
        togglePageContent(originalUrl);
      }}
    >
      <Flexbox gap={8} paddingBlock={8} paddingInline={12}>
        <Flexbox
          horizontal
          align={'center'}
          className={stylex.props(styles.titleRow).className}
          justify={'space-between'}
        >
          <Text ellipsis>{title || originalUrl}</Text>
          <a href={url} target={'_blank'} onClick={stopPropagation}>
            <ActionIcon icon={ExternalLink} size={'small'} />
          </a>
        </Flexbox>
        <Text ellipsis={{ rows: 2 }} fontSize={12} type={'secondary'}>
          {description || result.content?.slice(0, 40)}
        </Text>
      </Flexbox>
      <Flexbox className={stylex.props(styles.footer).className}>
        <Descriptions
          column={2}
          classNames={{
            content: stylex.props(styles.footerText).className,
            label: stylex.props(styles.footerText).className,
          }}
          items={[
            {
              // `length` is pinned to the crawled body; `content` may be a
              // preview once the read path projects this tool.
              children: length ?? result.content?.length,
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
