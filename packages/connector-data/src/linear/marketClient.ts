import { toRecord } from '@lobechat/utils/object';
import debug from 'debug';

import { ConnectorDataError, getConnectorErrorMessage } from '../errors';
import { withConnectorRetry } from '../retry';
import type {
  LinearConnectorClient,
  LinearCycle,
  LinearIssue,
  LinearOrganization,
  LinearProject,
  LinearTeam,
} from './types';

const DEFAULT_TEAMS = 20;
const DEFAULT_PROJECTS = 20;
const DEFAULT_ISSUES = 40;
const MAX_PAGE_SIZE = 50;
const log = debug('lobe-server:connector-data:linear');

/** Read-only GraphQL documents sent through the Market OAuth proxy (`https://api.linear.app`). */
export const LINEAR_QUERIES = {
  issues: `query LinearRecentIssues($first: Int!, $filter: IssueFilter) {
  issues(first: $first, orderBy: updatedAt, filter: $filter) {
    nodes {
      identifier title url updatedAt priorityLabel
      state { name type }
      team { key }
      assignee { displayName }
      labels(first: 5) { nodes { name } }
      project { name }
    }
  }
}`,
  organization: `query LinearOrganization {
  organization { name urlKey }
}`,
  projects: `query LinearRecentProjects($first: Int!, $filter: ProjectFilter) {
  projects(first: $first, orderBy: updatedAt, filter: $filter) {
    nodes {
      name description progress targetDate url
      status { name type }
      lead { displayName }
      teams(first: 5) { nodes { key } }
    }
  }
}`,
  teams: `query LinearTeams($first: Int!, $filter: TeamFilter) {
  teams(first: $first, filter: $filter) {
    nodes {
      key name description visibility
      activeCycle { number name startsAt endsAt progress }
      members(first: 100) { nodes { id } pageInfo { hasNextPage } }
    }
  }
}`,
} as const;

/** One Market OAuth proxy request for the `linear` provider. */
export interface LinearMarketProxyRequest {
  body?: unknown;
  endpoint: string;
  method: 'POST';
  provider: 'linear';
}

/** Minimal Market client required by the read-only Linear connector. */
export interface LinearMarketClient {
  /** Forwards one request to the provider API with the connected account's token. */
  proxyOAuthRequest: (input: LinearMarketProxyRequest) => Promise<unknown>;
}

/** Options for creating a Market-backed Linear connector client. */
export interface CreateLinearMarketConnectorClientOptions {
  /** User-scoped Market client authenticated through Trusted Client or OAuth. */
  market: LinearMarketClient;
}

const str = (value: unknown) => (typeof value === 'string' && value ? value : undefined);
const num = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const nodes = (value: unknown): Record<string, unknown>[] => {
  const list = toRecord(value)?.nodes;
  return Array.isArray(list)
    ? list.map((item) => toRecord(item)).filter((item) => item !== undefined)
    : [];
};
// `restricted` teams sit inside a private-team boundary, so only `public` counts as public.
const PUBLIC_TEAM = { visibility: { eq: 'public' } };
const PUBLIC_FILTERS = {
  issues: { team: PUBLIC_TEAM },
  projects: { accessibleTeams: { every: PUBLIC_TEAM } },
  teams: PUBLIC_TEAM,
} as const;

const pageSize = (first: number | undefined, fallback: number) =>
  Math.min(Math.max(1, Math.trunc(first ?? fallback)), MAX_PAGE_SIZE);

const statusOf = (value: unknown) => {
  const record = toRecord(value);
  const name = str(record?.name);
  const type = str(record?.type);
  return name && type ? { name, type } : undefined;
};

const parseCycle = (value: unknown): LinearCycle | undefined => {
  const record = toRecord(value);
  const number = num(record?.number);
  if (number === undefined) return;
  return {
    endsAt: str(record?.endsAt),
    name: str(record?.name),
    number,
    progress: num(record?.progress),
    startsAt: str(record?.startsAt),
  };
};

/**
 * Creates a bounded, read-only Linear client over the LobeHub Market OAuth proxy.
 *
 * Use when:
 * - Onboarding analysis should read the Linear workspace an admin connected through Market
 *
 * Expects:
 * - `market` proxies to `https://api.linear.app` for an already-connected `linear` provider
 *
 * Returns:
 * - A client that normalizes GraphQL nodes and surfaces HTTP and GraphQL errors as
 *   connector errors
 */
export const createLinearMarketConnectorClient = ({
  market,
}: CreateLinearMarketConnectorClientOptions): LinearConnectorClient => {
  const query = async (
    operation: string,
    document: string,
    variables: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> =>
    withConnectorRetry(async () => {
      const response = toRecord(
        await market.proxyOAuthRequest({
          body: { query: document, variables },
          endpoint: '/graphql',
          method: 'POST',
          provider: 'linear',
        }),
      );
      const status = num(response?.status);
      const body = toRecord(response?.data);
      const errors = Array.isArray(body?.errors) ? body.errors : [];
      const data = toRecord(body?.data);

      // GraphQL may answer with partial data plus errors (an unresolvable nested
      // node); keep what was read as long as a requested field came back.
      if (
        status === undefined ||
        status < 200 ||
        status >= 300 ||
        !data ||
        Object.values(data).every((value) => value === null)
      ) {
        throw new ConnectorDataError({
          cause: { errors, status },
          code: `linear_${operation}_failed`,
          message:
            getConnectorErrorMessage(toRecord(errors[0])?.message) ??
            `Linear ${operation} failed${status === undefined ? '' : ` (HTTP ${status})`}`,
          operation,
          provider: 'linear',
          // Rate limits and upstream hiccups recover; auth and query errors do not.
          retryable: status === 429 || (status !== undefined && status >= 500),
        });
      }
      if (errors.length > 0) log('Linear %s returned partial data: %O', operation, errors);
      return data;
    });

  return {
    getOrganization: async (): Promise<LinearOrganization> => {
      const organization = toRecord(
        (await query('getOrganization', LINEAR_QUERIES.organization)).organization,
      );
      return { name: str(organization?.name) ?? '', urlKey: str(organization?.urlKey) };
    },
    listRecentIssues: async ({ first, publicTeamsOnly } = {}) => {
      const data = await query('listRecentIssues', LINEAR_QUERIES.issues, {
        filter: publicTeamsOnly ? PUBLIC_FILTERS.issues : null,
        first: pageSize(first, DEFAULT_ISSUES),
      });
      return nodes(data.issues).flatMap((issue): LinearIssue[] => {
        const identifier = str(issue.identifier);
        const title = str(issue.title);
        const url = str(issue.url);
        if (!identifier || !title || !url) return [];
        return [
          {
            assignee: str(toRecord(issue.assignee)?.displayName),
            identifier,
            labels: nodes(issue.labels).flatMap(({ name }) => str(name) ?? []),
            priority: str(issue.priorityLabel),
            project: str(toRecord(issue.project)?.name),
            state: statusOf(issue.state),
            teamKey: str(toRecord(issue.team)?.key),
            title,
            updatedAt: str(issue.updatedAt),
            url,
          },
        ];
      });
    },
    listRecentProjects: async ({ first, publicTeamsOnly } = {}) => {
      const data = await query('listRecentProjects', LINEAR_QUERIES.projects, {
        filter: publicTeamsOnly ? PUBLIC_FILTERS.projects : null,
        first: pageSize(first, DEFAULT_PROJECTS),
      });
      return nodes(data.projects).flatMap((project): LinearProject[] => {
        const name = str(project.name);
        const url = str(project.url);
        if (!name || !url) return [];
        return [
          {
            description: str(project.description),
            lead: str(toRecord(project.lead)?.displayName),
            name,
            progress: num(project.progress),
            status: statusOf(project.status),
            targetDate: str(project.targetDate),
            teamKeys: nodes(project.teams).flatMap(({ key }) => str(key) ?? []),
            url,
          },
        ];
      });
    },
    listTeams: async ({ first, publicTeamsOnly } = {}) => {
      const data = await query('listTeams', LINEAR_QUERIES.teams, {
        filter: publicTeamsOnly ? PUBLIC_FILTERS.teams : null,
        first: pageSize(first, DEFAULT_TEAMS),
      });
      return nodes(data.teams).flatMap((team): LinearTeam[] => {
        const key = str(team.key);
        const name = str(team.name);
        if (!key || !name) return [];
        return [
          {
            activeCycle: parseCycle(team.activeCycle),
            description: str(team.description),
            key,
            memberCount: toRecord(team.members) ? nodes(team.members).length : undefined,
            memberCountIsLowerBound:
              toRecord(toRecord(team.members)?.pageInfo)?.hasNextPage === true || undefined,
            name,
            visibility: str(team.visibility),
          },
        ];
      });
    },
  };
};
