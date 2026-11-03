'use client';

import type { TodoWriteArgs } from '@lobechat/builtin-tool-claude-code';
import { ClaudeCodeApiName } from '@lobechat/builtin-tool-claude-code';
import { ClaudeCodeInspectors } from '@lobechat/builtin-tool-claude-code/client';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { type ComponentType, memo } from 'react';

import { type CodexTodoListArgs, toTodoWriteArgs } from './utils';

const TodoListInspector = memo<BuiltinInspectorProps<CodexTodoListArgs>>(
  ({ args, partialArgs, ...rest }) => {
    const TodoWriteInspector = ClaudeCodeInspectors[ClaudeCodeApiName.TodoWrite] as ComponentType<
      BuiltinInspectorProps<TodoWriteArgs>
    >;

    return (
      <TodoWriteInspector
        {...rest}
        args={toTodoWriteArgs(args)}
        partialArgs={toTodoWriteArgs(partialArgs)}
      />
    );
  },
);

TodoListInspector.displayName = 'CodexTodoListInspector';

export default TodoListInspector;
