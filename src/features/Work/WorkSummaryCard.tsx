'use client';

import type { WorkSummaryItem } from '@lobechat/types';
import { formatUsageValue } from '@lobechat/utils';
import { Center, Flexbox, Icon as LobeIcon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { type StyleXStyles } from '@stylexjs/stylex';
import { CircleDollarSignIcon, CoinsIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { sx } from '@/styles/sx';
import { getWorkVersionTotalTokens } from '@/utils/workCumulativeUsage';
import { formatWorkVersionCost } from '@/utils/workVersionCost';

import CanvasWorkCard from './CanvasWorkCard';
import { getWorkTypeDescriptor, isSafeExternalUrl } from './descriptors';
import { useResourceDeletedPrompt } from './useResourceDeletedPrompt';

const styles = stylex.create({
  card: {
    overflow: 'hidden',
    width: '100%',
    paddingBlock: '12px',
    paddingInline: '12px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorBgElevated,
    backgroundImage: 'none',
  },
  clickable: {
    cursor: 'pointer',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillQuaternary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  cost: {
    flexShrink: 0,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
  },
  description: { minWidth: '0', color: cssVar.colorTextTertiary },
  identifier: { flexShrink: 0, color: cssVar.colorTextTertiary },
  icon: {
    flexShrink: 0,
    width: '36px',
    height: '36px',
    borderRadius: '8px',
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
  inline: {
    overflow: 'hidden',
    width: '100%',
    paddingBlock: '8px',
    paddingInline: '8px',
    borderRadius: '6px',
    transition: 'background-color 0.12s ease',
  },
  inlineClickable: {
    cursor: 'pointer',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  inlineCost: {
    flexShrink: 0,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '11px',
    color: cssVar.colorTextTertiary,
  },
  inlineDescription: {
    flexGrow: '1',
    flexShrink: '1',
    flexBasis: '0',
    minWidth: '0',
    fontSize: '11px',
    color: cssVar.colorTextTertiary,
  },
  inlineDot: { flexShrink: 0, fontSize: '11px', color: cssVar.colorTextQuaternary },
  inlineMeta: { minWidth: 0 },
  inlineIdentifier: {
    flexGrow: '0',
    flexShrink: '0',
    flexBasis: 'auto',
    maxWidth: '70%',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '11px',
    color: cssVar.colorTextTertiary,
  },
  inlineIcon: { flexShrink: 0, color: cssVar.colorTextSecondary },
  inlineTitle: { minWidth: '0', fontSize: '13px', fontWeight: 500 },
  title: { minWidth: '0', fontSize: '15px', fontWeight: 500 },
});

interface WorkSummaryCardProps {
  /** Appended after the card's own classes; use `xstyle` to override its StyleX rules. */
  className?: string;
  item: WorkSummaryItem;
  /**
   * Override the click target. The default opens the chat portal (task detail /
   * document), which only renders inside the conversation UI; surfaces without
   * that portal (e.g. the resource page's 产物 gallery) pass their own
   * navigation here. Only ever receives a clickable, non-orphaned item — the
   * card still gates clickability on external-url presence and routes
   * resource-deleted items to the deleted notice before reaching this.
   */
  onOpen?: (item: WorkSummaryItem) => void;
  /**
   * `card` (default) renders the elevated 36×36 icon-box layout used across the
   * chat portal and the works gallery. `inline` renders a flat row (17px icon,
   * 6px hover fill) for the WorkingSidebar Overview, so a shared card doesn't
   * dictate the flat sidebar's visual vocabulary.
   */
  variant?: 'card' | 'inline';
  /** Restyle the card; applied after its own StyleX rules so it wins. */
  xstyle?: StyleXStyles;
}

const WorkSummaryCard = memo<WorkSummaryCardProps>(
  ({ className, item, onOpen, variant = 'card', xstyle }) => {
    const { t } = useTranslation('chat');
    const openCanvas = useChatStore((s) => s.openCanvas);
    const openDocument = useChatStore((s) => s.openDocument);
    const openFilePreview = useChatStore((s) => s.openFilePreview);
    const openTaskDetail = useChatStore((s) => s.openTaskDetail);
    const promptResourceDeleted = useResourceDeletedPrompt();
    const cost = formatWorkVersionCost(item.totalCost);
    const totalTokens = getWorkVersionTotalTokens(item.event.cumulativeUsage);
    const usage = cost
      ? { icon: CircleDollarSignIcon, value: cost.slice(1) }
      : totalTokens
        ? { icon: CoinsIcon, value: formatUsageValue(totalTokens) }
        : null;
    const usageTitle = cost
      ? t('workingPanel.works.totalCost', { cost })
      : totalTokens
        ? `${totalTokens.toLocaleString()} ${t('opStatusTray.tokens')}`
        : undefined;

    const descriptor = getWorkTypeDescriptor(item);
    const Icon = descriptor.getIcon(item);
    const title =
      descriptor.getTitle(item)?.trim() ||
      descriptor.getIdentifier(item) ||
      item.resourceId ||
      item.id;
    // Mirrors WorkVersionHistoryCard's label: surface the resource identifier
    // (e.g. `QA-1989`, `owner/repo#2`) on the card itself, unless the title
    // already fell back to it.
    const identifier = descriptor.getIdentifier(item);
    const showIdentifier = !!identifier && identifier !== title;
    const description = descriptor.getDescription(item);
    const openTarget = descriptor.getOpenTarget(item);
    // The backing resource (task / document) was deleted outside the tool path:
    // the Work lingers as an orphan rendered from its snapshot, and opening the
    // gone resource 404s. The card keeps its normal look and a click explains
    // that the resource is gone and offers to remove the card.
    const resourceDeleted = item.resourceDeleted;
    const clickable = !!openTarget;

    const handleOpen = () => {
      if (resourceDeleted) {
        promptResourceDeleted(item);
        return;
      }
      if (onOpen) {
        onOpen(item);
        return;
      }
      if (!openTarget) return;

      switch (openTarget.kind) {
        case 'canvas': {
          openCanvas(openTarget.canvasId, openTarget.version);
          return;
        }
        case 'document': {
          openDocument(openTarget.documentId, openTarget.agentDocumentId);
          return;
        }
        case 'external': {
          // Defense in depth: only ever hand http(s) to shell.openExternal.
          if (isSafeExternalUrl(openTarget.url))
            window.open(openTarget.url, '_blank', 'noopener,noreferrer');
          return;
        }
        case 'filePreview': {
          openFilePreview({ fileId: openTarget.fileId });
          return;
        }
        case 'task': {
          openTaskDetail(openTarget.taskId);
        }
      }
    };

    if (item.type === 'canvas' && variant === 'card') {
      return (
        <CanvasWorkCard
          className={className}
          item={item}
          onOpen={clickable ? handleOpen : undefined}
        />
      );
    }

    if (variant === 'inline') {
      return (
        <Flexbox
          horizontal
          align={'center'}
          {...sx([styles.inline, clickable && styles.inlineClickable, xstyle], className)}
          gap={10}
          onClick={clickable ? handleOpen : undefined}
        >
          <Icon className={stylex.props(styles.inlineIcon).className} size={17} />
          {/* The sidebar is narrow: the title owns the first line (sharing it only
              with the short usage badge), and the identifier drops to the meta line
              with the description so a long `owner/repo#n` can't squeeze the title. */}
          <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
            <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
              <Text
                ellipsis
                className={stylex.props(styles.inlineTitle).className}
                style={{ flex: 1 }}
                title={title}
              >
                {title}
              </Text>
              {usage && (
                <Center
                  horizontal
                  className={stylex.props(styles.inlineCost).className}
                  gap={2}
                  title={usageTitle}
                >
                  <LobeIcon icon={usage.icon} />
                  {usage.value}
                </Center>
              )}
            </Flexbox>
            {(showIdentifier || description) && (
              <Flexbox
                horizontal
                align={'center'}
                className={stylex.props(styles.inlineMeta).className}
                gap={4}
              >
                {showIdentifier && (
                  <Text
                    ellipsis
                    className={stylex.props(styles.inlineIdentifier).className}
                    title={identifier}
                  >
                    {identifier}
                  </Text>
                )}
                {showIdentifier && description && (
                  <span className={stylex.props(styles.inlineDot).className}>·</span>
                )}
                {description && (
                  <Text
                    ellipsis
                    className={stylex.props(styles.inlineDescription).className}
                    title={description}
                  >
                    {description}
                  </Text>
                )}
              </Flexbox>
            )}
          </Flexbox>
        </Flexbox>
      );
    }

    return (
      <Flexbox
        horizontal
        align={'center'}
        {...sx([styles.card, clickable && styles.clickable, xstyle], className)}
        gap={12}
        onClick={clickable ? handleOpen : undefined}
      >
        <Flexbox
          align={'center'}
          className={stylex.props(styles.icon).className}
          justify={'center'}
        >
          <Icon size={18} />
        </Flexbox>
        <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
          <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
            <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
              <Text ellipsis className={stylex.props(styles.title).className}>
                {title}
              </Text>
              {showIdentifier && (
                <Text code className={stylex.props(styles.identifier).className} fontSize={12}>
                  {identifier}
                </Text>
              )}
            </Flexbox>
            {usage && (
              <Center
                horizontal
                className={stylex.props(styles.cost).className}
                gap={2}
                title={usageTitle}
              >
                <LobeIcon icon={usage.icon} />
                {usage.value}
              </Center>
            )}
          </Flexbox>
          {description && (
            <Text ellipsis className={stylex.props(styles.description).className} fontSize={12}>
              {description}
            </Text>
          )}
        </Flexbox>
      </Flexbox>
    );
  },
);

WorkSummaryCard.displayName = 'WorkSummaryCard';

export default WorkSummaryCard;
