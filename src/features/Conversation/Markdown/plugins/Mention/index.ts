import { MENTION_TAG } from '@/const/plugin';

import { createRemarkSelfClosingTagPlugin } from '../remarkPlugins/createRemarkSelfClosingTagPlugin';
import type {MarkdownElement} from '../type';
import Component from './Render';

const Mention: MarkdownElement = {
  Component,
  remarkPlugin: createRemarkSelfClosingTagPlugin(MENTION_TAG),
  scope: 'user',
  tag: MENTION_TAG,
};

export default Mention;
