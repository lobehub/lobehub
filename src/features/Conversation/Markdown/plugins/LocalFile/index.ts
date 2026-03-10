import { type FC } from 'react';

import { LOCAL_FILE_TAG } from '@/const/plugin';

import { createRemarkSelfClosingTagPlugin } from '../remarkPlugins/createRemarkSelfClosingTagPlugin';
import { type MarkdownElement, type MarkdownElementProps } from '../type';
import RenderComponent from './Render';

// Define the tag name for this element

const LocalFileElement: MarkdownElement = {
  Component: RenderComponent as FC<MarkdownElementProps>,
  remarkPlugin: createRemarkSelfClosingTagPlugin(LOCAL_FILE_TAG),
  scope: 'assistant',
  tag: LOCAL_FILE_TAG,
};

export default LocalFileElement;
