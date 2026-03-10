import { type FC } from 'react';

import { type MarkdownElement, type MarkdownElementProps } from '../type';
import { IMAGE_SEARCH_REF_TAG, rehypeImageSearchRef } from './rehypePlugin';
import Render from './Render';

const ImageSearchRefElement: MarkdownElement = {
  Component: Render as FC<MarkdownElementProps>,
  rehypePlugin: rehypeImageSearchRef,
  scope: 'assistant',
  tag: IMAGE_SEARCH_REF_TAG,
};

export default ImageSearchRefElement;
