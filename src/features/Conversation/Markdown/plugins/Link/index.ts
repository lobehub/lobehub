import { type FC } from 'react';

import { EntityLinkElement } from '@/features/EntityLink';

import { type MarkdownElement, type MarkdownElementProps } from '../type';

/**
 * Binds the host-agnostic entity-link capability to the conversation markdown
 * plugin registry.
 *
 * The parsing, rendering and click behaviour live in `@/features/EntityLink`:
 * the conversation is one host among several, and reading surfaces mount the
 * same element through `useEntityMarkdown()`.
 */
const LinkElement: MarkdownElement = {
  Component: EntityLinkElement.Component as FC<MarkdownElementProps>,
  rehypePlugin: EntityLinkElement.rehypePlugin,
  scope: 'all',
  tag: EntityLinkElement.tag,
};

export default LinkElement;
