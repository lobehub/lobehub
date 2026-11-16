export interface TfsCredentials {
  authType: 'ntlm' | 'pat';
  secret: string;
  username: string;
}

export interface TfsConnectionStatus {
  collectionUrl: string | null;
  configured: boolean;
  hasBinding: boolean;
  identity: { login: string; updatedAt: string } | null;
}

export interface TfsProject {
  id: string;
  name: string;
}

export interface TfsRepository {
  defaultBranch?: string;
  id: string;
  name: string;
  project: TfsProject;
  remoteUrl: string;
}

export interface TfsPage<T> {
  items: T[];
  next?: string;
}

export interface TfsReadItem {
  detail?: string;
  id: string;
  label: string;
  logId?: number;
  state?: string;
  url?: string;
}

export interface TfsReadResult {
  items: TfsReadItem[];
  next?: string;
}
