import { AttachmentThumbs } from 'verification:component';

const picture = (width: number, height: number) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#4a7"/></svg>`,
  )}`;

const attachments = [
  { id: 'wide', name: 'Wide screenshot', url: picture(800, 400) },
  { id: 'tall', name: 'Tall screenshot', url: picture(300, 900) },
];

export const Fixture = ({ variant }: { variant: string }) => (
  <AttachmentThumbs
    attachments={attachments}
    size={variant.endsWith('comment') ? 'comment' : 'chip'}
  />
);
