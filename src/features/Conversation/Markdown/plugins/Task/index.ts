import { TASK_TAG } from '@/const/plugin';

import { type MarkdownElement } from '../type';
import { remarkTaskBlock } from './remarkTaskBlock';
import Component from './Render';

export { TaskCardScopeProvider } from './context';

const TaskElement: MarkdownElement = {
  Component,
  remarkPlugin: remarkTaskBlock,
  scope: 'user',
  tag: TASK_TAG,
};

export default TaskElement;
