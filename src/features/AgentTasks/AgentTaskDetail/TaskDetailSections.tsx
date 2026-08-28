import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import TaskAcceptance from './TaskAcceptance';
import TaskActivities from './TaskActivities';
import TaskArtifacts from './TaskArtifacts';
import TaskDetailAssignee from './TaskDetailAssignee';
import TaskDetailRunPauseAction from './TaskDetailRunPauseAction';
import TaskDetailTitleInput from './TaskDetailTitleInput';
import TaskInstruction from './TaskInstruction';
import TaskModelConfig from './TaskModelConfig';
import TaskParentBar from './TaskParentBar';
import TaskProperties from './TaskProperties';
import TaskSubtasks from './TaskSubtasks';

/**
 * The scrollable body sections of a task detail, shared by the full-page
 * `/task/[tid]` route and the chat-side Portal. All children read the active
 * task from the task store, so the host is responsible for setting
 * `activeTaskId` (e.g. via `setActiveTaskId`) before rendering this.
 */
const TaskDetailSections = memo(() => {
  return (
    <>
      <Flexbox gap={4} style={{ paddingBlock: '24px 36px' }}>
        <TaskDetailTitleInput />
        {/* Everything here wraps rather than compresses: this block also renders
            inside the chat-side Portal and beside the task-agent panel, where the
            column can get far narrower than the viewport. Without wrapping, the
            assignee chip is the item that gives — it shrinks until its label
            breaks one character per line. */}
        <Flexbox horizontal align={'flex-start'} gap={16} justify={'space-between'} wrap={'wrap'}>
          {/* `minWidth` is what makes the row actually wrap: a `flex: 1` column
              with `min-width: 0` shrinks to a sliver instead, and the properties
              panel keeps its place while the assignee chip overflows. */}
          <Flexbox align={'flex-start'} flex={1} gap={16} style={{ minWidth: 240 }}>
            <TaskParentBar />
            <Flexbox horizontal align={'center'} gap={8} style={{ maxWidth: '100%' }} wrap={'wrap'}>
              <TaskDetailAssignee />
              <TaskModelConfig />
            </Flexbox>
            <TaskDetailRunPauseAction />
          </Flexbox>
          <TaskProperties />
        </Flexbox>
      </Flexbox>
      <Flexbox gap={24} style={{ paddingBottom: 120 }}>
        <TaskInstruction />
        <TaskAcceptance />
        <TaskSubtasks />
        <TaskArtifacts />
        <TaskActivities />
      </Flexbox>
    </>
  );
});

export default TaskDetailSections;
