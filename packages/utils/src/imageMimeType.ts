import { fileTypeFromBuffer } from 'file-type';

const normalizeMimeType = (mimeType: string | null | undefined): string => {
  return mimeType?.split(';')[0]?.trim().toLowerCase() ?? '';
};

const getBytes = (input: ArrayBuffer | Uint8Array): Uint8Array =>
  input instanceof Uint8Array ? input : new Uint8Array(input);

const normalizeDetectedImageMimeType = (mimeType: string | undefined): string | undefined => {
  if (!mimeType?.startsWith('image/')) return undefined;

  return mimeType === 'image/jpg' ? 'image/jpeg' : mimeType;
};

const decodeBase64Header = (base64: string): Uint8Array | undefined => {
  const header = base64.replaceAll(/\s/g, '').slice(0, 64);
  if (!header) return undefined;

  try {
    const binary = atob(header);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return undefined;
  }
};

export const inferImageMimeTypeFromBytes = async (
  input: ArrayBuffer | Uint8Array,
): Promise<string | undefined> => {
  const fileType = await fileTypeFromBuffer(getBytes(input));

  return normalizeDetectedImageMimeType(fileType?.mime);
};

export const inferImageMimeTypeFromBase64 = async (base64: string | null | undefined) => {
  if (!base64) return undefined;

  const bytes = decodeBase64Header(base64);
  if (!bytes) return undefined;

  return await inferImageMimeTypeFromBytes(bytes);
};

export const resolveImageMimeTypeFromBytes = async (
  declaredMimeType: string | null | undefined,
  input: ArrayBuffer | Uint8Array,
): Promise<string> => {
  return (
    (await inferImageMimeTypeFromBytes(input)) ??
    (normalizeMimeType(declaredMimeType) || 'image/png')
  );
};

export const resolveImageMimeTypeFromBase64 = async (
  declaredMimeType: string | null | undefined,
  base64: string | null | undefined,
): Promise<string> => {
  return (
    (await inferImageMimeTypeFromBase64(base64)) ??
    (normalizeMimeType(declaredMimeType) || 'image/png')
  );
};
