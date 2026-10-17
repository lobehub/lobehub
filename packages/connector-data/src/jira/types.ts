/** Bounded Jira project metadata. */
export interface JiraProject {
  /** Project summary. */
  description?: string;
  /**
   * Whether Jira marks the project private for the account (team-managed private
   * projects); `true` when Jira does not say. Permission schemes are not reflected.
   */
  isPrivate: boolean;
  /** Project key used in issue keys, such as `DP`. */
  key: string;
  /** Lead display name. */
  lead?: string;
  /** Project display name. */
  name: string;
  /** Jira product the project belongs to, such as `software` or `business`. */
  type?: string;
}

/** Bounded Jira issue metadata. */
export interface JiraIssue {
  /** Assignee display name; email addresses are never kept. */
  assignee?: string;
  /** Issue key, such as `DP-7`. */
  key: string;
  /** Label names. */
  labels: string[];
  /** Priority name, such as `High`. */
  priority?: string;
  /** Key of the owning project. */
  projectKey?: string;
  /** Workflow status name and category, such as `In Progress` / `In Progress`. */
  status?: { category?: string; name: string };
  /** Issue summary. */
  summary: string;
  /** Issue type name, such as `Task` or `Bug`. */
  type?: string;
  /** ISO last update timestamp. */
  updatedAt?: string;
  /** Browser URL of the issue. */
  url: string;
}

/** Read-only Jira client used by Connector Data consumers. */
export interface JiraConnectorClient {
  /** Lists the projects the account can browse. */
  listProjects: (input?: { maxResults?: number }) => Promise<JiraProject[]>;
  /** Lists the most recently updated issues in the given projects. */
  listRecentIssues: (input: { maxResults?: number; projectKeys: string[] }) => Promise<JiraIssue[]>;
}
