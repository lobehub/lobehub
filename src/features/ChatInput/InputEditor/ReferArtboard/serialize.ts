export interface ArtboardReference {
  artboardId: string;
  itemId: string;
  itemTitle: string;
  text: string;
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

export const serializeArtboardReference = (ref: ArtboardReference, t: Translate) =>
  [
    `> ${t('artboard.chat.quote', { target: `${ref.itemId} · ${ref.itemTitle}` })} · artboard ${ref.artboardId}`,
    ...(ref.text ? ref.text.split('\n').map((line) => `> ${line}`) : []),
  ].join('\n');

export const serializeArtboardReferences = (refs: ArtboardReference[], t: Translate) =>
  refs.map((ref) => serializeArtboardReference(ref, t)).join('\n\n');
