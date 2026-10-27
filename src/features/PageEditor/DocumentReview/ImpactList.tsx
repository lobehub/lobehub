'use client';

import type { DocumentReviewTextAnchor } from '@lobechat/types';
import { Button, cssVar, Flexbox, Tag, Text } from '@lobehub/ui';
import { MessageSquareIcon, MoveUpRightIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { DocumentReviewImpactItem } from '@/services/documentReview';

import ReviewQuote from './ReviewQuote';
import { formatConfidence, groupImpacts, IMPACT_KIND_LABEL_KEY } from './utils';

interface ImpactItemProps {
  canWrite: boolean;
  impact: DocumentReviewImpactItem;
  onAsk: (impact: DocumentReviewImpactItem) => void;
  onJump: (anchor?: DocumentReviewTextAnchor | null) => boolean;
}

const ImpactItem = memo<ImpactItemProps>(({ canWrite, impact, onAsk, onJump }) => {
  const { t } = useTranslation('file');
  const confidence = formatConfidence(impact.confidence);
  const hasAnchor = Boolean(impact.sourceAnchor?.quote || impact.relatedAnchor?.quote);
  const canJumpSource = Boolean(impact.sourceAnchor?.quote) && !impact.sourceAnchor?.invalid;
  const canJumpRelated = Boolean(impact.relatedAnchor?.quote) && !impact.relatedAnchor?.invalid;

  return (
    <Flexbox
      gap={6}
      paddingBlock={10}
      paddingInline={12}
      style={{ borderBlockEnd: `1px solid ${cssVar.colorSplit}` }}
    >
      <Flexbox horizontal align={'flex-start'} gap={8}>
        <Tag size={'small'} style={{ marginBlockStart: 2 }} variant={'borderless'}>
          {t(IMPACT_KIND_LABEL_KEY[impact.kind] as any)}
        </Tag>
        <Text style={{ flex: 1, fontSize: 14, fontWeight: 500, lineHeight: 1.5 }} weight={500}>
          {impact.title}
        </Text>
        {confidence && (
          <Text fontSize={12} style={{ whiteSpace: 'nowrap' }} type={'secondary'}>
            {t('pageEditor.review.impact.confidence', { value: confidence })}
          </Text>
        )}
      </Flexbox>

      <ReviewQuote
        anchor={impact.sourceAnchor}
        label={t('pageEditor.review.impact.trigger')}
        onJump={() => onJump(impact.sourceAnchor)}
      />
      <ReviewQuote
        anchor={impact.relatedAnchor}
        label={impact.relatedAnchor?.label || t('pageEditor.review.impact.related')}
        onJump={() => onJump(impact.relatedAnchor)}
      />

      <Flexbox gap={2}>
        <Text fontSize={12} type={'secondary'}>
          {t('pageEditor.review.impact.reason')}
        </Text>
        <Text fontSize={12} style={{ lineHeight: 1.6 }} type={'secondary'}>
          {impact.reason}
        </Text>
      </Flexbox>

      <Flexbox horizontal align={'center'} gap={2}>
        <Button
          disabled={!hasAnchor || (!canJumpSource && !canJumpRelated)}
          icon={MoveUpRightIcon}
          size={'small'}
          type={'text'}
          onClick={() => {
            if (canJumpSource) {
              if (!onJump(impact.sourceAnchor)) onJump(impact.relatedAnchor);
            } else {
              onJump(impact.relatedAnchor);
            }
          }}
        >
          {t('pageEditor.review.impact.jump')}
        </Button>
        {canWrite && (
          <Button
            icon={MessageSquareIcon}
            size={'small'}
            type={'text'}
            onClick={() => onAsk(impact)}
          >
            {t('pageEditor.review.impact.ask')}
          </Button>
        )}
      </Flexbox>
    </Flexbox>
  );
});

ImpactItem.displayName = 'ReviewImpactItem';

interface ImpactListProps {
  canWrite: boolean;
  impacts: DocumentReviewImpactItem[];
  onAsk: (impact: DocumentReviewImpactItem) => void;
  onJump: (anchor?: DocumentReviewTextAnchor | null) => boolean;
}

/**
 * Change impacts, split into the two questions a reviewer actually asks:
 * "what wording changed" and "what else may this mean". Group headers count
 * their items and stay pinned while the list scrolls.
 */
const ImpactList = memo<ImpactListProps>(({ canWrite, impacts, onAsk, onJump }) => {
  const { t } = useTranslation('file');
  const groups = groupImpacts(impacts);

  return (
    <Flexbox>
      {groups.map((group) => (
        <Flexbox key={group.category}>
          <Flexbox
            horizontal
            align={'baseline'}
            gap={6}
            paddingBlock={'8px 4px'}
            paddingInline={12}
            style={{
              position: 'sticky',
              zIndex: 1,
              top: 0,
              borderBlockEnd: `1px solid ${cssVar.colorSplit}`,
              background: cssVar.colorBgContainer,
            }}
          >
            <Text fontSize={12} weight={600}>
              {t(`pageEditor.review.impact.${group.category}.title` as any)}
            </Text>
            <Text fontSize={12} type={'secondary'}>
              {group.items.length}
            </Text>
            <Text ellipsis fontSize={12} style={{ flex: 1, minWidth: 0 }} type={'secondary'}>
              {t(`pageEditor.review.impact.${group.category}.desc` as any)}
            </Text>
          </Flexbox>
          {group.items.map((impact) => (
            <ImpactItem
              canWrite={canWrite}
              impact={impact}
              key={impact.id}
              onAsk={onAsk}
              onJump={onJump}
            />
          ))}
        </Flexbox>
      ))}
    </Flexbox>
  );
});

ImpactList.displayName = 'ReviewImpactList';

export default ImpactList;
