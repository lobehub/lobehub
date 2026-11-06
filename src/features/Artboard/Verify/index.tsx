import { ActionIcon, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Link2Icon, XIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useBoard } from '../BoardContext';
import StatusTag from '../StatusTag';
import { artboardActions, artboardSelectors, useArtboardStore } from '../store';
import CheckDetail from './CheckDetail';
import { type JourneyView, nodeReview, nodeState } from './flow';
import { useJourneyView } from './useJourneyView';

const styles = stylex.create({
  check: {
    borderColor: {
      ':hover': cssVar.colorBorder,
      'default': cssVar.colorBorderSecondary,
    },
    borderRadius: cssVar.borderRadiusLG,
    borderStyle: 'solid',
    borderWidth: 1,
    cursor: 'pointer',
    padding: 12,
    transitionDuration: '0.15s',
    transitionProperty: 'border-color',
  },
  head: {
    borderBlockEndColor: cssVar.colorBorderSecondary,
    borderBlockEndStyle: 'solid',
    borderBlockEndWidth: 1,
    flex: 'none',
    height: 48,
    paddingInlineEnd: 10,
    paddingInlineStart: 16,
  },
  panel: {
    backgroundColor: cssVar.colorBgContainer,
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
  },
  scroll: {
    flex: '1',
    minHeight: 0,
    overflowY: 'auto',
    padding: 16,
  },
});

const resultCounts = (view: JourneyView | undefined, frameIds: string[]) => {
  const counts = { blocked: 0, failed: 0, passed: 0, pending: 0 };
  for (const id of frameIds) {
    const state = nodeState(view, id);
    if (state === 'passed' || state === 'failed') counts[state] += 1;
    else if (state) counts.blocked += 1;
    else counts.pending += 1;
  }
  return counts;
};

const CheckList = () => {
  const { t } = useTranslation('project');
  const board = useBoard();
  const journey = useJourneyView();
  const run = journey?.run;
  const counts = resultCounts(
    journey,
    board.journeyFrames.map((f) => f.id),
  );

  return (
    <Flexbox gap={10}>
      <Text style={{ fontSize: 12 }} type="secondary">
        {run ? t('artboard.verify.summary', counts) : t('artboard.verify.waiting')}
      </Text>
      {board.journeyFrames.map((frame) => {
        const review = nodeReview(journey, frame.id);
        return (
          <Flexbox
            gap={8}
            key={frame.id}
            {...stylex.props(styles.check)}
            onClick={() => artboardActions.focusItem(frame.id)}
          >
            <Flexbox horizontal align="flex-start" gap={8}>
              <StatusTag state={nodeState(journey, frame.id)} />
              <Text style={{ flex: 1, minWidth: 0 }}>{frame.check?.expected}</Text>
            </Flexbox>
            <Flexbox horizontal align="center" gap={8}>
              <Tag icon={<Icon icon={Link2Icon} />} size={'small'}>
                {frame.title}
              </Tag>
              {review && (
                <Text style={{ fontSize: 12 }} type="secondary">
                  {t(
                    review === 'accepted'
                      ? 'artboard.verify.reviewedTag'
                      : 'artboard.verify.rejectedTag',
                  )}
                </Text>
              )}
            </Flexbox>
          </Flexbox>
        );
      })}
    </Flexbox>
  );
};

const VerifyPanel = ({ onClose }: { onClose?: () => void }) => {
  const { t } = useTranslation('project');
  const board = useBoard();
  const selected = useArtboardStore(artboardSelectors.selectedCheckFrame(board));

  return (
    <div {...stylex.props(styles.panel)}>
      <Flexbox horizontal align="center" gap={8} {...stylex.props(styles.head)}>
        <Text strong style={{ flex: 1 }}>
          {t(selected ? 'artboard.verify.detailTitle' : 'artboard.verify.title')}
        </Text>
        {onClose && (
          <ActionIcon
            icon={XIcon}
            size={'small'}
            title={t('artboard.verify.close')}
            onClick={onClose}
          />
        )}
      </Flexbox>
      <div {...stylex.props(styles.scroll)}>
        {selected ? <CheckDetail frameId={selected} /> : <CheckList />}
      </div>
    </div>
  );
};

export default VerifyPanel;
