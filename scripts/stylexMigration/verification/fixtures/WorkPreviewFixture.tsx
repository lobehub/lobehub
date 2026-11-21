import { WorkPreview } from 'verification:component';

import { getWorkPreviewItem } from './WorkPreviewData';

export const Fixture = ({ variant }: { variant: string }) => (
  <WorkPreview
    item={getWorkPreviewItem(variant.replace(/-(light|dark)$/, ''))}
    title="A detailed preview title"
  />
);
