'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type {
  AddTaskCommentParams,
  AddTaskCommentState,
  DeleteTaskCommentParams,
  DeleteTaskCommentState,
  UpdateTaskCommentParams,
  UpdateTaskCommentState,
} from '../../../types';
import { TaskApiName } from '../../../types';

const styles = stylex.create({
  chip: {
    overflow: 'hidden',
    display: 'inline-flex',
    flexShrink: 1,
    alignItems: 'center',
    minWidth: '0',
    maxWidth: '220px',
    marginInlineStart: '6px',
    paddingBlock: '1px',
    paddingInline: '8px',
    borderRadius: '999px',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    background: cssVar.colorFillTertiary,
  },
  contentChip: {
    overflow: 'hidden',
    display: 'inline-flex',
    flexShrink: 1,
    alignItems: 'center',
    minWidth: '0',
    maxWidth: '260px',
    marginInlineStart: '6px',
    paddingBlock: '1px',
    paddingInline: '8px',
    borderRadius: '999px',
    fontSize: '12px',
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    background: cssVar.colorFillTertiary,
  },
});

interface TaskCommentInspectorProps extends BuiltinInspectorProps<
  AddTaskCommentParams | UpdateTaskCommentParams | DeleteTaskCommentParams,
  AddTaskCommentState | UpdateTaskCommentState | DeleteTaskCommentState
> {
  apiName: string;
}

const selectLabelKey = (apiName: string) => {
  switch (apiName) {
    case TaskApiName.addTaskComment: {
      return 'builtins.lobe-task.apiName.addTaskComment';
    }
    case TaskApiName.updateTaskComment: {
      return 'builtins.lobe-task.apiName.updateTaskComment';
    }
    case TaskApiName.deleteTaskComment: {
      return 'builtins.lobe-task.apiName.deleteTaskComment';
    }
    default: {
      return 'builtins.lobe-task.apiName.addTaskComment';
    }
  }
};

export const TaskCommentInspector = memo<TaskCommentInspectorProps>(
  ({ apiName, args, partialArgs, isArgumentsStreaming, isLoading }) => {
    const { t } = useTranslation('plugin');

    const params = args || partialArgs || {};
    const identifier = 'identifier' in params ? params.identifier : undefined;
    const commentId = 'commentId' in params ? params.commentId : undefined;
    const content = 'content' in params ? params.content : undefined;

    return (
      <div className={inspectorTextStyles.root}>
        <span className={cx((isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText)}>
          {t(selectLabelKey(apiName))}
        </span>
        {identifier && <span {...stylex.props(styles.chip)}>{identifier}</span>}
        {commentId && <span {...stylex.props(styles.chip)}>{commentId}</span>}
        {content && <span {...stylex.props(styles.contentChip)}>{content}</span>}
      </div>
    );
  },
);

TaskCommentInspector.displayName = 'TaskCommentInspector';

export const AddTaskCommentInspector = (
  props: BuiltinInspectorProps<AddTaskCommentParams, AddTaskCommentState>,
) => <TaskCommentInspector {...props} apiName={TaskApiName.addTaskComment} />;
AddTaskCommentInspector.displayName = 'AddTaskCommentInspector';

export const UpdateTaskCommentInspector = (
  props: BuiltinInspectorProps<UpdateTaskCommentParams, UpdateTaskCommentState>,
) => <TaskCommentInspector {...props} apiName={TaskApiName.updateTaskComment} />;
UpdateTaskCommentInspector.displayName = 'UpdateTaskCommentInspector';

export const DeleteTaskCommentInspector = (
  props: BuiltinInspectorProps<DeleteTaskCommentParams, DeleteTaskCommentState>,
) => <TaskCommentInspector {...props} apiName={TaskApiName.deleteTaskComment} />;
DeleteTaskCommentInspector.displayName = 'DeleteTaskCommentInspector';
