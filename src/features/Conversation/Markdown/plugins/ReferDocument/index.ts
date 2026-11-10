import { REFER_DOCUMENT_TAG } from '@/features/ChatInput/InputEditor/ReferDocument/referDocumentTag';

import { createRemarkSelfClosingTagPlugin } from '../remarkPlugins/createRemarkSelfClosingTagPlugin';
import { type MarkdownElement } from '../type';
import Render from './Render';

const ReferDocument: MarkdownElement = {
  Component: Render,
  remarkPlugin: createRemarkSelfClosingTagPlugin(REFER_DOCUMENT_TAG),
  scope: 'user',
  tag: REFER_DOCUMENT_TAG,
};

export default ReferDocument;
