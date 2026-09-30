'use client';

import { formatSize } from '@lobechat/utils/format';
import { Center, Flexbox, Icon, Markdown, useAppElement } from '@lobehub/ui';
import { ActionIcon, Button, Skeleton, Tag, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { ArrowLeft, ArrowRight, Download, ExternalLink, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { EntityLinkHostProvider, useEntityMarkdown } from '@/features/EntityLink';
import { isSafeExternalUrl } from '@/features/Work/descriptors';
import { useActivityTime } from '@/hooks/useActivityTime';
import { useClientDataSWR } from '@/libs/swr';
import { portalKeys } from '@/libs/swr/keys';
import { documentService } from '@/services/document';

import type { DeliverableItem } from './deliverableList';
import {
  CitationMark,
  deliverableIconOf,
  deliverableTitleOf,
  fileFormatOf,
  isImageArtifact,
} from './deliverableVisuals';

/**
 * Full-screen reading mode for a Goal's deliverables: the list on the left,
 * the current one wide on the right, ←/→ to page through them in order and Esc
 * to return to the result page. Each kind shows what reading it means — a
 * document renders its text, a file offers its download, an external resource
 * offers to open it.
 */

const styles = createStaticStyles(({ css }) => ({
  body: css`
    overflow: auto;
    flex: 1;

    min-height: 0;
    padding-block: 32px 64px;
    padding-inline: 48px;
  `,
  card: css`
    width: 100%;
    max-width: 640px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};
  `,
  doc: css`
    width: 100%;
    max-width: 760px;
    margin-inline: auto;
  `,
  header: css`
    flex: none;
    padding-block: 12px;
    padding-inline: 24px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  image: css`
    max-width: 100%;
    max-height: 60vh;
    border-radius: ${cssVar.borderRadius};
    object-fit: contain;
  `,
  item: css`
    cursor: pointer;

    display: flex;
    gap: 10px;
    align-items: center;

    width: 100%;
    padding-block: 8px;
    padding-inline: 10px;
    border: none;
    border-radius: ${cssVar.borderRadius};

    text-align: start;

    background: none;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: -2px;
    }
  `,
  itemActive: css`
    background: ${cssVar.colorFillSecondary};

    &:hover {
      background: ${cssVar.colorFillSecondary};
    }
  `,
  overlay: css`
    position: fixed;
    z-index: 1000;
    inset: 0;

    display: flex;
    flex-direction: row;

    background: ${cssVar.colorBgLayout};

    &:focus {
      outline: none;
    }
  `,
  sidebar: css`
    overflow: auto;
    flex: none;

    width: 320px;
    padding: 12px;
    border-inline-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
}));

const SidebarItem = ({
  active,
  item,
  onClick,
}: {
  active: boolean;
  item: DeliverableItem;
  onClick: () => void;
}) => {
  const { t } = useTranslation('chat');
  const { text, title } = useActivityTime(item.artifact.createdAt);

  return (
    <button
      aria-current={active || undefined}
      className={cx(styles.item, active && styles.itemActive)}
      type={'button'}
      onClick={onClick}
    >
      <Icon color={cssVar.colorTextSecondary} icon={deliverableIconOf(item.artifact)} size={16} />
      <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
        <Text ellipsis fontSize={13} weight={500}>
          {deliverableTitleOf(item.artifact, t('goalProcess.deliverables.untitled'))}
        </Text>
        <Text ellipsis fontSize={12} title={title} type={'secondary'}>
          {[item.producerTitle, text].filter(Boolean).join(' · ')}
        </Text>
      </Flexbox>
      <CitationMark item={item} />
    </button>
  );
};

const DocumentBody = ({ documentId }: { documentId: string }) => {
  const markdownProps = useEntityMarkdown();
  const { data: document, isLoading } = useClientDataSWR(
    portalKeys.documentHeader(documentId),
    () => documentService.getDocumentById(documentId),
  );

  if (isLoading)
    return (
      <Flexbox className={styles.doc} data-testid={'deliverable-reader-loading'} gap={12}>
        <Skeleton height={28} radius={4} width={'50%'} />
        <Skeleton height={14} radius={4} />
        <Skeleton height={14} radius={4} />
        <Skeleton height={14} radius={4} width={'70%'} />
      </Flexbox>
    );

  return (
    <div className={styles.doc} data-testid={'deliverable-reader-document'}>
      <Markdown variant={'chat'} {...markdownProps}>
        {document?.content ?? ''}
      </Markdown>
    </div>
  );
};

const Body = ({ item }: { item: DeliverableItem }) => {
  const { t } = useTranslation('chat');
  const { artifact } = item;
  const title = deliverableTitleOf(artifact, t('goalProcess.deliverables.untitled'));
  const url = isSafeExternalUrl(artifact.url) ? artifact.url : undefined;

  if (artifact.type === 'document')
    return artifact.resourceId ? (
      <DocumentBody documentId={artifact.resourceId} key={artifact.resourceId} />
    ) : (
      <Center>
        <Text type={'secondary'}>{t('goalProcess.result.deliverables.reader.unavailable')}</Text>
      </Center>
    );

  if (artifact.type === 'external')
    return (
      <Center>
        <Center
          className={styles.card}
          data-testid={'deliverable-reader-link'}
          gap={12}
          padding={32}
        >
          <Icon icon={deliverableIconOf(artifact)} size={28} />
          <Text fontSize={15} weight={600}>
            {title}
          </Text>
          {url ? (
            <>
              <Text ellipsis fontSize={13} style={{ maxWidth: 520 }} type={'secondary'}>
                {url}
              </Text>
              <Button href={url} icon={ExternalLink} rel={'noopener noreferrer'} target={'_blank'}>
                {t('goalProcess.result.deliverables.reader.openLink')}
              </Button>
            </>
          ) : (
            <Text fontSize={13} type={'secondary'}>
              {t('goalProcess.result.deliverables.reader.noUrl')}
            </Text>
          )}
        </Center>
      </Center>
    );

  const meta = [
    fileFormatOf(artifact),
    artifact.fileSize !== undefined && formatSize(artifact.fileSize),
    !isImageArtifact(artifact) && t('goalProcess.result.deliverables.reader.noPreview'),
  ].filter(Boolean);

  return (
    <Center>
      <Center className={styles.card} data-testid={'deliverable-reader-file'} gap={12} padding={32}>
        {url && isImageArtifact(artifact) ? (
          <img alt={title} className={styles.image} src={url} />
        ) : (
          <Icon icon={deliverableIconOf(artifact)} size={28} />
        )}
        <Text fontSize={15} weight={600}>
          {title}
        </Text>
        {meta.length > 0 && (
          <Text fontSize={13} type={'secondary'}>
            {meta.join(' · ')}
          </Text>
        )}
        {url ? (
          <Button download href={url} icon={Download} rel={'noopener noreferrer'} target={'_blank'}>
            {t('goalProcess.result.deliverables.reader.download')}
          </Button>
        ) : (
          <Text fontSize={13} type={'secondary'}>
            {t('goalProcess.result.deliverables.reader.noUrl')}
          </Text>
        )}
      </Center>
    </Center>
  );
};

const Header = ({
  index,
  item,
  onIndexChange,
  total,
}: {
  index: number;
  item: DeliverableItem;
  onIndexChange: (index: number) => void;
  total: number;
}) => {
  const { t } = useTranslation('chat');
  const { text, title } = useActivityTime(item.artifact.createdAt);
  const cited = item.citedBy.length > 0;

  return (
    <Flexbox horizontal align={'center'} className={styles.header} gap={16}>
      <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
        <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
          <Text ellipsis data-testid={'deliverable-reader-title'} fontSize={15} weight={600}>
            {deliverableTitleOf(item.artifact, t('goalProcess.deliverables.untitled'))}
          </Text>
          {item.primary && <Tag color={'blue'}>{t('goalProcess.result.deliverables.primary')}</Tag>}
          <Tag color={cited ? 'success' : undefined}>
            {cited
              ? t('goalProcess.result.deliverables.reader.cited')
              : t('goalProcess.result.deliverables.reader.uncited')}
          </Tag>
        </Flexbox>
        <Text ellipsis fontSize={12} title={title} type={'secondary'}>
          {[
            item.producerTitle &&
              t('goalProcess.result.deliverables.producedBy', { title: item.producerTitle }),
            text,
            cited &&
              t('goalProcess.result.deliverables.reader.supports', {
                criteria: item.citedBy.map((criterion) => criterion.title).join('；'),
              }),
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </Flexbox>
      <Text data-testid={'deliverable-reader-position'} fontSize={13} type={'secondary'}>
        {`${index + 1} / ${total}`}
      </Text>
      <ActionIcon
        disabled={index === 0}
        icon={ArrowLeft}
        title={t('goalProcess.result.deliverables.reader.prev')}
        onClick={() => onIndexChange(index - 1)}
      />
      <ActionIcon
        disabled={index === total - 1}
        icon={ArrowRight}
        title={t('goalProcess.result.deliverables.reader.next')}
        onClick={() => onIndexChange(index + 1)}
      />
    </Flexbox>
  );
};

interface DeliverableReaderProps {
  index: number;
  items: DeliverableItem[];
  onClose: () => void;
  onIndexChange: (index: number) => void;
}

const DeliverableReader = ({ index, items, onClose, onIndexChange }: DeliverableReaderProps) => {
  const { t } = useTranslation('chat');
  // Portal into the themed app root: the theme's CSS variables live there, and
  // a node mounted straight on <body> renders without them.
  const appElement = useAppElement();
  const overlayRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const current = items[Math.min(index, items.length - 1)];

  // Keep the current item in view as ←/→ walk past the fold.
  useEffect(() => {
    sidebarRef.current
      ?.querySelector('[aria-current="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  // Take focus on open so the keys reach the reader, and hand it back to
  // whatever opened it on close.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    overlayRef.current?.focus();
    return () => opener?.focus?.();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      } else if (event.key === 'ArrowRight' && index < items.length - 1) {
        event.preventDefault();
        onIndexChange(index + 1);
      } else if (event.key === 'ArrowLeft' && index > 0) {
        event.preventDefault();
        onIndexChange(index - 1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [index, items.length, onClose, onIndexChange]);

  if (!current) return null;

  return createPortal(
    <div
      aria-label={t('goalProcess.result.deliverables.reader.label')}
      aria-modal={true}
      className={styles.overlay}
      data-testid={'deliverable-reader'}
      ref={overlayRef}
      role={'dialog'}
      tabIndex={-1}
    >
      <Flexbox className={styles.sidebar} gap={4} ref={sidebarRef}>
        <Flexbox
          horizontal
          align={'center'}
          justify={'space-between'}
          paddingBlock={4}
          paddingInline={10}
        >
          <Text weight={600}>
            {t('goalProcess.result.deliverables.titleWithCount', { count: items.length })}
          </Text>
          <ActionIcon
            icon={X}
            size={'small'}
            title={t('goalProcess.result.deliverables.reader.close')}
            onClick={onClose}
          />
        </Flexbox>
        {items.map((item, itemIndex) => (
          <SidebarItem
            active={itemIndex === index}
            item={item}
            key={item.artifact.workVersionId}
            onClick={() => onIndexChange(itemIndex)}
          />
        ))}
      </Flexbox>
      <Flexbox flex={1} style={{ minWidth: 0 }}>
        <Header index={index} item={current} total={items.length} onIndexChange={onIndexChange} />
        <div className={styles.body}>
          {/* The reader covers the page it was opened from, so a detail opened
              in a side panel would be invisible — entity links navigate. */}
          <EntityLinkHostProvider portal={false}>
            <Body item={current} key={current.artifact.workVersionId} />
          </EntityLinkHostProvider>
        </div>
      </Flexbox>
    </div>,
    appElement ?? document.body,
  );
};

export default DeliverableReader;
