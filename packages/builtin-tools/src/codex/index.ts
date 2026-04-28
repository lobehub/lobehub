import {
  type BuiltinInspector,
  type BuiltinRender,
  type RenderDisplayControl,
} from '@lobechat/types';

import FileChangeInspector from './FileChangeInspector';
import FileChangeRender from './FileChangeRender';
import TodoListInspector from './TodoListInspector';
import TodoListRender from './TodoListRender';

export const CodexInspectors: Record<string, BuiltinInspector> = {
  file_change: FileChangeInspector as BuiltinInspector,
  todo_list: TodoListInspector as BuiltinInspector,
};

export const CodexRenders: Record<string, BuiltinRender> = {
  file_change: FileChangeRender as BuiltinRender,
  todo_list: TodoListRender as BuiltinRender,
};

export const CodexRenderDisplayControls: Record<string, RenderDisplayControl> = {
  file_change: 'expand',
  todo_list: 'expand',
};
