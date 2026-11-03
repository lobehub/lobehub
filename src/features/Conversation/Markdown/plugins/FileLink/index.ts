import { type FC } from 'react';

import { type MarkdownElement, type MarkdownElementProps } from '../type';
import { LOBE_FILE_LINK_TAG } from './parse';
import { rehypeFileLink } from './rehypePlugin';
import Render from './Render';

const FileLinkElement: MarkdownElement = {
  Component: Render as FC<MarkdownElementProps>,
  rehypePlugin: rehypeFileLink,
  scope: 'all',
  tag: LOBE_FILE_LINK_TAG,
};

export default FileLinkElement;
