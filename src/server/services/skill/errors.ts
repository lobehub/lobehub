import { z } from 'zod';

export class SkillParseError extends Error {
  cause?: Error;

  constructor(message: string, cause?: Error) {
    super(message);
    this.name = 'SkillParseError';
    this.cause = cause;
  }
}

export class SkillManifestError extends Error {
  zodError?: z.ZodError;

  constructor(message: string, zodError?: z.ZodError) {
    super(message);
    this.name = 'SkillManifestError';
    this.zodError = zodError;
  }
}

export class SkillResourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkillResourceError';
  }
}

export class SkillImportError extends Error {
  code: 'CONFLICT' | 'INVALID_URL' | 'NOT_FOUND' | 'DOWNLOAD_FAILED' | 'FILE_NOT_FOUND';

  constructor(
    message: string,
    code: 'CONFLICT' | 'INVALID_URL' | 'NOT_FOUND' | 'DOWNLOAD_FAILED' | 'FILE_NOT_FOUND',
  ) {
    super(message);
    this.name = 'SkillImportError';
    this.code = code;
  }
}
