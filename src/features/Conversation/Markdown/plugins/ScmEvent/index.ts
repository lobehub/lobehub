import { SCM_EVENT_TAG } from '@/const/plugin';

import { type MarkdownElement } from '../type';
import { remarkScmEventBlock } from './remarkScmEventBlock';
import Component from './Render';

const ScmEventElement: MarkdownElement = {
  Component,
  remarkPlugin: remarkScmEventBlock,
  scope: 'user',
  tag: SCM_EVENT_TAG,
};

export default ScmEventElement;
