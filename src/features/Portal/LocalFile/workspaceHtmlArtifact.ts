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
  packed?: { html: string; sidecars: WorkspaceHtmlArtifactFile[] };
  title: string;
  topicId: string;
}

export interface WorkspaceHtmlArtifactExisting {
  identifier: string;
  publicUrl?: string;
  revision?: number;
  status?: string;
}

export interface WorkspaceHtmlArtifactPublishResult {
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
