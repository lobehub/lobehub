'use client';

import type { QuickNoteProposalKind } from '@lobechat/types';
import {
  Button,
  cssVar,
  type DropdownItem,
  DropdownMenu,
  Flexbox,
  Icon,
  Markdown,
  Tag,
  Text,
  toast,
  Tooltip,
} from '@lobehub/ui';
import { cssVar as vars } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { LucideIcon } from 'lucide-react';
import { ChevronDown, FileText, ListTodo, MessagesSquare, Target } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  getQuickNoteProposalPreview,
  QUICK_NOTE_DISMISS_REASONS,
  type QuickNoteProposal,
  type QuickNoteResource,
} from '@/services/quickNote';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import {
  isQuickNoteProposalActionable,
  quickNoteSelectors,
  useQuickNoteStore,
} from '@/store/quickNote';
import { sx } from '@/styles/sx';

import { resolveQuickNoteProposalResultTarget } from './buildExecutedItems';
import { resolveProposalApplyErrorKey } from './proposalApplyError';
import moduleStyles from './ProposalCard.module.css';
import { openProposalEditModal } from './ProposalEditModal';
import { resolveProposalWriteTarget } from './resolveProposalWriteTarget';
import { useOpenQuickNoteTarget } from './useOpenQuickNoteTarget';

const KIND_ICONS: Record<QuickNoteProposalKind, LucideIcon> = {
  goal: Target,
  task: ListTodo,
  tool_call: FileText,
  topic: MessagesSquare,
};

const EMPTY_RESOURCES: QuickNoteResource[] = [];

const styles = stylex.create({
  archived: {
    paddingBlock: 8,
    paddingInline: 12,
    borderRadius: vars.borderRadiusLG,
    backgroundColor: vars.colorFillQuaternary,
    backgroundImage: 'none',
  },
  card: {
    minWidth: 0,
    padding: 12,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: vars.colorBorderSecondary,
    borderRadius: vars.borderRadiusLG,
    backgroundColor: vars.colorBgContainer,
    backgroundImage: 'none',
  },
  // Descendant table / pre rules live in ProposalCard.module.css.
  markdownPreview: {
    overflow: 'hidden',
    minWidth: 0,
    maxHeight: 160,
    color: vars.colorTextSecondary,
    maskImage: 'linear-gradient(to bottom, black 70%, transparent)',
  },
});

/** Kind icon and label shared by the full and archived layouts. */
const KindLabel = ({ kind }: { kind: QuickNoteProposalKind }) => {
  const { t } = useTranslation('note');

  return (
    <Flexbox horizontal align={'center'} gap={6} style={{ minWidth: 0 }}>
      <Icon icon={KIND_ICONS[kind]} size={14} style={{ color: cssVar.colorTextTertiary }} />
      <Text color={cssVar.colorTextTertiary} fontSize={12}>
        {t(`agentic.proposal.kind.${kind}` as never)}
      </Text>
    </Flexbox>
  );
};

/** Decided or superseded Proposal: greyed, title only, with a link to an applied result. */
const ArchivedProposal = ({ proposal }: { proposal: QuickNoteProposal }) => {
  const { t } = useTranslation('note');
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const openTarget = useOpenQuickNoteTarget();
  const { title, body } = getQuickNoteProposalPreview(proposal.kind, proposal.payload);
  const status =
    proposal.decisionStatus === 'pending' ? proposal.validity : proposal.decisionStatus;
  const target =
    proposal.decisionStatus === 'accepted'
      ? resolveQuickNoteProposalResultTarget(proposal, inboxAgentId)
      : undefined;

  return (
    <Flexbox className={stylex.props(styles.archived).className} gap={4}>
      <Flexbox horizontal align={'center'} gap={6} justify={'space-between'}>
        <KindLabel kind={proposal.kind} />
        <Text color={cssVar.colorTextQuaternary} fontSize={12}>
          {t(`agentic.proposal.status.${status}` as never)}
        </Text>
      </Flexbox>
      <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
        <Text ellipsis color={cssVar.colorTextTertiary} fontSize={13}>
          {title || body}
        </Text>
        {target && (
          <Button size={'small'} type={'link'} onClick={() => openTarget(target, title)}>
            {t('agentic.proposal.openResult')}
          </Button>
        )}
      </Flexbox>
    </Flexbox>
  );
};

/** Pending Proposal the user can apply, edit, or dismiss; stale ones only show a hint. */
const ActionableProposal = ({
  noteId,
  proposal,
}: {
  noteId: string;
  proposal: QuickNoteProposal;
}) => {
  const { t } = useTranslation('note');
  const [applyProposal, dismissProposal, updateProposal] = useQuickNoteStore((s) => [
    s.applyProposal,
    s.dismissProposal,
    s.updateProposal,
  ]);
  const processing = useQuickNoteStore(quickNoteSelectors.isProcessingProposal(proposal.id));
  const resources = useQuickNoteStore(
    (s) => quickNoteSelectors.agenticDetailsById(noteId)(s)?.resources ?? EMPTY_RESOURCES,
  );
  const { title, body } = getQuickNoteProposalPreview(proposal.kind, proposal.payload);
  const writeTarget = resolveProposalWriteTarget(proposal, resources);

  const apply = async () => {
    try {
      const result = await applyProposal(noteId, proposal.id);
      if (result) toast.success(t('agentic.proposal.applied'));
    } catch (error) {
      toast.error(t(resolveProposalApplyErrorKey(error) as never));
    }
  };

  const dismiss = async (reason?: (typeof QUICK_NOTE_DISMISS_REASONS)[number]) => {
    try {
      await dismissProposal(noteId, proposal.id, reason);
    } catch {
      toast.error(t('agentic.actionFailed'));
    }
  };

  const dismissItems: DropdownItem[] = [
    ...QUICK_NOTE_DISMISS_REASONS.map((reason) => ({
      key: reason,
      label: t(`agentic.proposal.dismissReason.${reason}` as never),
      onClick: () => void dismiss(reason),
    })),
    { type: 'divider' as const },
    {
      key: 'none',
      label: t('agentic.proposal.dismissWithoutReason'),
      onClick: () => void dismiss(),
    },
  ];

  return (
    <Flexbox className={stylex.props(styles.card).className} gap={8}>
      <Flexbox horizontal align={'center'} gap={6} justify={'space-between'}>
        <KindLabel kind={proposal.kind} />
        {proposal.validity === 'stale' && (
          <Tooltip title={t('agentic.proposal.staleHint')}>
            <Tag color={'warning'}>{t('agentic.proposal.stale')}</Tag>
          </Tooltip>
        )}
      </Flexbox>
      {writeTarget ? (
        <Text ellipsis fontSize={13} weight={500}>
          {t(`agentic.proposal.target.${writeTarget.type}`, {
            title: writeTarget.title || t('agentic.proposal.target.untitled'),
          })}
        </Text>
      ) : (
        title && (
          <Text fontSize={13} weight={500}>
            {title}
          </Text>
        )
      )}
      {body &&
        (writeTarget ? (
          // A write-document draft is Markdown (often tables); clamp the rendered preview.
          <div {...sx(styles.markdownPreview, moduleStyles.markdownPreview)}>
            <Markdown fontSize={13} variant={'chat'}>
              {body}
            </Markdown>
          </div>
        ) : (
          <Text color={cssVar.colorTextSecondary} ellipsis={{ rows: 4 }} fontSize={13}>
            {body}
          </Text>
        ))}
      <Flexbox horizontal gap={6} justify={'flex-end'} wrap={'wrap'}>
        <Button
          disabled={processing}
          size={'small'}
          type={'text'}
          onClick={() =>
            openProposalEditModal({
              kind: proposal.kind,
              onSave: (payload) => updateProposal(noteId, proposal.id, payload),
              payload: proposal.payload,
            })
          }
        >
          {t('agentic.proposal.edit')}
        </Button>
        <DropdownMenu items={dismissItems} placement={'bottomRight'}>
          <Button disabled={processing} size={'small'} type={'text'}>
            <Flexbox horizontal align={'center'} gap={2}>
              {t('agentic.proposal.dismiss')}
              <Icon icon={ChevronDown} size={12} />
            </Flexbox>
          </Button>
        </DropdownMenu>
        <Button loading={processing} size={'small'} type={'primary'} onClick={() => void apply()}>
          {t(`agentic.proposal.apply.${proposal.kind}` as never)}
        </Button>
      </Flexbox>
    </Flexbox>
  );
};

const ProposalCard = memo<{ noteId: string; proposal: QuickNoteProposal }>(
  ({ noteId, proposal }) =>
    isQuickNoteProposalActionable(proposal) ? (
      <ActionableProposal noteId={noteId} proposal={proposal} />
    ) : (
      <ArchivedProposal proposal={proposal} />
    ),
);

ProposalCard.displayName = 'QuickNoteProposalCard';

export default ProposalCard;
