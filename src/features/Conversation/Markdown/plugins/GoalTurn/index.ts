import { GOAL_TURN_TAG } from '@/const/plugin';

import { createRemarkXmlBlockPlugin } from '../remarkPlugins/createRemarkXmlBlockPlugin';
import { type MarkdownElement } from '../type';
import Component from './Render';

const GoalTurnElement: MarkdownElement = {
  Component,
  remarkPlugin: createRemarkXmlBlockPlugin(GOAL_TURN_TAG),
  scope: 'user',
  tag: GOAL_TURN_TAG,
};

export default GoalTurnElement;
