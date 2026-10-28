'use client';

import type { AcceptanceCommentItem } from '@lobechat/types';
import { Button, Flexbox, Icon, Text, toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { UsersRound } from 'lucide-react';
import { nanoid } from 'nanoid';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { useAcceptanceScope } from '../AcceptanceScope';
import { useAcceptanceBundle } from '../useAcceptanceBundle';
import { needsCollaborationRequest } from '../visibility';
import { openCollaborationRequestModal } from './CollaborationRequestModal';
import { useAcceptanceComments } from './hooks';

const styles = stylex.create({
  banner: {
    backgroundColor: cssVar.colorFillQuaternary,
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: 10,
    borderStyle: 'solid',
    borderWidth: 1,
    paddingBlock: 10,
    paddingInline: 14,
  },
  description: {
    color: cssVar.colorTextTertiary,
    fontSize: 12,
  },
});

/** The viewer's newest surviving request on this acceptance. */
export const findOwnAccessRequest = (
  items: AcceptanceCommentItem[],
  viewerId: string | undefined,
) =>
  viewerId
    ? [...items]
        .reverse()
        .find(
          (item) =>
            item.kind === 'access_request' && !item.deletedAt && item.authorUserId === viewerId,
        )
    : undefined;

/**
 * For whoever may remark on a delivery but not own it: ask its deciders for
 * edit-collaboration. Before, such a reviewer could only comment — and a
 * comment, however pointed, never reaches the agent.
 *
 * It sits in the page header, above the tabs, because it is about the delivery
 * as a whole rather than any one face of it: a reviewer reading the discussion
 * needs it as much as one reading the checklist. One line, so it never pushes
 * the content down; the reason is asked for in a dialog.
 *
 * The request lands in the discussion, where a decider grants or declines it.
 * Once granted, the decision bar's reject turns on for this person and the
 * conversation bound to the delivery opens to them; whatever they start there
 * runs on the owner's agent.
 */
const CollaborationRequestBanner = () => {
  const { t } = useTranslation('verify');
  const { acceptanceId } = useAcceptanceScope();
  const { data, mutate: mutateBundle } = useAcceptanceBundle(acceptanceId);
  const { canComment, items, remove, requestAccess } = useAcceptanceComments(acceptanceId);
  const viewerId = useUserStore(userProfileSelectors.userId);
  const [withdrawing, setWithdrawing] = useState(false);

  if (!data || !canComment || !needsCollaborationRequest(data)) return null;
  if (data.acceptance.subjectType === 'goal_gate') return null;
  if (data.acceptance.status === 'accepted' || data.acceptance.status === 'closed') return null;

  const mine = findOwnAccessRequest(items, viewerId);
  const status = mine?.accessRequest?.status;
  // Granted but the bundle has not caught up yet: the collaborator surfaces are
  // about to take over.
  if (status === 'granted') return null;

  const pending = status === 'pending';
  const note =
    status === 'declined'
      ? t('acceptance.access.declinedNote')
      : status === 'revoked'
        ? t('acceptance.access.revokedNote')
        : undefined;

  const withdraw = async () => {
    if (!mine) return;
    setWithdrawing(true);
    try {
      await remove(mine.id);
      await mutateBundle();
    } catch (cause) {
      console.error('[acceptance:access]', cause);
      toast.error(t('acceptance.actionError'));
    } finally {
      setWithdrawing(false);
    }
  };

  const request = () =>
    openCollaborationRequestModal({
      onSubmit: async (reason) => {
        try {
          await requestAccess({
            clientId: nanoid(),
            content: reason || undefined,
            contextRunId: (data.rounds ?? []).at(-1)?.run.id,
          });
          return true;
        } catch (cause) {
          console.error('[acceptance:access]', cause);
          toast.error(t('acceptance.access.requestFailed'));
          return false;
        }
      },
    });

  return (
    <Flexbox
      horizontal
      align={'center'}
      data-testid={'acceptance-collaboration-request'}
      gap={12}
      wrap={'wrap'}
      {...stylex.props(styles.banner)}
    >
      <Icon
        color={pending ? cssVar.colorWarning : cssVar.colorTextSecondary}
        icon={UsersRound}
        size={16}
      />
      <Flexbox flex={1} gap={2} style={{ minWidth: 200 }}>
        <Text fontSize={13} weight={500}>
          {pending ? t('acceptance.access.pendingTitle') : t('acceptance.access.title')}
        </Text>
        <span {...stylex.props(styles.description)}>
          {pending
            ? t('acceptance.access.pendingDescription')
            : note
              ? `${note} ${t('acceptance.access.description')}`
              : t('acceptance.access.description')}
        </span>
      </Flexbox>
      {pending ? (
        <Button loading={withdrawing} size={'small'} onClick={() => void withdraw()}>
          {t('acceptance.access.withdraw')}
        </Button>
      ) : (
        <Button size={'small'} type={'primary'} onClick={request}>
          {note ? t('acceptance.access.requestAgain') : t('acceptance.access.request')}
        </Button>
      )}
    </Flexbox>
  );
};

export default CollaborationRequestBanner;
