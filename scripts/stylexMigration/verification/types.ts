export interface VerificationFinding {
  confirmed: boolean;
  id: string;
  reasonCode: string;
  severity: 'difference' | 'review';
}

export interface FixtureResult {
  aaStable: boolean;
  comparisons: number;
  id: string;
  nodeCount: number;
  propertyReads: number;
}

export interface RevisionIdentity {
  baseSha: string;
  candidateTreeSha: string;
  headSha: string;
  repository: string;
}

export interface SourceEntry {
  bytes: number;
  mode: string;
  oid: string;
  path: string;
  type: string;
}

export interface RevisionSession {
  directory: string;
  identity: RevisionIdentity;
  sourceRepository: string;
}

export interface ScopeUnit {
  blobSha: string;
  end: number;
  file: string;
  id: string;
  kind: 'source' | 'style-slot' | 'stylesheet' | 'opaque';
  label: string;
  side: 'base' | 'candidate';
  start: number;
}

export interface ScopeInventory {
  changedFiles: Array<{ after?: string; before?: string; status: string }>;
  hash: string;
  limitations: string[];
  units: ScopeUnit[];
}
