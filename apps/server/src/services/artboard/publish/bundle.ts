import {
  ARTBOARD_SNAPSHOT_ELEMENT_ID,
  type ArtboardPublishSnapshot,
  type CanvasPublishBundle,
  type CanvasPublishFile,
} from '@lobechat/types';

import { canvasSitePrefix, deploymentSitePath, imageSitePath } from './snapshot';

export interface ArtboardPublishCanvasBundle {
  bundle: CanvasPublishBundle;
  canvasId: string;
  entry: string;
  version: number;
}

export interface ArtboardPublishDeployment {
  deploymentId: string;
  html: string;
  revision: number;
}

export interface ArtboardPublishImage {
  bytes: Uint8Array;
  contentType: string;
  fileId: string;
}

export interface ArtboardPublishBundleInput {
  canvases: ArtboardPublishCanvasBundle[];
  deployments?: ArtboardPublishDeployment[];
  images: ArtboardPublishImage[];
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

const canvasFiles = ({ bundle, canvasId, entry, version }: ArtboardPublishCanvasBundle) => {
  const prefix = `/${canvasSitePrefix(canvasId, version)}`;
  const page = (path: string): CanvasPublishFile => ({
    content: bundle.html,
    contentType: 'text/html; charset=utf-8',
    encoding: 'utf8',
    path: `${prefix}/${path}`,
  });
  return [
    page('index.html'),
    ...(entry === 'index.html' ? [] : [page(entry)]),
    ...bundle.files.map((file) => ({ ...file, path: `${prefix}${file.path}` })),
  ];
};

export const buildArtboardPublishBundle = ({
  canvases,
  deployments = [],
  images,
  snapshot,
  viewerUrl,
}: ArtboardPublishBundleInput): CanvasPublishBundle => ({
  files: [
    ...canvases.flatMap(canvasFiles),
    ...deployments.map((page): CanvasPublishFile => ({
      content: page.html,
      contentType: 'text/html; charset=utf-8',
      encoding: 'utf8',
      path: `/${deploymentSitePath(page.deploymentId, page.revision)}`,
    })),
    ...images.map((image): CanvasPublishFile => ({
      content: Buffer.from(image.bytes).toString('base64'),
      contentType: image.contentType,
      encoding: 'base64',
      path: `/${imageSitePath(image.fileId)}`,
    })),
  ],
  html: indexHtml(snapshot, viewerUrl),
});
