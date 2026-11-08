export interface WorkspaceHtmlArtifactFile {
  content: string;
  contentType: string;
  encoding: 'base64' | 'utf8';
  path: string;
}

export interface WorkspaceHtmlArtifactPublishInput {
  agentId?: string;
  entryPath: string;
  files: WorkspaceHtmlArtifactFile[];
  identifier: string;
  onUploadPhase?: (phase: 'finalizing' | 'preparing' | 'uploading') => void;
  onUploadProgress?: (progress: {
    completedFiles: number;
    loadedBytes: number;
    totalBytes: number;
    totalFiles: number;
  }) => void;
  packed?: { html: string; sidecars: WorkspaceHtmlArtifactFile[] };
  signal?: AbortSignal;
  title: string;
  topicId: string;
}

export interface WorkspaceHtmlArtifactExisting {
  id?: string;
  identifier: string;
  publicUrl?: string;
  revision?: number;
  status?: string;
}

export interface WorkspaceHtmlArtifactPublishResult {
  id?: string;
  publicUrl?: string;
  revision?: number;
}

export interface WorkspaceHtmlArtifactPublisher {
  available: boolean;
  getExisting: (input: {
    identifier: string;
    topicId: string;
  }) => Promise<WorkspaceHtmlArtifactExisting | null>;
  publish: (
    input: WorkspaceHtmlArtifactPublishInput,
  ) => Promise<WorkspaceHtmlArtifactPublishResult>;
}
