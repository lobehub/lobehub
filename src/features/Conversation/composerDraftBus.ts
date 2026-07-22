import { createWithEqualityFn } from 'zustand/traditional';

/**
 * A plain GLOBAL bridge into the main conversation composer, for surfaces that
 * render OUTSIDE the ConversationProvider (the chat portal pane is a layout
 * sibling of the conversation column, not a descendant). Such a surface must
 * never call `useConversationStore` — zustand-utils throws "have not used
 * zustand provider as an ancestor" and the error boundary eats the whole page.
 *
 * Shape mirrors MessageFromUrl: the outsider only posts a signal here; a
 * receiver mounted INSIDE the provider (ComposerDraftReceiver) applies it to
 * the editor + input state, where both are legally reachable.
 */
interface ComposerDraftBusState {
  /** A receiver with a live editor is mounted and will consume drafts. */
  attached: boolean;
  /** The pending draft, cleared by the receiver once applied. */
  draft: { text: string } | null;
}

export const useComposerDraftBus = createWithEqualityFn<ComposerDraftBusState>()(() => ({
  attached: false,
  draft: null,
}));

/**
 * Post a draft for the main composer. Returns false when no composer is
 * listening (portal open on a surface without a conversation) so the caller
 * can skip its success feedback — same contract the portal previously got
 * from a null editor.
 */
export const draftToMainComposer = (text: string): boolean => {
  if (!useComposerDraftBus.getState().attached) return false;
  useComposerDraftBus.setState({ draft: { text } });
  return true;
};
