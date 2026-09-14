'use client';

import { Flexbox, Markdown, TextArea } from '@lobehub/ui';
import { Button, Tag, Text, toast } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { Check, Pencil, Send, X } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import type { QuickNoteComment, QuickNoteProposal } from '@/services/quickNote';
import { quickNoteSelectors, useQuickNoteStore } from '@/store/quickNote';

import { formatNoteTime } from '../utils';
import ResourceCard from './ResourceCard';
import { styles } from './style';

const SectionTitle = memo<{ children: string }>(({ children }) => (
  <Text color={cssVar.colorTextSecondary} fontSize={12} weight={500}>
    {children}
  </Text>
));

SectionTitle.displayName = 'QuickNoteSectionTitle';

const CommentItem = memo<{ comment: QuickNoteComment; noteId: string }>(({ comment, noteId }) => {
  const { t } = useTranslation('note');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.content);
  const updateComment = useQuickNoteStore((s) => s.updateComment);
  const saving = useQuickNoteStore(quickNoteSelectors.isEditingComment(comment.id));

  const save = async () => {
    try {
      await updateComment(noteId, comment.id, draft);
      setEditing(false);
    } catch {
      toast.error(t('agentic.actionFailed'));
    }
  };

  return (
    <Flexbox className={styles.sidecarCard} gap={8}>
      {editing ? (
        <TextArea
          autoFocus
          autoSize={{ maxRows: 6, minRows: 2 }}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      ) : (
        <Text fontSize={13}>{comment.content}</Text>
      )}
      <Flexbox horizontal align={'center'} gap={6} justify={'space-between'}>
        <Text color={cssVar.colorTextQuaternary} fontSize={11}>
          {formatNoteTime(comment.updatedAt)}
        </Text>
        {editing ? (
          <Flexbox horizontal gap={4}>
            <Button
              aria-label={t('agentic.comment.cancelEdit')}
              icon={X}
              size={'small'}
              type={'text'}
              onClick={() => {
                setDraft(comment.content);
                setEditing(false);
              }}
            />
            <Button
              aria-label={t('agentic.comment.save')}
              disabled={!draft.trim()}
              icon={Check}
              loading={saving}
              size={'small'}
              type={'primary'}
              onClick={save}
            />
          </Flexbox>
        ) : (
          <Button
            aria-label={t('agentic.comment.edit')}
            icon={Pencil}
            size={'small'}
            type={'text'}
            onClick={() => setEditing(true)}
          />
        )}
      </Flexbox>
    </Flexbox>
  );
});

CommentItem.displayName = 'QuickNoteCommentItem';

const ProposalItem = memo<{ noteId: string; proposal: QuickNoteProposal }>(
  ({ noteId, proposal }) => {
    const { t } = useTranslation('note');
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(proposal.content);
    const [acceptProposal, dismissProposal, updateProposal] = useQuickNoteStore((s) => [
      s.acceptProposal,
      s.dismissProposal,
      s.updateProposal,
    ]);
    const processing = useQuickNoteStore(quickNoteSelectors.isProcessingProposal(proposal.id));
    const actionable = proposal.decisionStatus === 'pending' && proposal.validity === 'current';

    const runAction = async (action: () => Promise<unknown>) => {
      try {
        await action();
      } catch {
        toast.error(t('agentic.actionFailed'));
      }
    };

    return (
      <Flexbox className={styles.proposalCard} gap={10}>
        <Flexbox horizontal align={'center'} gap={6} justify={'space-between'}>
          <Text fontSize={12} weight={500}>
            {t(`agentic.proposal.kind.${proposal.kind}` as never)}
          </Text>
          <Tag size={'small'}>
            {t(
              `agentic.proposal.status.${
                proposal.validity === 'stale' ? 'stale' : proposal.decisionStatus
              }` as never,
            )}
          </Tag>
        </Flexbox>
        {editing ? (
          <TextArea
            autoFocus
            autoSize={{ maxRows: 8, minRows: 3 }}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        ) : (
          <Markdown fontSize={13} variant={'chat'}>
            {proposal.content}
          </Markdown>
        )}
        {actionable && (
          <Flexbox horizontal gap={6} wrap={'wrap'}>
            {editing ? (
              <>
                <Button
                  disabled={processing}
                  size={'small'}
                  onClick={() => {
                    setDraft(proposal.content);
                    setEditing(false);
                  }}
                >
                  {t('agentic.proposal.cancelEdit')}
                </Button>
                <Button
                  disabled={!draft.trim()}
                  loading={processing}
                  size={'small'}
                  type={'primary'}
                  onClick={() =>
                    runAction(async () => {
                      await updateProposal(noteId, proposal.id, draft);
                      setEditing(false);
                    })
                  }
                >
                  {t('agentic.proposal.save')}
                </Button>
              </>
            ) : (
              <>
                <Button size={'small'} onClick={() => setEditing(true)}>
                  {t('agentic.proposal.edit')}
                </Button>
                <Button
                  disabled={processing}
                  size={'small'}
                  onClick={() => runAction(() => dismissProposal(noteId, proposal.id))}
                >
                  {t('agentic.proposal.dismiss')}
                </Button>
                <Button
                  loading={processing}
                  size={'small'}
                  type={'primary'}
                  onClick={() => runAction(() => acceptProposal(noteId, proposal.id))}
                >
                  {t('agentic.proposal.createTask')}
                </Button>
              </>
            )}
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

ProposalItem.displayName = 'QuickNoteProposalItem';

/**
 * Renders the Agent-owned Resources, Proposals, and feedback beside a Quick Note.
 *
 * Use when:
 * - Extending the existing Annotation panel with reviewable Agent sidecars.
 * - Letting a user correct context or accept a Task Proposal without changing the source note.
 *
 * Expects:
 * - `noteId` identifies the active Quick Note and its current source revision.
 *
 * Returns:
 * - A refreshable review surface backed by the Quick Note service and Zustand store.
 */
const AgenticDetails = memo<{ noteId: string }>(({ noteId }) => {
  const { t } = useTranslation('note');
  const [comment, setComment] = useState('');
  const details = useQuickNoteStore(quickNoteSelectors.agenticDetailsById(noteId));
  const useFetchAgenticDetails = useQuickNoteStore((s) => s.useFetchAgenticDetails);
  const createComment = useQuickNoteStore((s) => s.createComment);
  const creatingComment = useQuickNoteStore(quickNoteSelectors.isCreatingComment(noteId));
  const { data, error, isLoading, mutate } = useFetchAgenticDetails(noteId);

  const submitComment = async () => {
    try {
      await createComment(noteId, comment);
      setComment('');
    } catch {
      toast.error(t('agentic.actionFailed'));
    }
  };

  return (
    <AsyncBoundary
      data={data ?? details}
      error={error}
      errorVariant={'inline'}
      isLoading={isLoading}
      onRetry={() => void mutate()}
    >
      <Flexbox gap={18}>
        <Flexbox gap={8}>
          <SectionTitle>{t('agentic.resources.title')}</SectionTitle>
          {details?.resources.length ? (
            <Flexbox gap={6}>
              {details.resources.map((resource) => (
                <ResourceCard key={resource.id} resource={resource} />
              ))}
            </Flexbox>
          ) : (
            <Text color={cssVar.colorTextQuaternary} fontSize={12}>
              {t('agentic.resources.empty')}
            </Text>
          )}
        </Flexbox>

        <Flexbox gap={8}>
          <SectionTitle>{t('agentic.proposal.title')}</SectionTitle>
          {details?.proposals.length ? (
            <Flexbox gap={8}>
              {details.proposals.map((proposal) => (
                <ProposalItem key={proposal.id} noteId={noteId} proposal={proposal} />
              ))}
            </Flexbox>
          ) : (
            <Text color={cssVar.colorTextQuaternary} fontSize={12}>
              {t('agentic.proposal.empty')}
            </Text>
          )}
        </Flexbox>

        <Flexbox gap={8}>
          <SectionTitle>{t('agentic.comment.title')}</SectionTitle>
          {details?.comments.map((item) => (
            <CommentItem comment={item} key={item.id} noteId={noteId} />
          ))}
          <TextArea
            autoSize={{ maxRows: 6, minRows: 2 }}
            placeholder={t('agentic.comment.placeholder')}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
          />
          <Button
            disabled={!comment.trim()}
            icon={Send}
            loading={creatingComment}
            size={'small'}
            type={'primary'}
            onClick={submitComment}
          >
            {t('agentic.comment.add')}
          </Button>
        </Flexbox>
      </Flexbox>
    </AsyncBoundary>
  );
});

AgenticDetails.displayName = 'QuickNoteAgenticDetails';

export default AgenticDetails;
