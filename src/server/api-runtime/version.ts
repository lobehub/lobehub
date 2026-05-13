import pkg from '../../../package.json';

export interface VersionResponseData {
  version: string;
}

export const versionAPIHandler = (_request: Request): Response =>
  Response.json({
    version: pkg.version,
  } satisfies VersionResponseData);
