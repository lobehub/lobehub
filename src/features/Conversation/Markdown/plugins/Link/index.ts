import { EntityLinkElement } from '@/features/EntityLink';

import { type MarkdownElement } from '../type';
import { ConversationLink } from './Render';

/**
 * Binds the host-agnostic entity-link capability to the conversation markdown
 * plugin registry.
 *
 * Conversation messages add topic actions to the shared entity-link renderer.
 */
const LinkElement: MarkdownElement = {
  Component: ConversationLink,
  rehypePlugin: EntityLinkElement.rehypePlugin,
  scope: 'all',
  tag: EntityLinkElement.tag,
};

export default LinkElement;
