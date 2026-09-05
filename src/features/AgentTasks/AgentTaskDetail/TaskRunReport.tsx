'use client';

import type { TaskDetailActivity } from '@lobechat/types';
import { Flexbox, Markdown } from '@lobehub/ui';
import { ActionIcon, Avatar, Text } from '@lobehub/ui/base-ui';
import { MessageCircle, MessagesSquare } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DEFAULT_AVATAR } from '@/const/meta';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

import RunReplyEditor from './RunReplyEditor';

/**
 * What the agent reported for this task, presented as a report.
 *
 * Deliberately NOT the activity card: no run chips, no attempt number, no
 * status glyph, no collapse chevron, no overflow menu, no outline. Every one of
 * those answers "which row of the list is this", and the reader of a result
 * panel already knows — the panel header names the task. What is left is the
 * delivery itself, which is the only thing they came for.
 *
 * The author does stay, at the head: a report names who wrote it, and that is a
 * different job from the avatar's job in a list row.
 *
 * The two actions stay because reading a report is not the end of the job: you
 * either ask the agent about it or leave a note for the next run. They sit under
 * the report rather than inside it, so they never compete with the content.
 */

interface TaskRunReportProps {
  activity: TaskDetailActivity;
}

const TaskRunReport = memo<TaskRunReportProps>(({ activity }) => {
  const { t } = useTranslation('chat');
  const openTopicDrawer = useTaskStore((s) => s.openTopicDrawer);
  const addComment = useTaskStore((s) => s.addComment);
  const activeTaskId = useTaskStore(taskDetailSelectors.activeTaskId);
  const [commenting, setCommenting] = useState(false);

  // A descendant run belongs to `sourceTaskId`, not the open parent.
  const runTaskId = activity.sourceTaskId ?? activeTaskId;

  const openConversation = useCallback(() => {
    if (!activity.id) return;
    openTopicDrawer(activity.id, {
      agentId:
        activity.author?.type === 'agent' ? activity.author.id : activity.agentId || undefined,
      title: activity.title,
    });
  }, [activity.agentId, activity.author, activity.id, activity.title, openTopicDrawer]);

  // Nothing was reported yet — the panel's own empty handling covers that case.
  const body = activity.content || activity.summary;
  if (!body) return null;

  return (
    <Flexbox gap={16}>
      {/* Who is reporting, at the top where a report names its author — not a
          footnote under the text it wrote. */}
      <Flexbox horizontal align={'center'} gap={8}>
        <Avatar avatar={activity.author?.avatar || DEFAULT_AVATAR} size={24} />
        <Text weight={500}>{activity.author?.name ?? t('taskDetail.reportedByAgent')}</Text>
      </Flexbox>
      <Markdown style={{ overflow: 'unset' }} variant={'chat'}>
        {body}
      </Markdown>

      {commenting ? (
        <RunReplyEditor
          onCancel={() => setCommenting(false)}
          onSubmit={async (text) => {
            if (!runTaskId) return;
            await addComment(runTaskId, text, { topicId: activity.id });
            setCommenting(false);
          }}
        />
      ) : (
        <Flexbox horizontal align={'center'} gap={4} justify={'flex-end'}>
          <ActionIcon
            icon={MessagesSquare}
            size={'small'}
            title={t('taskDetail.openRunChat')}
            onClick={openConversation}
          />
          {!!runTaskId && (
            <ActionIcon
              icon={MessageCircle}
              size={'small'}
              title={t('taskDetail.runFollowUp')}
              onClick={() => setCommenting(true)}
            />
          )}
        </Flexbox>
      )}
    </Flexbox>
  );
});

TaskRunReport.displayName = 'TaskRunReport';

export default TaskRunReport;
