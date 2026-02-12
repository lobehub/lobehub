import { type FC } from 'react';

import { ARTIFACT_TAG } from '@/const/plugin';

import { type MarkdownElement, type MarkdownElementProps } from '../type';
import rehypePlugin from './rehypePlugin';
import Component from './Render';

const AntArtifactElement: MarkdownElement = {
  Component: Component as unknown as FC<MarkdownElementProps>,
  rehypePlugin,
  scope: 'assistant',
  tag: ARTIFACT_TAG,
};

export default AntArtifactElement;
