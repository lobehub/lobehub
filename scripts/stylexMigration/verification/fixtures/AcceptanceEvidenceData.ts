const svg = (width: number, height: number, fill: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="${fill}"/></svg>`,
  )}`;

interface Capture {
  height?: number;
  type: 'gif' | 'screenshot' | 'video';
  width?: number;
}

const pair = (id: string, { height, type, width }: Capture) =>
  (['before', 'after'] as const).map((role) => ({
    description: `${role} capture`,
    fileHeight: height ?? null,
    fileName: null,
    fileUrl:
      type === 'video'
        ? 'data:video/mp4;base64,AAAA'
        : svg(width ?? 640, height ?? 400, role === 'before' ? '#d33' : '#3a3'),
    fileWidth: width ?? null,
    id: `${id}-${role}`,
    metadata: { comparison: { id, label: `${id} ${role}`, role } },
    type,
  }));

const captures: Record<string, Capture[]> = {
  gif: [{ type: 'gif' }],
  screenshot: [{ height: 400, type: 'screenshot', width: 640 }],
  tall: [{ height: 1700, type: 'screenshot', width: 390 }],
  unsized: [{ type: 'screenshot' }],
  video: [{ type: 'video' }],
};

export const evidenceFor = (variant: string) =>
  (captures[variant.replace(/^dark-/, '')] ?? []).flatMap((capture, index) =>
    pair(`${capture.type}-${index}`, capture),
  );

export const useTextFileLoader = () => ({ error: null, fileData: null, loading: false });

export const TerminalEvidenceCard = () => {
  throw new Error('UNMOUNTED_SIBLING_RENDERED_IN_STYLE_FIXTURE');
};

export const useAcceptanceBundle = () => {
  throw new Error('UNMOUNTED_SIBLING_RENDERED_IN_STYLE_FIXTURE');
};
