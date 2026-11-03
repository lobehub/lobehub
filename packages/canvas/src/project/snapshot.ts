export interface CanvasSnapshotFile {
  content: string;
  contentType: string;
  encoding: 'base64' | 'utf8';
  path: string;
}

export interface CanvasProjectSnapshot {
  entry: string;
  files: CanvasSnapshotFile[];
}

export interface CanvasPreviewProject {
  entry: string;
  files: Record<string, Omit<CanvasSnapshotFile, 'path'>>;
}
