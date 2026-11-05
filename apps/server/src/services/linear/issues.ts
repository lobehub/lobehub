import type {
  LinearIssueStateType,
  LinearProjectSummary,
  LinearTeamSummary,
} from '@lobechat/types';

import { linearGraphql } from './client';

/** Linear's largest page size. */
export const LINEAR_PAGE_SIZE = 50;

/** An issue with everything a sync writes into a task. */
export interface LinearIssue {
  assignee?: { displayName: string } | null;
  description?: string | null;
  id: string;
  identifier: string;
  labels?: { nodes: { name: string }[] };
  parent?: { id: string } | null;
  priority: number;
  project?: { id: string; name: string } | null;
  state: { name: string; type: LinearIssueStateType };
  team: { id: string; key: string };
  title: string;
  updatedAt: string;
  url: string;
}

const ISSUE_FIELDS = `
  id identifier title description url priority updatedAt
  state { name type }
  parent { id }
  assignee { displayName }
  labels(first: 10) { nodes { name } }
  project { id name }
  team { id key }
`;

interface Connection<T> {
  nodes: T[];
  pageInfo: { endCursor?: string | null; hasNextPage: boolean };
}

export const listLinearTeams = async (accessToken: string): Promise<LinearTeamSummary[]> => {
  const teams: LinearTeamSummary[] = [];
  let after: string | undefined;
  do {
    const data = await linearGraphql<{ teams: Connection<LinearTeamSummary> }>(
      accessToken,
      `query LobeTeams($first: Int!, $after: String) {
        teams(first: $first, after: $after) {
          nodes { id key name }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { after, first: LINEAR_PAGE_SIZE },
    );
    teams.push(...data.teams.nodes);
    after = data.teams.pageInfo.hasNextPage
      ? (data.teams.pageInfo.endCursor ?? undefined)
      : undefined;
  } while (after);
  return teams.sort((a, b) => a.name.localeCompare(b.name));
};

export const listLinearProjects = async (
  accessToken: string,
  teamId: string,
): Promise<LinearProjectSummary[]> => {
  const projects: LinearProjectSummary[] = [];
  let after: string | undefined;
  do {
    const data = await linearGraphql<{ team: { projects: Connection<LinearProjectSummary> } }>(
      accessToken,
      `query LobeTeamProjects($teamId: String!, $first: Int!, $after: String) {
        team(id: $teamId) {
          projects(first: $first, after: $after) {
            nodes { id name }
            pageInfo { hasNextPage endCursor }
          }
        }
      }`,
      { after, first: LINEAR_PAGE_SIZE, teamId },
    );
    const page = data.team.projects;
    projects.push(...page.nodes);
    after = page.pageInfo.hasNextPage ? (page.pageInfo.endCursor ?? undefined) : undefined;
  } while (after);
  return projects.sort((a, b) => a.name.localeCompare(b.name));
};

export interface LinearIssueFilter {
  linearProjectId?: string | null;
  stateTypes: LinearIssueStateType[];
  teamId: string;
}

/**
 * A project filters by project alone: a Linear project can belong to several
 * teams, and its issues may all live in a team other than the chosen one.
 */
const toIssueFilter = ({ linearProjectId, stateTypes, teamId }: LinearIssueFilter) => ({
  state: { type: { in: stateTypes } },
  ...(linearProjectId
    ? { project: { id: { eq: linearProjectId } } }
    : { team: { id: { eq: teamId } } }),
});

/** Ids of every team a project belongs to; none when the project does not exist. */
export const getLinearProjectTeamIds = async (
  accessToken: string,
  projectId: string,
): Promise<string[]> => {
  const ids: string[] = [];
  let after: string | undefined;
  do {
    const data = await linearGraphql<{
      project: { teams: Connection<{ id: string }> } | null;
    }>(
      accessToken,
      `query LobeProjectTeams($projectId: String!, $first: Int!, $after: String) {
        project(id: $projectId) {
          teams(first: $first, after: $after) {
            nodes { id }
            pageInfo { hasNextPage endCursor }
          }
        }
      }`,
      { after, first: LINEAR_PAGE_SIZE, projectId },
    );
    if (!data.project) return ids;
    const page = data.project.teams;
    ids.push(...page.nodes.map((team) => team.id));
    after = page.pageInfo.hasNextPage ? (page.pageInfo.endCursor ?? undefined) : undefined;
  } while (after);
  return ids;
};

/** One page of issues matching a filter, most recently updated first. */
export const listLinearIssues = async (
  accessToken: string,
  filter: LinearIssueFilter,
  options: { after?: string; first?: number } = {},
): Promise<{ cursor?: string; hasMore: boolean; issues: LinearIssue[] }> => {
  const data = await linearGraphql<{ issues: Connection<LinearIssue> }>(
    accessToken,
    `query LobeIssues($first: Int!, $after: String, $filter: IssueFilter) {
      issues(first: $first, after: $after, orderBy: updatedAt, filter: $filter) {
        nodes { ${ISSUE_FIELDS} }
        pageInfo { hasNextPage endCursor }
      }
    }`,
    {
      after: options.after,
      filter: toIssueFilter(filter),
      first: Math.min(options.first ?? LINEAR_PAGE_SIZE, LINEAR_PAGE_SIZE),
    },
  );
  const { nodes, pageInfo } = data.issues;
  return {
    cursor: pageInfo.hasNextPage ? (pageInfo.endCursor ?? undefined) : undefined,
    hasMore: pageInfo.hasNextPage,
    issues: nodes,
  };
};

/** Issues by id, in pages of the API's maximum size. Unknown or inaccessible ids are omitted. */
export const getLinearIssuesByIds = async (
  accessToken: string,
  ids: string[],
): Promise<LinearIssue[]> => {
  const issues: LinearIssue[] = [];
  for (let start = 0; start < ids.length; start += LINEAR_PAGE_SIZE) {
    const batch = ids.slice(start, start + LINEAR_PAGE_SIZE);
    const data = await linearGraphql<{ issues: Connection<LinearIssue> }>(
      accessToken,
      `query LobeIssuesById($first: Int!, $filter: IssueFilter) {
        issues(first: $first, filter: $filter) {
          nodes { ${ISSUE_FIELDS} }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { filter: { id: { in: batch } }, first: batch.length },
    );
    issues.push(...data.issues.nodes);
  }
  return issues;
};

/** A comment on an issue, with what a sync copies onto the task. */
export interface LinearIssueComment {
  body: string;
  /** An integration that posted it, possibly on someone's behalf. */
  botActor?: { name?: string | null; userDisplayName?: string | null } | null;
  createdAt: string;
  /** Someone outside the organization, e.g. through a support integration. */
  externalUser?: { name: string } | null;
  id: string;
  issueId?: string | null;
  /** Set on a reply; the id of the comment it answers. */
  parentId?: string | null;
  url: string;
  user?: { displayName: string; name: string } | null;
}

/**
 * Every comment on the given issues, replies included, oldest first. Unknown or
 * inaccessible issues have none.
 */
export const listLinearIssueComments = async (
  accessToken: string,
  issueIds: string[],
): Promise<LinearIssueComment[]> => {
  const comments: LinearIssueComment[] = [];
  const ids = [...new Set(issueIds)];
  for (let start = 0; start < ids.length; start += LINEAR_PAGE_SIZE) {
    const batch = ids.slice(start, start + LINEAR_PAGE_SIZE);
    let after: string | undefined;
    do {
      const data = await linearGraphql<{ comments: Connection<LinearIssueComment> }>(
        accessToken,
        `query LobeIssueComments($first: Int!, $after: String, $filter: CommentFilter) {
          comments(first: $first, after: $after, filter: $filter, orderBy: createdAt) {
            nodes {
              id body url createdAt issueId parentId
              user { displayName name }
              externalUser { name }
              botActor { name userDisplayName }
            }
            pageInfo { hasNextPage endCursor }
          }
        }`,
        { after, filter: { issue: { id: { in: batch } } }, first: LINEAR_PAGE_SIZE },
      );
      comments.push(...data.comments.nodes);
      after = data.comments.pageInfo.hasNextPage
        ? (data.comments.pageInfo.endCursor ?? undefined)
        : undefined;
    } while (after);
  }
  return comments.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
};
