import { ARTIFACT_THINKING_TAG } from '@/const/plugin';

import { createRemarkCustomTagPlugin } from '../remarkPlugins/createRemarkCustomTagPlugin';
import { type MarkdownElement } from '../type';
import Component from './Render';

const LobeThinkingElement: MarkdownElement = {
  Component,
  remarkPlugin: createRemarkCustomTagPlugin(ARTIFACT_THINKING_TAG),
  scope: 'assistant',
  tag: ARTIFACT_THINKING_TAG,
};

export default LobeThinkingElement;
