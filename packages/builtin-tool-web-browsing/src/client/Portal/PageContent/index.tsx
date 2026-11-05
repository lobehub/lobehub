import type { CrawlPluginState, CrawlResult } from '@lobechat/types';
import type { CrawlSuccessResult } from '@lobechat/web-crawler';
import {
  Alert,
  CopyButton,
  Descriptions,
  Flexbox,
  Highlighter,
  Icon,
  Markdown,
  Segmented,
  Skeleton,
  stopPropagation,
  Text,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ExternalLink } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useToolResultPayload } from '@/hooks/useToolResultPayload';

import { CRAWL_CONTENT_LIMITED_COUNT } from '../../../const';

const styles = stylex.create({
  description: {
    marginBlockStart: 0,
    marginBlockEnd: '4px',
    color: cssVar.colorTextSecondary,
  },
  footer: {
    paddingBlock: cssVar.paddingXS,
    paddingInline: cssVar.paddingXS,
    borderRadius: '6px',
    textAlign: 'center',
    backgroundColor: cssVar.colorFillQuaternary,
  },
  footerText: {
    fontSize: cssVar.fontSizeSM,
    color: cssVar.colorTextTertiary,
  },
  sliced: {
    color: cssVar.colorTextQuaternary,
  },
  title: {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 2,
    marginBlockEnd: 0,
    fontSize: '16px',
    fontWeight: 'bold',
  },
  titleRow: {
    color: cssVar.colorText,
  },
  url: {
    color: cssVar.colorTextTertiary,
  },
});

enum DisplayType {
  Raw = 'raw',
  Render = 'render',
}

interface PageContentProps {
  messageId: string;
  result?: CrawlResult;
}

const PageContent = memo<PageContentProps>(({ messageId, result }) => {
  const { t } = useTranslation('plugin');
  const [display, setDisplay] = useState<DisplayType>(DisplayType.Render);

  // The conversation read path hands the inline card a PREVIEW of the page and
  // leaves the body on the server. `length` stays pinned to the real body, so a
  // shorter `content` is the signal that this surface — the one that actually
  // shows the page — has to go fetch it. Legacy rows carry the whole body and
  // never trigger a request.
  const previewed = result?.data as CrawlSuccessResult | undefined;
  const isPreview =
    typeof previewed?.length === 'number' && (previewed.content?.length ?? 0) < previewed.length;
  const { isLoading, payload } = useToolResultPayload(messageId, isPreview);
  const storedContent = (payload?.pluginState as CrawlPluginState | undefined)?.results?.find(
    (stored) => stored.originalUrl === result?.originalUrl,
  )?.data?.content;

  if (!result || !result.data) return undefined;

  if ('errorType' in result.data) {
    return (
      <Flexbox className={stylex.props(styles.footer).className} gap={4}>
        <div>
          <Descriptions
            column={1}
            classNames={{
              content: stylex.props(styles.footerText).className,
            }}
            items={[
              {
                children: result.crawler,
                label: t('search.crawPages.meta.crawler'),
              },
            ]}
          />
        </div>
        <Alert
          type={'error'}
          extra={
            <div style={{ maxWidth: 500, overflowX: 'scroll' }}>
              <Highlighter language={'json'}>{JSON.stringify(result.data, null, 2)}</Highlighter>
            </div>
          }
          title={
            <div style={{ textAlign: 'start' }}>
              {result.data.errorMessage || result.data.content}
            </div>
          }
        />
      </Flexbox>
    );
  }

  const {
    url,
    title,
    description,
    content: previewContent,
    length,
    siteName,
  } = result.data as CrawlSuccessResult;
  const content = storedContent ?? previewContent;
  return (
    <Flexbox gap={24}>
      <Flexbox gap={8}>
        <Flexbox
          horizontal
          align={'center'}
          className={stylex.props(styles.titleRow).className}
          gap={24}
          justify={'space-between'}
        >
          <Flexbox>
            <div {...stylex.props(styles.title)}>{title || result.originalUrl}</div>
          </Flexbox>
        </Flexbox>
        {description && (
          <Text className={stylex.props(styles.description).className} ellipsis={{ rows: 4 }}>
            {description}
          </Text>
        )}
        <Flexbox horizontal align={'center'} className={stylex.props(styles.url).className} gap={4}>
          {siteName && <div>{siteName} · </div>}
          <a
            className={stylex.props(styles.url).className}
            href={url}
            rel={'nofollow'}
            style={{ display: 'flex', gap: 4 }}
            target={'_blank'}
            onClick={stopPropagation}
          >
            {result.originalUrl}
            <Icon icon={ExternalLink} />
          </a>
        </Flexbox>

        <div {...stylex.props(styles.footer)}>
          <Descriptions
            column={2}
            classNames={{
              content: stylex.props(styles.footerText).className,
            }}
            items={[
              {
                children: length ?? content?.length,
                label: t('search.crawPages.meta.words'),
              },
              {
                children: result.crawler,
                label: t('search.crawPages.meta.crawler'),
              },
            ]}
          />
        </div>
      </Flexbox>
      {isLoading && !storedContent && <Skeleton height={160} width={'100%'} />}
      {content && (
        <Flexbox gap={12} paddingBlock={'0 12px'}>
          <Flexbox horizontal justify={'space-between'}>
            <Segmented
              value={display}
              variant={'filled'}
              options={[
                { label: t('search.crawPages.detail.preview'), value: DisplayType.Render },
                { label: t('search.crawPages.detail.raw'), value: DisplayType.Raw },
              ]}
              onChange={(value) => setDisplay(value as DisplayType)}
            />
            <CopyButton content={content} />
          </Flexbox>
          {content.length > CRAWL_CONTENT_LIMITED_COUNT && (
            <Alert
              variant={'borderless'}
              title={t('search.crawPages.detail.tooLong', {
                characters: CRAWL_CONTENT_LIMITED_COUNT,
              })}
            />
          )}
          {display === DisplayType.Render ? (
            <Markdown variant={'chat'}>{content}</Markdown>
          ) : (
            <div style={{ paddingBlock: '0 12px' }}>
              {content.length < CRAWL_CONTENT_LIMITED_COUNT ? (
                content
              ) : (
                <>
                  <span>{content.slice(0, CRAWL_CONTENT_LIMITED_COUNT)}</span>
                  <span {...stylex.props(styles.sliced)}>
                    {content.slice(CRAWL_CONTENT_LIMITED_COUNT, -1)}
                  </span>
                </>
              )}
            </div>
          )}
        </Flexbox>
      )}
    </Flexbox>
  );
});

export default PageContent;
