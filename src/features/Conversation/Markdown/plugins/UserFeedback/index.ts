import { USER_FEEDBACK_TAG } from '@/const/plugin';

import { type MarkdownElement } from '../type';
import { remarkUserFeedbackBlock } from './remarkUserFeedbackBlock';
import Component from './Render';

const UserFeedbackElement: MarkdownElement = {
  Component,
  remarkPlugin: remarkUserFeedbackBlock,
  scope: 'user',
  tag: USER_FEEDBACK_TAG,
};

export default UserFeedbackElement;
