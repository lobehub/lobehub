import { TOOL_TAG } from '@lobechat/const';

import { createRemarkSelfClosingTagPlugin } from '../remarkPlugins/createRemarkSelfClosingTagPlugin';
import { type MarkdownElement } from '../type';
import Render from './Render';

const Tool: MarkdownElement = {
  Component: Render,
  remarkPlugin: createRemarkSelfClosingTagPlugin(TOOL_TAG),
  scope: 'user',
  tag: TOOL_TAG,
};

export default Tool;
