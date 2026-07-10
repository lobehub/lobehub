import { type FC } from 'react';

import { type MarkdownElement, type MarkdownElementProps } from '../type';
import { LOBE_LINK_TAG } from './parse';
import { rehypeLobeLink } from './rehypePlugin';
import Render from './Render';

const LinkElement: MarkdownElement = {
  Component: Render as FC<MarkdownElementProps>,
  rehypePlugin: rehypeLobeLink,
  scope: 'all',
  tag: LOBE_LINK_TAG,
};

export default LinkElement;
