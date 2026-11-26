export interface DocumentChunk {
  id?: string;
  metadata: Record<string, any>;
  pageContent: string;
}

export type FileLoaderType =
  | 'code'
  | 'ppt'
  | 'pdf'
  | 'markdown'
  | 'doc'
  | 'docx'
  | 'text'
  | 'latex'
  | 'csv'
  | 'excel'
  | 'epub'
  | 'ipynb';
