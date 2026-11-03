export interface DeleteFilesResponse {
  errors?: { message: string; path: string }[];
  success: boolean;
}

export interface CreateFileParams {
  content: string; // Base64 encoded binary data
  filename: string;
  hash: string;
  path: string;
  type: string;
}

export interface FileMetadata {
  date: string;
  dirname: string;
  filename: string;
  path: string;
}
