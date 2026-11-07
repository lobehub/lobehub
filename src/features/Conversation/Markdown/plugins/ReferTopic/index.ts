import { createRemarkSelfClosingTagPlugin } from '../remarkPlugins/createRemarkSelfClosingTagPlugin';
import { type MarkdownElement } from '../type';
import Render from './Render';

export const REFER_TOPIC_TAG = 'refer_topic';

const ReferTopic: MarkdownElement = {
  Component: Render,
  remarkPlugin: createRemarkSelfClosingTagPlugin(REFER_TOPIC_TAG),
  scope: 'user',
  tag: REFER_TOPIC_TAG,
};

export default ReferTopic;
