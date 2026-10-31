'use client';

import type { ArtifactBoardView as ArtifactBoardData } from '@lobechat/types';
import { summarizeArtifactBoardChoices } from '@lobechat/types';
import { Button, Empty, Flexbox, Tag, Text, toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Send } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import { useClientDataSWR } from '@/libs/swr';
import { artifactBoardService } from '@/services/artifactBoard';

import OptionCard from './OptionCard';
import PublishToAcceptance from './PublishToAcceptance';

const styles = stylex.create({
  scroll: {
    flex: '1',
    minHeight: 0,
    overflowY: 'auto',
    paddingBlock: 16,
    paddingInline: 20,
  },
  header: {
    borderBottomColor: cssVar.colorBorderSecondary,
    borderBottomStyle: 'solid',
    borderBottomWidth: 1,
    paddingBlock: 12,
    paddingInline: 20,
  },
  title: {
    fontSize: 18,
    fontWeight: 650,
  },
  roundTitle: {
    fontSize: 15,
    fontWeight: 600,
  },
  roundIndex: {
    color: cssVar.colorTextTertiary,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: 12,
  },
});

const ArtifactBoardBody = ({
  board,
  onChange,
}: {
  board: ArtifactBoardData;
  onChange: (board: ArtifactBoardData) => void;
}) => {
  const { t } = useTranslation('portal');
  const [pending, setPending] = useState<string>();
  const [publishOpen, setPublishOpen] = useState(false);
  const chosenByRound = new Map(board.choices.map((choice) => [choice.roundId, choice]));
  const summary = summarizeArtifactBoardChoices(board.manifest, board.choices);

  const choose = async (roundId: string, optionId: string) => {
    if (chosenByRound.get(roundId)?.chosenOptionId === optionId) return;
    setPending(`${roundId}/${optionId}`);
    try {
      onChange(await artifactBoardService.choose(board.boardId, roundId, optionId));
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setPending(undefined);
    }
  };

  return (
    <Flexbox flex={1} style={{ minHeight: 0 }}>
      <Flexbox
        horizontal
        align="center"
        gap={12}
        justify="space-between"
        {...stylex.props(styles.header)}
      >
        <Flexbox gap={4} style={{ minWidth: 0 }}>
          <Flexbox horizontal align="center" gap={8}>
            <span {...stylex.props(styles.title)}>{board.title}</span>
            <Tag size="small">v{board.version}</Tag>
          </Flexbox>
          <Flexbox horizontal align="center" gap={6} wrap="wrap">
            {board.manifest.rounds.map((round, index) => {
              const choice = chosenByRound.get(round.id);
              const option = round.options.find((item) => item.id === choice?.chosenOptionId);
              return (
                <Tag color={option ? 'processing' : undefined} key={round.id} size="small">
                  {option
                    ? t('board.round.chosen', { label: option.label, round: index + 1 })
                    : t('board.round.unchosen', { round: index + 1 })}
                </Tag>
              );
            })}
          </Flexbox>
        </Flexbox>
        <Button
          disabled={!summary}
          icon={Send}
          title={summary ? undefined : t('board.publish.needChoice')}
          type="primary"
          onClick={() => setPublishOpen(true)}
        >
          {t('board.publish.trigger')}
        </Button>
      </Flexbox>
      <Flexbox gap={28} {...stylex.props(styles.scroll)}>
        {board.manifest.description && <Text type="secondary">{board.manifest.description}</Text>}
        {board.manifest.rounds.map((round, index) => {
          const chosenId = chosenByRound.get(round.id)?.chosenOptionId;
          return (
            <Flexbox data-testid={`board-round-${round.id}`} gap={12} key={round.id}>
              <Flexbox gap={2}>
                <Flexbox horizontal align="baseline" gap={8}>
                  <span {...stylex.props(styles.roundIndex)}>
                    {t('board.round.index', { round: index + 1 })}
                  </span>
                  <span {...stylex.props(styles.roundTitle)}>{round.title}</span>
                </Flexbox>
                {round.description && (
                  <Text fontSize={12} type="secondary">
                    {round.description}
                  </Text>
                )}
              </Flexbox>
              <Flexbox horizontal gap={16} wrap="wrap">
                {round.options.map((option) => (
                  <OptionCard
                    chosen={chosenId === option.id}
                    disabled={!!pending}
                    key={option.id}
                    option={option}
                    onChoose={() => void choose(round.id, option.id)}
                  />
                ))}
              </Flexbox>
            </Flexbox>
          );
        })}
      </Flexbox>
      <PublishToAcceptance board={board} open={publishOpen} onClose={() => setPublishOpen(false)} />
    </Flexbox>
  );
};

/** A board: rounds of Canvas options laid flat, one pick per round. */
const ArtifactBoardView = ({ boardId }: { boardId: string }) => {
  const { t } = useTranslation('portal');
  const { data, error, isLoading, mutate } = useClientDataSWR(['artifact-board', boardId], () =>
    artifactBoardService.get(boardId),
  );

  return (
    <AsyncBoundary
      data={data}
      empty={<Empty description={t('board.notFound')} />}
      error={error}
      isEmpty={data === null}
      isLoading={isLoading}
      onRetry={() => {
        void mutate();
      }}
    >
      {data && (
        <ArtifactBoardBody
          board={data}
          onChange={(next) => {
            void mutate(next, { revalidate: false });
          }}
        />
      )}
    </AsyncBoundary>
  );
};

export default ArtifactBoardView;
