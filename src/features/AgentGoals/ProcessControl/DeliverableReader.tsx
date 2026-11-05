'use client';

import { formatSize } from '@lobechat/utils/format';
import {
  ActionIcon,
  Button,
  Center,
  Flexbox,
  Icon,
  Markdown,
  Skeleton,
  Tag,
  Text,
  useAppElement,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArrowLeft, ArrowRight, Download, ExternalLink, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { EntityLinkHostProvider, useEntityMarkdown } from '@/features/EntityLink';
import { isSafeExternalUrl } from '@/features/Work/descriptors';
import { useActivityTime } from '@/hooks/useActivityTime';
import { useDocumentStore } from '@/store/document';

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

const styles = stylex.create({
  body: {
    overflow: 'auto',
    flex: '1',
    minHeight: '0',
    paddingBlockStart: '32px',
    paddingBlockEnd: '64px',
    paddingInline: '48px',
  },
  card: {
    width: '100%',
    maxWidth: '640px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  doc: { width: '100%', maxWidth: '760px', marginInline: 'auto' },
  header: {
    flex: 'none',
    paddingBlock: '12px',
    paddingInline: '24px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
  image: {
    maxWidth: '100%',
    maxHeight: '60vh',
    borderRadius: cssVar.borderRadius,
    objectFit: 'contain',
  },
  item: {
    cursor: 'pointer',
    display: 'flex',
    gap: '10px',
    alignItems: 'center',
    width: '100%',
    paddingBlock: '8px',
    paddingInline: '10px',
    borderStyle: 'none',
    borderRadius: cssVar.borderRadius,
    textAlign: 'start',
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': 'none', ':hover': 'none' },
    outlineWidth: { 'default': null, ':focus-visible': '2px' },
    outlineStyle: { 'default': null, ':focus-visible': 'solid' },
    outlineColor: { 'default': null, ':focus-visible': cssVar.colorPrimary },
    outlineOffset: { 'default': null, ':focus-visible': '-2px' },
  },
  itemActive: {
    backgroundColor: { 'default': cssVar.colorFillSecondary, ':hover': cssVar.colorFillSecondary },
    backgroundImage: { 'default': 'none', ':hover': 'none' },
  },
  overlay: {
    position: 'fixed',
    zIndex: 1000,
    inset: '0',
    display: 'flex',
    flexDirection: 'row',
    backgroundColor: cssVar.colorBgLayout,
    backgroundImage: 'none',
    outlineStyle: { 'default': null, ':focus': 'none' },
  },
  sidebar: {
    overflow: 'auto',
    flex: 'none',
    width: '320px',
    padding: '12px',
    borderInlineEndWidth: '1px',
    borderInlineEndStyle: 'solid',
    borderInlineEndColor: cssVar.colorBorderSecondary,
  },
});

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
      {...stylex.props(styles.item, active && styles.itemActive)}
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
  const useFetchDocumentDetail = useDocumentStore((s) => s.useFetchDocumentDetail);
  const { data: document, isHydrated, isLoading } = useFetchDocumentDetail(documentId);

  if (isLoading && !isHydrated) return null;
  if (isLoading)
    return (
      <Flexbox
        className={stylex.props(styles.doc).className}
        data-testid={'deliverable-reader-loading'}
        gap={12}
      >
        <Skeleton height={28} radius={4} width={'50%'} />
        <Skeleton height={14} radius={4} />
        <Skeleton height={14} radius={4} />
        <Skeleton height={14} radius={4} width={'70%'} />
      </Flexbox>
    );

  return (
    <div {...stylex.props(styles.doc)} data-testid={'deliverable-reader-document'}>
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
          className={stylex.props(styles.card).className}
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
      <Center
        className={stylex.props(styles.card).className}
        data-testid={'deliverable-reader-file'}
        gap={12}
        padding={32}
      >
        {url && isImageArtifact(artifact) ? (
          <img alt={title} {...stylex.props(styles.image)} src={url} />
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
    <Flexbox horizontal align={'center'} className={stylex.props(styles.header).className} gap={16}>
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
      {...stylex.props(styles.overlay)}
      data-testid={'deliverable-reader'}
      ref={overlayRef}
      role={'dialog'}
      tabIndex={-1}
    >
      <Flexbox className={stylex.props(styles.sidebar).className} gap={4} ref={sidebarRef}>
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
        <div {...stylex.props(styles.body)}>
          {/* The reader covers the page it was opened from, so a detail opened
              in a side panel would be invisible — entity links navigate. */}
          <EntityLinkHostProvider portal={false} onDismiss={onClose}>
            <Body item={current} key={current.artifact.workVersionId} />
          </EntityLinkHostProvider>
        </div>
      </Flexbox>
    </div>,
    appElement ?? document.body,
  );
};

export default DeliverableReader;
