import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

/**
 * Length of the raw artifact source in the message.
 *
 * Do not count the rendered `children` instead: artifact newlines are stripped before markdown
 * parsing, so paired backticks / `*` inside the code become inline elements that the rehype
 * plugin drops, and a children-based count jumps back and forth while the artifact streams.
 */
export const useArtifactCodeLength = (id: string, identifier: string) =>
  useChatStore((s) => chatPortalSelectors.artifactCode(id, identifier)(s).length);
