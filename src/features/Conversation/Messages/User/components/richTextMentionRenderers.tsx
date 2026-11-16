import { createDefaultRenderers, type NodeRenderer } from '@lobehub/editor/renderer';

import MentionProfileTrigger from '@/features/MemberProfileCard/MentionProfileTrigger';

const stockMention = createDefaultRenderers().get('mention');

/**
 * `LexicalRenderer` override for `mention` nodes: the stock chip, wrapped so
 * hovering an @Agent or @member shows their profile card. Mentions without an
 * id render exactly as before.
 */
export const renderProfileMention: NodeRenderer = (node, key, children) => {
  const chip = stockMention?.(node, key, children) ?? `@${node.label ?? ''}`;
  const id = typeof node.metadata?.id === 'string' ? node.metadata.id : undefined;
  if (!id) return chip;

  return (
    <MentionProfileTrigger
      agent={{ title: node.label || undefined }}
      id={id}
      key={key}
      type={typeof node.metadata?.type === 'string' ? node.metadata.type : undefined}
    >
      {chip}
    </MentionProfileTrigger>
  );
};

export const richTextMentionRenderers: Record<string, NodeRenderer> = {
  mention: renderProfileMention,
};
