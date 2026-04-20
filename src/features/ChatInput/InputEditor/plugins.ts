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
import { type Editor } from '@lobehub/editor/react';

import { ReactActionTagPlugin } from './ActionTag';
import { ReactReferTopicPlugin } from './ReferTopic';

type EditorPlugins = NonNullable<Parameters<typeof Editor>[0]['plugins']>;

interface CreateChatInputRichPluginsOptions {
  linkPlugin?: EditorPlugins[number];
  mathPlugin?: EditorPlugins[number];
}

export const CHAT_INPUT_EMBED_PLUGINS: EditorPlugins = [
  ReactActionTagPlugin,
  ReactReferTopicPlugin,
  ReactMentionPlugin,
];

export const createChatInputRichPlugins = ({
  linkPlugin = ReactLinkHighlightPlugin,
  mathPlugin = ReactMathPlugin,
}: CreateChatInputRichPluginsOptions = {}): EditorPlugins => [
  ReactListPlugin,
  ReactCodePlugin,
  ReactCodemirrorPlugin,
  ReactHRPlugin,
  linkPlugin,
  ReactVirtualBlockPlugin,
  mathPlugin,
  ...CHAT_INPUT_EMBED_PLUGINS,
];
