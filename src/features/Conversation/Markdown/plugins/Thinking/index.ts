import { THINKING_TAG } from '@/const/plugin';

import { createRemarkCustomTagPlugin } from '../remarkPlugins/createRemarkCustomTagPlugin';
import { type MarkdownElement } from '../type';
import Component from './Render';

const ThinkingElement: MarkdownElement = {
  Component,
  remarkPlugin: createRemarkCustomTagPlugin(THINKING_TAG),
  scope: 'assistant',
  tag: THINKING_TAG,
};

export default ThinkingElement;
