import {
  formatSelfReviewKindLabel,
  getSelfReviewBriefLead,
  type SelfReviewBriefDetails as SelfReviewBriefDetailsModel,
  type SelfReviewProposalContentItem,
} from '@lobechat/agent-signal/brief';
import { Button, createStaticStyles, Flexbox, Text } from '@lobehub/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { homeType } from '@/features/Home/components/homeType';

import { createSelfReviewProposalModal } from './SelfReviewProposalModal';
import { useSelfReviewTranslator } from './useSelfReviewBriefView';

/** Rows shown before the rest fold behind "N more". */
export const SELF_REVIEW_VISIBLE_ROWS = 3;

const styles = createStaticStyles(({ css, cssVar }) => ({
  kind: css`
    flex: none;

    padding-block: 0;
    padding-inline: 6px;
    border-radius: ${cssVar.borderRadiusXS};

    font-size: 12px;
    line-height: 20px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
  more: css`
    align-self: flex-start;
    height: auto;
    padding: 0;
    color: ${cssVar.colorTextTertiary};
  `,
  rowDescription: css`
    color: ${cssVar.colorTextTertiary};
  `,
  rowTarget: css`
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};
  `,
}));

interface SelfReviewBriefDetailsProps {
  /** Display name of the agent the proposal is for. */
  agentName?: string;
  /** Full proposal content; when present, a "View details" button opens it. */
  content?: SelfReviewProposalContentItem[];
  details: SelfReviewBriefDetailsModel;
}

/**
 * What a nightly self-review brief proposes, inline on the card: which agent it
 * is for, a one- or two-line lead, and — when it holds several changes or
 * ideas — one row per change (kind · target — why), folded past three rows.
 */
const SelfReviewBriefDetails = ({ agentName, content, details }: SelfReviewBriefDetailsProps) => {
  const { t } = useTranslation('home');
  const [expanded, setExpanded] = useState(false);
  const translate = useSelfReviewTranslator();

  // The title line is cut to one line, so a lone titleless idea still repeats
  // its full rationale here.
  const items = details.items ?? [];
  const lead =
    getSelfReviewBriefLead(details) ?? (items.length === 1 ? items[0].description : undefined);
  const showRows = items.length > 1;
  const rows = expanded || !showRows ? items : items.slice(0, SELF_REVIEW_VISIBLE_ROWS);
  const hidden = items.length - rows.length;

  return (
    <Flexbox gap={6}>
      {agentName && (
        <span className={homeType.meta}>
          {t('brief.agentSignal.selfReview.details.forAgent', { agent: agentName })}
        </span>
      )}
      {lead && (
        <Text className={homeType.supporting} ellipsis={{ rows: 2 }}>
          {lead}
        </Text>
      )}
      {showRows && (
        <Flexbox as={'ul'} gap={4} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {rows.map((item, index) => {
            // A titleless idea is all rationale: show it once, as the row's text.
            const target = item.target ?? (item.kind === 'idea' ? item.description : undefined);
            const description = target === item.description ? undefined : item.description;

            return (
              <Flexbox
                horizontal
                align={'center'}
                as={'li'}
                gap={8}
                key={index}
                style={{ minWidth: 0 }}
              >
                <span className={styles.kind}>
                  {formatSelfReviewKindLabel(item.kind, translate)}
                </span>
                <Text ellipsis className={homeType.supporting} style={{ flex: 1, minWidth: 0 }}>
                  {target && <span className={styles.rowTarget}>{target}</span>}
                  {target && description && ' — '}
                  {description && <span className={styles.rowDescription}>{description}</span>}
                </Text>
              </Flexbox>
            );
          })}
        </Flexbox>
      )}
      {(hidden > 0 || content) && (
        <Flexbox horizontal align={'center'} gap={12}>
          {hidden > 0 && (
            <Button
              className={styles.more}
              size={'small'}
              type={'text'}
              onClick={() => setExpanded(true)}
            >
              {t('brief.agentSignal.selfReview.list.more', { count: String(hidden) })}
            </Button>
          )}
          {content && (
            <Button
              className={styles.more}
              size={'small'}
              type={'text'}
              onClick={() => createSelfReviewProposalModal(content)}
            >
              {t('brief.agentSignal.selfReview.detail.open')}
            </Button>
          )}
        </Flexbox>
      )}
    </Flexbox>
  );
};

export default SelfReviewBriefDetails;
