'use client';

import { type MarkdownProps } from '@lobehub/ui';
import { useMemo } from 'react';

import EntityLinkElement from './element';

/**
 * Markdown props for surfaces that read LobeHub-authored content outside the
 * conversation — a goal's delivered document, a deliverable reader, a report
 * chapter.
 *
 * Internal links (acceptance / task / goal / document / agent / verify) render
 * as inline chips carrying the entity's own title, with the hover preview and
 * the same click destination the conversation uses, instead of a raw URL that
 * navigates the reader away.
 *
 * Only the provider-free link element is mounted: the rest of the conversation
 * plugin set needs chat context these hosts do not provide.
 */
export const useEntityMarkdown = (): Partial<MarkdownProps> => {
  const components = useMemo(() => ({ [EntityLinkElement.tag]: EntityLinkElement.Component }), []);

  return useMemo(
    () => ({ components, rehypePlugins: [EntityLinkElement.rehypePlugin] }),
    [components],
  );
};
