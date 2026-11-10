'use client';

import type { WorkSummaryItem } from '@lobechat/types';
import { formatUsageValue } from '@lobechat/utils';
import { Center, createStaticStyles, cx, Flexbox, Icon as LobeIcon, Text } from '@lobehub/ui';
import { CircleDollarSignIcon, CoinsIcon, GitBranchIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { getWorkVersionTotalTokens } from '@/utils/workCumulativeUsage';
import { formatWorkVersionCost } from '@/utils/workVersionCost';

import CanvasWorkCard from './CanvasWorkCard';
import { getWorkTypeDescriptor, type WorkBranch, type WorkIcon } from './descriptors';
import { openExternalWork } from './openExternalWork';
import { useResourceDeletedPrompt } from './useResourceDeletedPrompt';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    overflow: hidden;

    width: 100%;
    padding-block: 12px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgElevated};
  `,
  clickable: css`
    cursor: pointer;

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  branch: css`
    flex: 1 1 0;
    min-width: 0;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  cost: css`
    flex-shrink: 0;
    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  description: css`
    flex: 1 1 0;
    min-width: 0;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  dot: css`
    flex-shrink: 0;
    font-size: 12px;
    color: ${cssVar.colorTextQuaternary};
  `,
  identifier: css`
    /* The short resource key keeps its width; the branch / description truncates first. */
    flex: 0 0 auto;

    max-width: 60%;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  identifierIcon: css`
    flex-shrink: 0;
  `,
  icon: css`
    flex-shrink: 0;

    width: 36px;
    height: 36px;
    border-radius: 8px;

    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
  inlineBranch: css`
    flex: 1 1 0;
    min-width: 0;
    font-size: 11px;
    color: ${cssVar.colorTextTertiary};
  `,
  inline: css`
    overflow: hidden;

    width: 100%;
    padding-block: 8px;
    padding-inline: 8px;
    border-radius: 6px;

    transition: background-color 0.12s ease;
  `,
  inlineClickable: css`
    cursor: pointer;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  inlineCost: css`
    flex-shrink: 0;
    font-family: ${cssVar.fontFamilyCode};
    font-size: 11px;
    color: ${cssVar.colorTextTertiary};
  `,
  inlineDescription: css`
    flex: 1 1 0;
    min-width: 0;
    font-size: 11px;
    color: ${cssVar.colorTextTertiary};
  `,
  inlineDot: css`
    flex-shrink: 0;
    font-size: 11px;
    color: ${cssVar.colorTextQuaternary};
  `,
  inlineIdentifier: css`
    /* The short resource key keeps its width; the long description truncates first. */
    flex: 0 0 auto;

    max-width: 70%;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 11px;
    color: ${cssVar.colorTextTertiary};
  `,
  meta: css`
    min-width: 0;
  `,
  /** Monospace text inside an identifier / branch group, truncating within it. */
  metaText: css`
    min-width: 0;
    font-family: ${cssVar.fontFamilyCode};
    font-size: inherit;
    color: inherit;
  `,
  inlineIcon: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextSecondary};
  `,
  inlineTitle: css`
    min-width: 0;
    font-size: 13px;
    font-weight: 500;
  `,
  title: css`
    min-width: 0;
    font-size: 15px;
    font-weight: 500;
  `,
}));

interface WorkMetaLineProps {
  branch: WorkBranch | null;
  description: string | null;
  /** `null` when the title already fell back to it. */
  identifier: string | null;
  /** Brand mark before the identifier (GitHub), see `getIdentifierIcon`. */
  identifierIcon: WorkIcon | null;
  variant: 'card' | 'inline';
}

/**
 * The second line of both variants: the resource key, then the PR's head
 * branch, or the description when no branch is known. Keeping the key here
 * leaves the first line to the title, so a long `owner/repo#n` can't squeeze it.
 */
const WorkMetaLine = ({
  branch,
  description,
  identifier,
  identifierIcon: IdentifierIcon,
  variant,
}: WorkMetaLineProps) => {
  const inline = variant === 'inline';
  const detail = branch ? branch.head : description;
  if (!identifier && !detail) return null;

  return (
    <Flexbox horizontal align={'center'} className={styles.meta} gap={4}>
      {identifier && (
        <Flexbox
          horizontal
          align={'center'}
          className={inline ? styles.inlineIdentifier : styles.identifier}
          gap={3}
          title={identifier}
        >
          {IdentifierIcon && (
            <IdentifierIcon className={styles.identifierIcon} size={inline ? 11 : 12} />
          )}
          <Text ellipsis className={styles.metaText}>
            {identifier}
          </Text>
        </Flexbox>
      )}
      {identifier && detail && <span className={inline ? styles.inlineDot : styles.dot}>·</span>}
      {branch ? (
        <Flexbox
          horizontal
          align={'center'}
          className={inline ? styles.inlineBranch : styles.branch}
          gap={3}
          title={branch.base ? `${branch.head} → ${branch.base}` : branch.head}
        >
          <LobeIcon icon={GitBranchIcon} size={inline ? 11 : 12} />
          <Text ellipsis className={styles.metaText}>
            {branch.head}
          </Text>
        </Flexbox>
      ) : (
        description && (
          <Text
            ellipsis
            className={inline ? styles.inlineDescription : styles.description}
            title={description}
          >
            {description}
          </Text>
        )
      )}
    </Flexbox>
  );
};

interface WorkSummaryCardProps {
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
}

const WorkSummaryCard = memo<WorkSummaryCardProps>(
  ({ className, item, onOpen, variant = 'card' }) => {
    const { t } = useTranslation('chat');
    const { t: tTopic } = useTranslation('topic');
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
    const stateLabelKey = descriptor.getStateLabelKey?.(item);
    const stateLabel = stateLabelKey ? tTopic(stateLabelKey) : undefined;
    const title =
      descriptor.getTitle(item)?.trim() ||
      descriptor.getIdentifier(item) ||
      item.resourceId ||
      item.id;
    // Mirrors WorkVersionHistoryCard's label: surface the resource identifier
    // (e.g. `QA-1989`, `owner/repo#2`) on the card itself, unless the title
    // already fell back to it.
    const identifier = descriptor.getIdentifier(item);
    const metaIdentifier = identifier && identifier !== title ? identifier : null;
    const identifierIcon = descriptor.getIdentifierIcon?.(item) ?? null;
    const branch = descriptor.getBranch?.(item) ?? null;
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
          openExternalWork(openTarget.url);
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
          className={cx(styles.inline, clickable && styles.inlineClickable, className)}
          gap={10}
          onClick={clickable ? handleOpen : undefined}
        >
          <Center className={styles.inlineIcon} title={stateLabel}>
            <Icon size={17} />
          </Center>
          <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
            <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
              <Text ellipsis className={styles.inlineTitle} style={{ flex: 1 }} title={title}>
                {title}
              </Text>
              {usage && (
                <Center horizontal className={styles.inlineCost} gap={2} title={usageTitle}>
                  <LobeIcon icon={usage.icon} />
                  {usage.value}
                </Center>
              )}
            </Flexbox>
            <WorkMetaLine
              branch={branch}
              description={description}
              identifier={metaIdentifier}
              identifierIcon={identifierIcon}
              variant={'inline'}
            />
          </Flexbox>
        </Flexbox>
      );
    }

    return (
      <Flexbox
        horizontal
        align={'center'}
        className={cx(styles.card, clickable && styles.clickable, className)}
        gap={12}
        onClick={clickable ? handleOpen : undefined}
      >
        <Flexbox align={'center'} className={styles.icon} justify={'center'} title={stateLabel}>
          <Icon size={18} />
        </Flexbox>
        <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
          <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
            <Text ellipsis className={styles.title} style={{ flex: 1 }} title={title}>
              {title}
            </Text>
            {usage && (
              <Center horizontal className={styles.cost} gap={2} title={usageTitle}>
                <LobeIcon icon={usage.icon} />
                {usage.value}
              </Center>
            )}
          </Flexbox>
          <WorkMetaLine
            branch={branch}
            description={description}
            identifier={metaIdentifier}
            identifierIcon={identifierIcon}
            variant={'card'}
          />
        </Flexbox>
      </Flexbox>
    );
  },
);

WorkSummaryCard.displayName = 'WorkSummaryCard';

export default WorkSummaryCard;
