export interface ArtboardReference {
  artboardId: string;
  itemId: string;
  itemKind: 'frame' | 'note';
  itemTitle: string;
  kind: 'comment' | 'decision';
  text: string;
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

export const serializeArtboardReference = (ref: ArtboardReference, t: Translate) => {
  const target =
    ref.itemKind === 'frame'
      ? `${ref.itemId} · ${ref.itemTitle}`
      : t('artboard.chat.stickyTarget', { text: ref.itemTitle });
  const body = ref.kind === 'decision' ? t('artboard.chat.decided', { text: ref.text }) : ref.text;
  return [
    `> ${t('artboard.chat.quote', { target })} · artboard ${ref.artboardId}`,
    ...body.split('\n').map((line) => `> ${line}`),
  ].join('\n');
};

export const serializeArtboardReferences = (refs: ArtboardReference[], t: Translate) =>
  refs.map((ref) => serializeArtboardReference(ref, t)).join('\n\n');
