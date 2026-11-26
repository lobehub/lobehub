import {
  ARTBOARD_SITE_FILES_DIR,
  ARTBOARD_SNAPSHOT_ELEMENT_ID,
  type ArtboardPublishSnapshot,
  type CanvasPublishBundle,
  type CanvasPublishFile,
} from '@lobechat/types';

export interface ArtboardPublishFile {
  bytes: Uint8Array;
  contentType: string;
  path: string;
}

export interface ArtboardPublishBundleInput {
  files: ArtboardPublishFile[];
  snapshot: ArtboardPublishSnapshot;
  viewerUrl: string;
}

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const scriptSafeJson = (value: unknown) =>
  JSON.stringify(value)
    .replaceAll('<', String.raw`\u003c`)
    .replaceAll('\u2028', String.raw`\u2028`)
    .replaceAll('\u2029', String.raw`\u2029`);

const indexHtml = (snapshot: ArtboardPublishSnapshot, viewerUrl: string) =>
  [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(snapshot.title)}</title>`,
    `<script defer src="${escapeHtml(viewerUrl)}"></script>`,
    '</head>',
    '<body>',
    '<div id="root"></div>',
    `<script type="application/json" id="${ARTBOARD_SNAPSHOT_ELEMENT_ID}">${scriptSafeJson(snapshot)}</script>`,
    '</body>',
    '</html>',
  ].join('');

export const buildArtboardPublishBundle = ({
  files,
  snapshot,
  viewerUrl,
}: ArtboardPublishBundleInput): CanvasPublishBundle => ({
  files: files.map((file): CanvasPublishFile => ({
    content: Buffer.from(file.bytes).toString('base64'),
    contentType: file.contentType,
    encoding: 'base64',
    path: `/${ARTBOARD_SITE_FILES_DIR}${file.path}`,
  })),
  html: indexHtml(snapshot, viewerUrl),
});
