import { Button } from '@lobehub/ui';
import { memo, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import { WORKFLOW_LIST_INITIAL_STEPS, WORKFLOW_LIST_LOAD_MORE_STEPS } from '../constants';
import ContentBlocksScroll from './ContentBlocksScroll';
import type { RenderableAssistantContentBlock } from './types';
import { useStepWindow } from './useStepWindow';

interface WorkflowExpandedListProps {
  assistantId: string;
  blocks: RenderableAssistantContentBlock[];
  constrained?: boolean;
  disableEditing?: boolean;
  onScroll?: () => void;
  scrollRef?: RefObject<HTMLDivElement | null>;
}

const WorkflowExpandedList = memo<WorkflowExpandedListProps>(
  ({ assistantId, blocks, constrained, disableEditing, onScroll, scrollRef }) => {
    const { t } = useTranslation('chat');
    const { hiddenCount, showEarlier, visible } = useStepWindow(
      blocks,
      WORKFLOW_LIST_INITIAL_STEPS,
      WORKFLOW_LIST_LOAD_MORE_STEPS,
    );

    return (
      <ContentBlocksScroll
        assistantId={assistantId}
        blocks={visible}
        disableEditing={disableEditing}
        scroll={!!constrained}
        scrollRef={scrollRef}
        variant="workflow"
        leading={
          hiddenCount > 0 ? (
            <Button
              size={'small'}
              style={{ alignSelf: 'center' }}
              type={'text'}
              onClick={showEarlier}
            >
              {t('workflow.showEarlierSteps', { count: hiddenCount })}
            </Button>
          ) : undefined
        }
        onScroll={onScroll}
      />
    );
  },
);

WorkflowExpandedList.displayName = 'WorkflowExpandedList';

export default WorkflowExpandedList;
