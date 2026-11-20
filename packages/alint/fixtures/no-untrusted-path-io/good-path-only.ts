import path from 'node:path';

// No IO here: the consuming boundary must authorize/confine before accessing files.
export const resolveAttachmentPath = (input: { path: string }) =>
  path.resolve('/srv/attachments', input.path);
