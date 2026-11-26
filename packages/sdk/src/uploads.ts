import type { PostApiV1FilesData } from './generated/types.gen';

/** Anything `files.upload` accepts: a `File`/`Blob`, raw bytes, or a local path (Node, Bun, Deno). */
export type Uploadable = ArrayBuffer | Blob | Uint8Array | string;

export type UploadFields = Omit<PostApiV1FilesData['body'], 'file'>;

export interface UploadOptions extends UploadFields {
  /** File name sent to the server; defaults to the `File` name or the path's base name. */
  name?: string;
  /** MIME type; defaults to the `Blob` type (`application/octet-stream` for bytes). */
  type?: string;
}

const baseName = (path: string) => path.split(/[/\\]/).pop() || 'file';

/** Turn an `Uploadable` into a `File` the multipart serializer can send. */
export const toUploadFile = async (source: Uploadable, options: UploadOptions = {}) => {
  const { name, type } = options;

  if (typeof source === 'string') {
    // Loaded on demand (through a variable, so bundlers leave it alone) to
    // keep the SDK loadable in browsers.
    const fsModule = 'node:fs/promises';
    const { readFile } = (await import(/* @vite-ignore */ fsModule)) as {
      readFile: (path: string) => Promise<Uint8Array>;
    };
    const bytes = await readFile(source);
    return new File([bytes as BlobPart], name ?? baseName(source), {
      type: type ?? 'application/octet-stream',
    });
  }

  if (source instanceof Blob) {
    const fileName = name ?? (source instanceof File ? source.name : 'file');
    if (source instanceof File && !name && !type) return source;
    return new File([source], fileName, { type: type ?? source.type });
  }

  return new File([source as BlobPart], name ?? 'file', {
    type: type ?? 'application/octet-stream',
  });
};
