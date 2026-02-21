import type { BuiltinInspector } from '@lobechat/types';

import { GTDApiName } from '../../types';
import { ClearTodosInspector } from './ClearTodos';
import { CreatePlanInspector } from './CreatePlan';
import { CreateTodosInspector } from './CreateTodos';
import { ExecTaskInspector } from './ExecTask';
import { ExecTasksInspector } from './ExecTasks';
import { UpdatePlanInspector } from './UpdatePlan';
import { UpdateTodosInspector } from './UpdateTodos';

/**
 * GTD Inspector Components Registry
 *
 * Inspector components customize the title/header area
 * of tool calls in the conversation UI.
 */
export const GTDInspectors: Record<string, BuiltinInspector> = {
  [GTDApiName.clearTodos]: ClearTodosInspector as BuiltinInspector,
  [GTDApiName.createPlan]: CreatePlanInspector as BuiltinInspector,
  [GTDApiName.createTodos]: CreateTodosInspector as BuiltinInspector,
  [GTDApiName.execTask]: ExecTaskInspector as BuiltinInspector,
  [GTDApiName.execTasks]: ExecTasksInspector as BuiltinInspector,
  [GTDApiName.updatePlan]: UpdatePlanInspector as BuiltinInspector,
  [GTDApiName.updateTodos]: UpdateTodosInspector as BuiltinInspector,
};
