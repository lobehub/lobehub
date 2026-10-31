/** Linear organization identity for the authorized account. */
export interface LinearOrganization {
  /** Organization display name. */
  name: string;
  /** Organization URL key, the first path segment of `linear.app` links. */
  urlKey?: string;
}

/** Cycle currently running for a team. */
export interface LinearCycle {
  /** ISO cycle end timestamp. */
  endsAt?: string;
  /** Optional cycle name. */
  name?: string;
  /** Cycle number within the team. */
  number: number;
  /** Completion ratio between 0 and 1. */
  progress?: number;
  /** ISO cycle start timestamp. */
  startsAt?: string;
}

/** Bounded team metadata. */
export interface LinearTeam {
  /** Cycle in progress, when the team runs cycles. */
  activeCycle?: LinearCycle;
  /** Team description. */
  description?: string;
  /** Short team key used in issue identifiers, such as `ENG`. */
  key: string;
  /** Number of members returned for the team (bounded to the first 100). */
  memberCount?: number;
  /** True when the team has more members than `memberCount` counted. */
  memberCountIsLowerBound?: boolean;
  /** Team display name. */
  name: string;
  /** `public`, `private`, or `restricted` (a team inside a private-team boundary). */
  visibility?: string;
}

/** Bounded project metadata. */
export interface LinearProject {
  /** Project summary. */
  description?: string;
  /** Lead display name. */
  lead?: string;
  /** Project display name. */
  name: string;
  /** Completion ratio between 0 and 1. */
  progress?: number;
  /** Project status name and category, such as `In Progress` / `started`. */
  status?: { name: string; type: string };
  /** ISO target date. */
  targetDate?: string;
  /** Keys of the teams the project belongs to. */
  teamKeys: string[];
  /** Project URL in Linear. */
  url: string;
}

/** Bounded issue metadata. */
export interface LinearIssue {
  /** Assignee display name. */
  assignee?: string;
  /** Issue identifier, such as `ENG-123`. */
  identifier: string;
  /** Label names. */
  labels: string[];
  /** Priority label, such as `High`. */
  priority?: string;
  /** Project name, when the issue belongs to one. */
  project?: string;
  /** Workflow state name and category, such as `In Review` / `started`. */
  state?: { name: string; type: string };
  /** Key of the owning team. */
  teamKey?: string;
  /** Issue title. */
  title: string;
  /** ISO last update timestamp. */
  updatedAt?: string;
  /** Issue URL in Linear. */
  url: string;
}

/** Paging and scope for the list reads. */
export interface LinearListInput {
  /** Page size, clamped to 1–50. */
  first?: number;
  /** Read only public teams and the issues and projects that belong to them. */
  publicTeamsOnly?: boolean;
}

/** Read-only Linear client used by Connector Data consumers. */
export interface LinearConnectorClient {
  /** Reads the organization of the authorized account. */
  getOrganization: () => Promise<LinearOrganization>;
  /** Lists the most recently updated issues the account can see. */
  listRecentIssues: (input?: LinearListInput) => Promise<LinearIssue[]>;
  /** Lists the most recently updated projects. */
  listRecentProjects: (input?: LinearListInput) => Promise<LinearProject[]>;
  /** Lists teams with their active cycles. */
  listTeams: (input?: LinearListInput) => Promise<LinearTeam[]>;
}
