export const fileSharePath = (shareId: string) => `/share/file/${encodeURIComponent(shareId)}`;

export const fileShareUrl = (origin: string, shareId: string) =>
  `${origin.replace(/\/+$/, '')}${fileSharePath(shareId)}`;
