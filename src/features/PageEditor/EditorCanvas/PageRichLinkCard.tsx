'use client';

import type { LinkCardRendererProps } from '@lobehub/editor';
import { createStaticStyles, cssVar } from 'antd-style';
import type { FC } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css }) => ({
  blockCard: css`
    display: grid;
    grid-template-columns: 40px minmax(0, 1fr);
    gap: 12px;

    width: min(100%, 520px);
    padding: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 12px;

    color: ${cssVar.colorText};
    text-decoration: none;

    background: ${cssVar.colorBgContainer};

    &[data-selected='true'] {
      border-color: ${cssVar.colorPrimary};
      box-shadow: 0 0 0 2px ${cssVar.colorPrimaryBg};
    }
  `,
  description: css`
    overflow: hidden;

    font-size: 13px;
    line-height: 1.5;
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  blockIcon: css`
    width: 40px;
    height: 40px;
    border-radius: 10px;
    object-fit: cover;
  `,
  inlineCard: css`
    display: inline-flex;
    gap: 5px;
    align-items: baseline;

    width: max-content;
    max-width: 100%;
    padding-inline: 2px;
    border-radius: 5px;

    line-height: 1;
    color: ${cssVar.colorLink};
    text-decoration: none;
    vertical-align: baseline;

    &[data-selected='true'] {
      outline: 2px solid ${cssVar.colorPrimaryBorder};
      outline-offset: 1px;
    }
  `,
  inlineIcon: css`
    flex: 0 0 auto;
    align-self: center;

    width: 1em;
    height: 1em;
    border-radius: 4px;

    object-fit: cover;
  `,
  loadingIcon: css`
    display: inline-block;
    flex: 0 0 auto;

    width: 1em;
    height: 1em;
    border: 2px solid ${cssVar.colorFillSecondary};
    border-block-start-color: ${cssVar.colorPrimary};
    border-radius: 50%;

    animation: page-rich-link-card-spin 0.8s linear infinite;

    @keyframes page-rich-link-card-spin {
      to {
        transform: rotate(360deg);
      }
    }
  `,
  blockLoadingIcon: css`
    place-self: center center;
    width: 22px;
    height: 22px;
  `,
  inlineTitle: css`
    overflow: hidden;

    min-width: 0;

    font-size: 1em;
    font-weight: 400;
    line-height: 1;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  meta: css`
    display: grid;
    gap: 3px;
    min-width: 0;
  `,
  title: css`
    overflow: hidden;

    font-size: 14px;
    font-weight: 600;
    line-height: 1.4;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  url: css`
    overflow: hidden;

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

const getFallbackIcon = (url: string) => {
  try {
    return new URL('/favicon.ico', url).toString();
  } catch {
    return '/favicon.ico';
  }
};

const PageRichLinkCard: FC<LinkCardRendererProps> = ({
  description,
  icon,
  isLoading,
  isSelected,
  layout,
  onClickCapture,
  onMouseDownCapture,
  openTarget,
  title,
  url,
}) => {
  const { t } = useTranslation('editor');
  const loadingLabel = t('link.loadingPreview');
  const sharedProps = {
    'aria-busy': isLoading || undefined,
    'data-page-rich-link-card': true,
    'data-loading': isLoading,
    'data-selected': isSelected,
    'href': url,
    onClickCapture,
    onMouseDownCapture,
    'rel': 'noreferrer',
    'target': openTarget || '_blank',
  } as const;

  if (layout === 'inline') {
    return (
      <a className={styles.inlineCard} {...sharedProps}>
        {isLoading ? (
          <span aria-label={loadingLabel} className={styles.loadingIcon} role={'status'} />
        ) : (
          <img alt="" className={styles.inlineIcon} src={icon || getFallbackIcon(url)} />
        )}
        <span className={styles.inlineTitle}>{title || url}</span>
      </a>
    );
  }

  return (
    <a className={styles.blockCard} {...sharedProps}>
      {isLoading ? (
        <span
          aria-label={loadingLabel}
          className={`${styles.loadingIcon} ${styles.blockLoadingIcon}`}
          role={'status'}
        />
      ) : (
        <img alt="" className={styles.blockIcon} src={icon || getFallbackIcon(url)} />
      )}
      <span className={styles.meta}>
        <span className={styles.title}>{title || url}</span>
        {description ? <span className={styles.description}>{description}</span> : null}
        <span className={styles.url}>{url}</span>
      </span>
    </a>
  );
};

export default PageRichLinkCard;
