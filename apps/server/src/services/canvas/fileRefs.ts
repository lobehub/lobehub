import {
  CANVAS_LIMITS,
  type CanvasFileRefWrite,
  type CanvasIssue,
  getCanvasContentType,
  isCanvasTextPath,
} from '@lobechat/canvas';

export interface CanvasRefFile {
  fileType: string;
  id: string;
  name: string;
  size: number;
  url: string;
}

export interface CanvasFileRefResolverDeps {
  findFile: (id: string) => Promise<CanvasRefFile | undefined>;
  listMediaFileIds: () => Promise<Map<string, string | undefined>>;
  readBytes: (key: string) => Promise<Uint8Array>;
}

export interface CanvasFileRefResolution {
  contents: Map<string, string | Uint8Array>;
  issues: CanvasIssue[];
}

export type CanvasFileRefResolver = (
  writes: CanvasFileRefWrite[],
) => Promise<CanvasFileRefResolution>;

const MEDIA_REF_PATTERN = /^msg_[\da-z]+\.(?:audio|image|video)_\d+$/;

type MediaKind = 'audio' | 'font' | 'image' | 'text' | 'video';

const kindOf = (contentType: string): MediaKind | undefined => {
  const [type = '', subtype = ''] = contentType.split(';')[0].trim().toLowerCase().split('/');
  if (type === 'audio' || type === 'font' || type === 'image' || type === 'video') return type;
  if (subtype.includes('font')) return 'font';
  if (type === 'text' || subtype === 'json' || subtype.includes('javascript')) return 'text';
};

const unresolved = (path: string, fileRef: string): CanvasIssue => ({
  file: path,
  message: `fileRef "${fileRef}" does not match a file you can access. Use a file id from <file id> or an image ref from <image ref> in this conversation.`,
  rule: 'unresolved-file-ref',
});

export const createCanvasFileRefResolver =
  (deps: CanvasFileRefResolverDeps): CanvasFileRefResolver =>
  async (writes) => {
    const contents = new Map<string, string | Uint8Array>();
    const issues: CanvasIssue[] = [];
    let mediaFileIds: Map<string, string | undefined> | undefined;

    for (const { fileRef, path } of writes) {
      if (contents.has(fileRef)) continue;

      let fileId: string | undefined = fileRef;
      if (MEDIA_REF_PATTERN.test(fileRef)) {
        mediaFileIds ??= await deps.listMediaFileIds();
        fileId = mediaFileIds.get(fileRef);
      }
      const file = fileId ? await deps.findFile(fileId) : undefined;
      if (!file) {
        issues.push(unresolved(path, fileRef));
        continue;
      }

      const sourceKind = kindOf(file.fileType);
      const targetKind = kindOf(getCanvasContentType(path));
      if (sourceKind && targetKind && sourceKind !== targetKind) {
        issues.push({
          file: path,
          message: `fileRef "${fileRef}" is ${file.fileType}, which cannot be saved as a ${targetKind} file. Pick a path whose extension matches the file.`,
          rule: 'file-type-mismatch',
        });
        continue;
      }

      const isText = isCanvasTextPath(path);
      const limit = isText ? CANVAS_LIMITS.maxTextFileBytes : CANVAS_LIMITS.maxFileBytes;
      if (file.size > limit) {
        issues.push({
          file: path,
          message: `fileRef "${fileRef}" is ${file.size} bytes; the limit for this file type is ${limit} bytes.`,
          rule: 'file-too-large',
        });
        continue;
      }

      const bytes = await deps.readBytes(file.url);
      if (!isText) {
        contents.set(fileRef, bytes);
        continue;
      }
      try {
        contents.set(fileRef, new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      } catch {
        issues.push({
          file: path,
          message: `fileRef "${fileRef}" is not UTF-8 text, so it cannot be saved as a text file.`,
          rule: 'file-type-mismatch',
        });
      }
    }

    return { contents, issues };
  };
