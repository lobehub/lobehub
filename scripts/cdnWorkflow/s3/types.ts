export interface ImgInfo {
  [propName: string]: any;
  buffer: Buffer;
  extname: string;
  fileName: string;
}

export interface S3UserConfig {
  accessKeyId: string;
  bucketName: string;
  endpoint: string;
  pathPrefix: string;
  pathStyleAccess?: boolean;
  region: string;
  secretAccessKey: string;
  uploadPath?: string;
}

export interface UploadResult {
  eTag?: string;
  imgURL: string;
  key: string;
  url: string;
  versionId?: string;
}
