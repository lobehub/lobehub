'use client';

import { type IEditor, type TocItem, useToc } from '@lobehub/editor';
import { ActionIcon } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { EyeIcon, EyeOffIcon } from 'lucide-react';
import type { FC, RefObject } from 'react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { usePageTocVisibility } from './usePageTocVisibility';

const styles = createStaticStyles(({ css }) => ({
  aside: css`
    position: sticky;
    z-index: 10;
    inset-block-start: 0;

    overflow: auto;
    flex: none;
    align-self: flex-start;

    box-sizing: border-box;
    width: 240px;
    height: 100cqh;
    max-height: 100cqh;
    padding-block: 20px;
    padding-inline: 16px;

    background: ${cssVar.colorBgContainer};

    transition: width 150ms ease;

    &[data-collapsed='true'] {
      overflow: visible;
      width: 44px;
      padding-inline: 8px;
    }
  `,
  button: css`
    cursor: pointer;

    position: relative;

    overflow: hidden;

    width: 100%;
    height: 30px;
    padding-block: 0;
    border: 0;
    border-radius: 6px;

    color: ${cssVar.colorTextSecondary};
    text-align: start;
    text-overflow: ellipsis;
    white-space: nowrap;

    background: transparent;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }

    &[data-active='true'] {
      font-weight: 600;
      color: ${cssVar.colorText};
      background: transparent;
    }

    &[data-active='true']::before {
      content: '';

      position: absolute;
      inset-block: 6px;
      inset-inline-start: 0;

      width: 2px;
      border-radius: 999px;

      background: ${cssVar.colorText};
    }
  `,
  heading: css`
    font-size: 13px;
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
  header: css`
    display: flex;
    align-items: center;
    justify-content: space-between;

    height: 28px;
    margin-block-end: 10px;
    padding-inline-start: 8px;
  `,
  list: css`
    margin: 0;
    padding: 0;
    list-style: none;
  `,
  rail: css`
    cursor: pointer;

    display: flex;
    flex-direction: column;
    gap: 14px;
    align-items: center;

    width: 100%;
    height: 100%;
    padding-block: 54px 0;
    padding-inline: 0;
    border: 0;

    background: transparent;
  `,
  railMarker: css`
    width: 16px;
    height: 2px;
    border-radius: 999px;

    background: ${cssVar.colorTextQuaternary};

    transition:
      width 150ms ease,
      background 150ms ease;

    &[data-active='true'] {
      width: 24px;
      background: ${cssVar.colorText};
    }
  `,
  preview: css`
    position: absolute;
    z-index: 20;
    inset-block-start: 0;
    inset-inline-end: 0;

    overflow: auto;

    width: 240px;
    max-height: 100%;
    padding-block: 20px;
    padding-inline: 16px;

    background: ${cssVar.colorBgContainer};
  `,
}));

interface PageTableOfContentsProps {
  editor: IEditor;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
}

const TocItems: FC<{
  activeKey: null | string;
  items: TocItem[];
  jumpTo: (key: string) => void;
}> = ({ activeKey, items, jumpTo }) => (
  <ol className={styles.list}>
    {items.map((item) => (
      <li key={item.key}>
        <button
          className={styles.button}
          data-active={activeKey === item.key}
          style={{ paddingInlineStart: 8 + Math.max(item.depth - 1, 0) * 12 }}
          title={item.title}
          type="button"
          onClick={() => jumpTo(item.key)}
        >
          {item.title}
        </button>
        {item.children.length > 0 && (
          <TocItems activeKey={activeKey} items={item.children} jumpTo={jumpTo} />
        )}
      </li>
    ))}
  </ol>
);

const PageTableOfContents: FC<PageTableOfContentsProps> = ({ editor, scrollContainerRef }) => {
  const { t } = useTranslation('editor');
  const {
    closePreview,
    collapse,
    collapsed,
    expand,
    handleMouseEnter,
    handleMouseLeave,
    handleMouseMove,
    openPreview,
    previewOpen,
  } = usePageTocVisibility();
  const getScrollContainer = useCallback(() => scrollContainerRef.current, [scrollContainerRef]);
  const { activeKey, items, jumpTo } = useToc({
    editor,
    getScrollContainer,
    offsetTop: 16,
  });

  if (items.length === 0) return null;

  if (collapsed) {
    return (
      <aside
        data-collapsed
        data-page-toc
        aria-label={t('toc.label')}
        className={styles.aside}
        onFocus={openPreview}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onMouseMove={handleMouseMove}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) closePreview();
        }}
      >
        <button
          aria-label={t('toc.expand')}
          className={styles.rail}
          title={t('toc.expand')}
          type="button"
          onClick={expand}
        >
          {flattenTocItems(items).map((item) => (
            <span
              className={styles.railMarker}
              data-active={activeKey === item.key}
              key={item.key}
            />
          ))}
        </button>
        {previewOpen && (
          <div aria-label={t('toc.preview')} className={styles.preview} role="dialog">
            <div className={styles.header}>
              <div className={styles.heading}>{t('toc.heading')}</div>
              <ActionIcon
                aria-label={t('toc.pin')}
                icon={EyeIcon}
                size={'small'}
                title={t('toc.pin')}
                onClick={expand}
              />
            </div>
            <TocItems activeKey={activeKey} items={items} jumpTo={jumpTo} />
          </div>
        )}
      </aside>
    );
  }

  return (
    <aside data-page-toc aria-label={t('toc.label')} className={styles.aside}>
      <div className={styles.header}>
        <div className={styles.heading}>{t('toc.heading')}</div>
        <ActionIcon
          aria-label={t('toc.collapse')}
          icon={EyeOffIcon}
          size={'small'}
          title={t('toc.collapse')}
          onClick={collapse}
        />
      </div>
      <TocItems activeKey={activeKey} items={items} jumpTo={jumpTo} />
    </aside>
  );
};

const flattenTocItems = (items: TocItem[]): TocItem[] =>
  items.flatMap((item) => [item, ...flattenTocItems(item.children)]);

export default PageTableOfContents;
