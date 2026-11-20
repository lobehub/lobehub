export const CANVAS_RUNTIME_MAJOR = 1;

export interface CanvasManifestFile {
  contentType: string;
  hash: string;
  size: number;
}

export interface CanvasManifest {
  entry: string;
  files: Record<string, CanvasManifestFile>;
  runtimeMajor: number;
  schemaVersion: 1;
}
