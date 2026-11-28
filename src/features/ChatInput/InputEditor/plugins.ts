import {
  ReactCodemirrorPlugin,
  ReactCodePlugin,
  ReactHRPlugin,
  ReactLinkHighlightPlugin,
  ReactListPlugin,
  ReactMathPlugin,
  ReactMentionPlugin,
  ReactVirtualBlockPlugin,
} from '@lobehub/editor';
import { Editor } from '@lobehub/editor/react';

import { ReactActionTagPlugin } from './ActionTag';
import { ReactImageRefTagPlugin } from './ImageRefTag';
import { ReactLocalFileTagPlugin } from './LocalFileTag';
import { ReactReferArtboardPlugin } from './ReferArtboard';
import { ReactReferDocumentPlugin } from './ReferDocument';
import { ReactReferTopicPlugin } from './ReferTopic';

type EditorPlugins = NonNullable<Parameters<typeof Editor>[0]['plugins']>;

interface CreateChatInputRichPluginsOptions {
  linkPlugin?: EditorPlugins[number] | false;
  mathPlugin?: EditorPlugins[number] | false;
}

export const CHAT_INPUT_EMBED_PLUGINS: EditorPlugins = [
  ReactActionTagPlugin,
  ReactReferTopicPlugin,
  ReactReferDocumentPlugin,
  ReactReferArtboardPlugin,
  ReactLocalFileTagPlugin,
  ReactImageRefTagPlugin,
  ReactMentionPlugin,
];

/**
 * Chat messages are full of shell variables and prices (`$HOME … $PATH`,
 * `$5 and $10`), so typing or pasting a pair of single dollars must stay
 * plain text instead of becoming an inline formula. Block `$$` math and
 * formula nodes already stored in a message still render, matching the page
 * and task editors.
 */
export const CHAT_INPUT_MATH_PLUGIN_PROPS = { enableInlineMath: false } as const;

export const createChatInputRichPlugins = ({
  linkPlugin = ReactLinkHighlightPlugin,
  mathPlugin = Editor.withProps(ReactMathPlugin, CHAT_INPUT_MATH_PLUGIN_PROPS),
}: CreateChatInputRichPluginsOptions = {}): EditorPlugins => [
  ReactListPlugin,
  ReactCodePlugin,
  ReactCodemirrorPlugin,
  ReactHRPlugin,
  ...(linkPlugin ? [linkPlugin] : []),
  ReactVirtualBlockPlugin,
  ...(mathPlugin ? [mathPlugin] : []),
  ...CHAT_INPUT_EMBED_PLUGINS,
];
