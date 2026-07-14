export type WorkType = 'document' | 'external' | 'task';
export type LinearWorkResourceType = 'linear_document' | 'linear_issue';
export type GithubWorkResourceType = 'github_issue' | 'github_pull_request';
export type ExternalWorkResourceType = GithubWorkResourceType | LinearWorkResourceType;
export type WorkResourceType = 'document' | ExternalWorkResourceType | 'task';

export type WorkVersionChangeType = 'created' | 'updated';

export interface WorkVersionMetadata {
  agentDocumentId?: string;
}

export interface WorkVersionCumulativeUsage {
  capturedAt: string;
  cost?: unknown;
  usage?: unknown;
}
