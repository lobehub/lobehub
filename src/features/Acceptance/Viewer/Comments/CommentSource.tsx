'use client';

import type { AcceptanceCommentSource } from '@lobechat/types';
import { Icon } from '@lobehub/ui';
import { Tag, Tooltip } from '@lobehub/ui/base-ui';
import { AppWindow } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

/** Host and path, without the query noise — enough to recognize the page. */
const pageLabel = (url: string) => {
  try {
    const { host, pathname } = new URL(url);
    return `${host}${pathname === '/' ? '' : pathname}`;
  } catch {
    return url;
  }
};

/**
 * Marks a remark made on the delivered product itself (the embedded review
 * toolbar) and links back to that page, with the product-defined facts
 * (e.g. data scenario and seed) that reproduce it.
 */
const CommentSource = memo<{ source: AcceptanceCommentSource }>(({ source }) => {
  const { t } = useTranslation('verify');
  const facts = Object.entries(source.extra ?? {});
  return (
    <>
      <Tooltip title={source.selector ? `${source.url}\n${source.selector}` : source.url}>
        <a href={source.url} rel={'noreferrer'} target={'_blank'}>
          <Tag icon={<Icon icon={AppWindow} size={12} />} size={'small'}>
            {t('acceptance.comments.fromProduct', { page: pageLabel(source.url) })}
          </Tag>
        </a>
      </Tooltip>
      {facts.map(([key, value]) => (
        <Tag key={key} size={'small'}>
          {key}: {String(value)}
        </Tag>
      ))}
    </>
  );
});

CommentSource.displayName = 'CommentSource';

export default CommentSource;
