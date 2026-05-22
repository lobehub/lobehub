import { SKILL_TAG } from '@lobechat/const';

import { createRemarkSelfClosingTagPlugin } from '../remarkPlugins/createRemarkSelfClosingTagPlugin';
import { type MarkdownElement } from '../type';
import Render from './Render';

const Skill: MarkdownElement = {
  Component: Render,
  remarkPlugin: createRemarkSelfClosingTagPlugin(SKILL_TAG),
  scope: 'user',
  tag: SKILL_TAG,
};

export default Skill;
