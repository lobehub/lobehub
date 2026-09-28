'use client';

import { Flexbox, Icon, TextArea } from '@lobehub/ui';
import { Button, Text, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { BadgeCheck } from 'lucide-react';
import { nanoid } from 'nanoid';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { useAcceptanceScope } from '../AcceptanceScope';
import { useAcceptanceBundle } from '../useAcceptanceBundle';
import { canReviewAcceptance } from '../visibility';
import { useAcceptanceComments } from './hooks';

const styles = createStaticStyles(({ css }) => ({
  card: css`
    padding-block: 14px;
    padding-inline: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 12px;

    background: ${cssVar.colorBgContainer};
  `,
  description: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
}));

/**
 * The reviewer's counterpart of the decision bar. A teammate who can review
 * but cannot close the acceptance says "fine by me" here; it lands as an
 * approval row the owner reads, and the acceptance status stays untouched.
 *
 * A visitor who only holds the public link is not offered it: they can answer
 * the evidence in the discussion, but accepting a delivery is the team's call.
 *
 * An approval is never final while the round is open: review is a moving
 * opinion, so it can be withdrawn and given again at any point. Only the state
 * standing when the owner decides matters, and the newest row is that state.
 */
const ReviewerApprovalBar = memo(() => {
  const { t } = useTranslation('verify');
  const { acceptanceId } = useAcceptanceScope();
  const { data } = useAcceptanceBundle(acceptanceId);
  const { canApprove, create, items, remove } = useAcceptanceComments(acceptanceId);
  const viewerId = useUserStore(userProfileSelectors.userId);
  const [summary, setSummary] = useState('');
  const [pending, setPending] = useState(false);

  if (!data || !canApprove || canReviewAcceptance(data)) return null;
  if (data.acceptance.status === 'accepted' || data.acceptance.status === 'closed') return null;

  // Nothing has been delivered yet, so there is nothing to approve. Allowing it
  // would pin the approval to no round at all, and an unpinned approval reads
  // as approving every round that ever arrives — the reviewer would never be
  // asked to look at the evidence.
  const currentRound = data.rounds.at(-1)?.run;
  if (!currentRound) return null;

  // Read ownership from the author. `canDelete` also turns on for someone who
  // may moderate this acceptance, so borrowing it here would show a reviewer
  // their teammate's approval as their own and let them withdraw it.
  const mine = [...items]
    .reverse()
    .find(
      (item) =>
        item.kind === 'approval' &&
        !item.deletedAt &&
        Boolean(viewerId) &&
        item.authorUserId === viewerId,
    );
  const approvedCurrentRound = mine?.contextRoundIndex === currentRound.roundIndex;

  const run = async (action: () => Promise<unknown>) => {
    setPending(true);
    try {
      await action();
      setSummary('');
    } catch (cause) {
      console.error('[acceptance:comments]', cause);
      toast.error(t('acceptance.comments.createFailed'));
    } finally {
      setPending(false);
    }
  };

  const approve = () =>
    run(() =>
      create({
        clientId: nanoid(),
        content: summary.trim(),
        contextRunId: currentRound.id,
        kind: 'approval',
      }),
    );

  return (
    <Flexbox className={styles.card} gap={10}>
      <Flexbox horizontal align={'center'} gap={8}>
        <Icon
          color={approvedCurrentRound ? cssVar.colorSuccess : undefined}
          icon={BadgeCheck}
          size={18}
        />
        <Text weight={600}>
          {mine
            ? mine.contextRoundIndex === null
              ? t('acceptance.comments.youApprovedNoRound')
              : t('acceptance.comments.youApproved', { round: mine.contextRoundIndex })
            : t('acceptance.comments.approve')}
        </Text>
      </Flexbox>
      <span className={styles.description}>
        {approvedCurrentRound
          ? t('acceptance.comments.withdrawDescription')
          : t('acceptance.comments.approveDescription')}
      </span>
      {approvedCurrentRound ? (
        <Button
          loading={pending}
          style={{ alignSelf: 'flex-end' }}
          onClick={() => void run(() => remove(mine!.id))}
        >
          {t('acceptance.comments.withdraw')}
        </Button>
      ) : (
        <Flexbox gap={8}>
          <TextArea
            autoSize={{ maxRows: 4, minRows: 1 }}
            placeholder={t('acceptance.comments.approveSummaryPlaceholder')}
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
          />
          <Button
            loading={pending}
            style={{ alignSelf: 'flex-end' }}
            type={'primary'}
            onClick={() => void approve()}
          >
            {mine ? t('acceptance.comments.approveAgain') : t('acceptance.comments.approve')}
          </Button>
        </Flexbox>
      )}
    </Flexbox>
  );
});

ReviewerApprovalBar.displayName = 'AcceptanceReviewerApprovalBar';

export default ReviewerApprovalBar;
