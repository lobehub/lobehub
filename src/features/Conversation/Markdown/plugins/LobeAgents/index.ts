import { type FC } from 'react';

import { AGENTS_TAG } from '@/const/plugin';

import { type MarkdownElement, type MarkdownElementProps } from '../type';
import rehypePlugin from './rehypePlugin';
import Component from './Render';

const LobeAgentsElement: MarkdownElement = {
  Component: Component as unknown as FC<MarkdownElementProps>,
  rehypePlugin,
  scope: 'assistant',
  tag: AGENTS_TAG,
};

export default LobeAgentsElement;
