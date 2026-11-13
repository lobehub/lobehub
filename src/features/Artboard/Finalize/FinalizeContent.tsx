import { type ArtboardFinalizeIssue, checkFinalizeReadiness } from '@lobechat/types';
import { Button, Flexbox, Icon, Tag, Text, toast, useModalContext } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { type TFunction } from 'i18next';
import { LockIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAcceptanceOrigin } from '@/features/Acceptance/origin';

import { announceFinalized } from '../data/announceFinalized';
import { finalizeBoard } from '../data/finalizeBoard';
import { useBoardModel } from '../data/useBoardModel';
import type { BoardModel } from '../model';
import PendingItem from './PendingItem';

const styles = stylex.create({
  check: {
    borderBlockEndColor: cssVar.colorBorderSecondary,
    borderBlockEndStyle: 'solid',
    borderBlockEndWidth: 1,
    paddingBlock: 8,
  },
  lock: {
    backgroundColor: cssVar.colorFillQuaternary,
    borderRadius: cssVar.borderRadiusLG,
    color: cssVar.colorTextSecondary,
    fontSize: 13,
    padding: 12,
  },
});

type StructureIssue = Exclude<
  ArtboardFinalizeIssue,
  { code: 'missing_check' | 'open_question' | 'open_round' }
>;

const isStructureIssue = (issue: ArtboardFinalizeIssue): issue is StructureIssue =>
  issue.code !== 'missing_check' && issue.code !== 'open_question' && issue.code !== 'open_round';

const issueText = (board: BoardModel, t: TFunction<'project'>, issue: StructureIssue) =>
  issue.code === 'unreachable'
    ? t('artboard.finalize.issue.unreachable', {
        title: board.boardById[issue.boardId]?.title ?? issue.boardId,
      })
    : t(`artboard.finalize.issue.${issue.code}`);

const FinalizeContent = ({ artboardId }: { artboardId: string }) => {
  const { t } = useTranslation('project');
  const { close } = useModalContext();
  const origin = useAcceptanceOrigin();
  const board = useBoardModel(artboardId);
  const [saving, setSaving] = useState(false);
  if (!board) return null;

  const issues = checkFinalizeReadiness(board.artboard.content);
  const structureIssues = issues.filter(isStructureIssue);
  const checks = board.journeyBoards.filter((item) => item.type !== 'decision');
  const { artboard } = board;

  const confirm = async () => {
    setSaving(true);
    try {
      const result = await finalizeBoard({
        announce: (acceptanceId) =>
          announceFinalized({
            acceptanceUrl: `${origin}/acceptance/${acceptanceId}`,
            artboard,
            count: checks.length,
          }),
        artboardId,
        revision: artboard.revision,
      });
      close();
      const url = result.acceptanceId ? `${origin}/acceptance/${result.acceptanceId}` : undefined;
      toast.success({
        actions: url
          ? [
              {
                label: t('artboard.finalize.openAcceptance'),
                onClick: () => window.open(url, '_blank', 'noopener'),
              },
            ]
          : undefined,
        title: t('artboard.finalize.success', { count: checks.length }),
      });
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Flexbox gap={16}>
      {structureIssues.length > 0 && (
        <Flexbox gap={4}>
          {structureIssues.map((issue) => (
            <Text
              key={issue.code === 'unreachable' ? `${issue.code}:${issue.boardId}` : issue.code}
              type="warning"
            >
              {issueText(board, t, issue)}
            </Text>
          ))}
        </Flexbox>
      )}
      {board.blockers.length > 0 && (
        <Flexbox gap={8}>
          <Text strong>
            {t('artboard.finalize.pendingTitle', { count: board.blockers.length })}
          </Text>
          {board.blockers.map((blocker) => (
            <PendingItem blocker={blocker} key={blocker.id} onDiscuss={close} />
          ))}
        </Flexbox>
      )}
      {checks.length > 0 && (
        <Flexbox gap={4}>
          <Text strong>{t('artboard.finalize.checksTitle', { count: checks.length })}</Text>
          {checks.map((item) => (
            <Flexbox
              horizontal
              align="center"
              gap={8}
              key={item.id}
              {...stylex.props(styles.check)}
            >
              <Text style={{ flex: 1, minWidth: 0 }} type={item.expected ? undefined : 'warning'}>
                {item.expected || t('artboard.finalize.missingCheck')}
              </Text>
              <Tag size={'small'}>
                {item.title}
                {item.source?.kind === 'canvas' ? ` · v${item.source.version}` : ''}
              </Tag>
            </Flexbox>
          ))}
        </Flexbox>
      )}
      <Flexbox horizontal align="flex-start" gap={8} {...stylex.props(styles.lock)}>
        <Icon icon={LockIcon} size={14} style={{ marginTop: 3 }} />
        <span>{t('artboard.finalize.lockNote')}</span>
      </Flexbox>
      <Flexbox horizontal gap={8} justify="flex-end">
        <Button onClick={close}>{t('artboard.finalize.cancel')}</Button>
        <Button disabled={issues.length > 0} loading={saving} type={'primary'} onClick={confirm}>
          {issues.length
            ? t('artboard.finalize.blocked', { count: issues.length })
            : t('artboard.finalize.confirm')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
};

export default FinalizeContent;
