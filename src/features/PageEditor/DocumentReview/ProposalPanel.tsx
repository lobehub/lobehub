'use client';

import { Block, Button, Checkbox, cssVar, Flexbox, Tag, Text } from '@lobehub/ui';
import { SparklesIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ProposedRuleDraft } from '@/services/documentReview';

import type { ReviewAction } from './types';

interface ProposalPanelProps {
  canWrite: boolean;
  onAdopt: (drafts: ProposedRuleDraft[]) => void;
  onDiscard: () => void;
  pendingAction: ReviewAction | null;
  proposals: ProposedRuleDraft[];
}

/**
 * Agent-proposed rules stay a proposal until the reader ticks and adopts them:
 * nothing is written to the document's rule library on generation.
 */
const ProposalPanel = memo<ProposalPanelProps>(
  ({ canWrite, onAdopt, onDiscard, pendingAction, proposals }) => {
    const { t } = useTranslation('file');
    const [selected, setSelected] = useState<number[]>(() => proposals.map((_, index) => index));

    const toggle = (index: number) =>
      setSelected((current) =>
        current.includes(index) ? current.filter((item) => item !== index) : [...current, index],
      );

    const selectedDrafts = proposals.filter((_, index) => selected.includes(index));

    return (
      <Flexbox
        gap={8}
        paddingBlock={10}
        paddingInline={12}
        style={{ borderBlockEnd: `1px solid ${cssVar.colorSplit}` }}
      >
        <Flexbox gap={2}>
          <Flexbox horizontal align={'center'} gap={6}>
            <SparklesIcon size={14} />
            <Text fontSize={14} weight={500}>
              {t('pageEditor.review.rules.proposalTitle')}
            </Text>
            <Text fontSize={12} type={'secondary'}>
              {proposals.length}
            </Text>
          </Flexbox>
          <Text fontSize={12} type={'secondary'}>
            {t('pageEditor.review.rules.proposalDesc')}
          </Text>
        </Flexbox>

        <Flexbox gap={4}>
          {proposals.map((draft, index) => (
            <Block
              clickable
              gap={4}
              key={`${draft.title}-${index}`}
              paddingBlock={6}
              paddingInline={8}
              style={{ border: `1px solid ${cssVar.colorBorderSecondary}`, borderRadius: 6 }}
              variant={'borderless'}
              onClick={() => toggle(index)}
            >
              <Flexbox horizontal align={'center'} gap={6}>
                <Checkbox checked={selected.includes(index)} onChange={() => toggle(index)} />
                <Text fontSize={12} style={{ flex: 1, minWidth: 0 }} weight={500}>
                  {draft.title}
                </Text>
                {draft.duplicate && (
                  <Tag size={'small'} variant={'borderless'}>
                    {t('pageEditor.review.rules.proposalDuplicate')}
                  </Tag>
                )}
                <Tag size={'small'} variant={'borderless'}>
                  {t(`pageEditor.review.check.severity.${draft.severity}` as any)}
                </Tag>
              </Flexbox>
              <Text fontSize={12} style={{ lineHeight: 1.6 }} type={'secondary'}>
                {draft.instruction}
              </Text>
              {draft.rationale && (
                <Text fontSize={12} type={'secondary'}>
                  {t('pageEditor.review.rules.proposalRationale')} · {draft.rationale}
                </Text>
              )}
              {draft.sourceHint?.quote && (
                <Text fontSize={12} type={'secondary'}>
                  {t('pageEditor.review.rules.proposalSource')} · {draft.sourceHint.quote}
                </Text>
              )}
            </Block>
          ))}
        </Flexbox>

        <Flexbox horizontal gap={4}>
          <Button
            disabled={!canWrite || selectedDrafts.length === 0}
            loading={pendingAction === 'adoptRules'}
            size={'small'}
            type={'primary'}
            onClick={() => onAdopt(selectedDrafts)}
          >
            {t('pageEditor.review.action.adopt', { selected: selectedDrafts.length })}
          </Button>
          <Button size={'small'} type={'text'} onClick={onDiscard}>
            {t('pageEditor.review.action.discardProposals')}
          </Button>
        </Flexbox>
      </Flexbox>
    );
  },
);

ProposalPanel.displayName = 'ReviewProposalPanel';

export default ProposalPanel;
