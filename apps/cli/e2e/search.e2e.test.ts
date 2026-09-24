import { execSync } from 'node:child_process';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * E2E tests for `lh search` global search command.
 *
 * Prerequisites:
 * - `lh` CLI is installed and linked globally
 * - User is authenticated (`lh login` completed)
 * - Network access to the LobeHub server
 */

const CLI = process.env.LH_CLI_PATH || 'lh';
const TIMEOUT = 30_000;

interface SearchResult {
  id: string;
  title?: string;
  type: string;
}

function run(args: string): string {
  return execSync(`${CLI} ${args}`, {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH}` },
    timeout: TIMEOUT,
  }).trim();
}

function runJson<T>(args: string): T {
  return JSON.parse(run(args)) as T;
}

function extractId(output: string, pattern: RegExp): string {
  const match = output.match(pattern);
  expect(match).not.toBeNull();
  return match![1];
}

describe('lh search - E2E', () => {
  const fixtureKey = `E2ESearch${Date.now()}`;
  const agentIds: string[] = [];
  let docId: string;

  beforeAll(async () => {
    for (let index = 1; index <= 4; index += 1) {
      const output = run(
        `agent create -t "${fixtureKey} Agent ${index}" -d "Owned search fixture ${fixtureKey}"`,
      );
      agentIds.push(extractId(output, /Created agent\s+(\S+)/));
    }

    const output = run(
      `doc create -t "${fixtureKey} Document" -b "Owned search fixture ${fixtureKey}"`,
    );
    docId = extractId(output, /Created document\s+(docs_\w+)/);

    // Elasticsearch deployments project writes asynchronously. Wait for our
    // fixtures using read-only queries; never retry creation or accept an empty result.
    await vi.waitFor(
      () => {
        expect({
          agents: runJson<SearchResult[]>(
            `search --query "${fixtureKey}" --type agent --json -L 10`,
          ).map(({ id }) => id),
          pages: runJson<SearchResult[]>(
            `search --query "${fixtureKey}" --type page --json -L 10`,
          ).map(({ id }) => id),
        }).toEqual({
          agents: expect.arrayContaining(agentIds),
          pages: expect.arrayContaining([docId]),
        });
      },
      { interval: 2000, timeout: 60_000 },
    );
  }, 120_000);

  afterAll(() => {
    const errors: unknown[] = [];
    if (docId) {
      try {
        run(`doc delete ${docId} --yes`);
      } catch (error) {
        errors.push(error);
      }
    }
    for (const id of agentIds) {
      try {
        run(`agent delete ${id} --yes`);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, 'Search fixture cleanup failed');
  });

  it('searches the owned agent and document fixtures by query', () => {
    const results = runJson<SearchResult[]>(`search --query "${fixtureKey}" --json -L 10`);

    expect(Array.isArray(results)).toBe(true);
    expect(results).toContainEqual(expect.objectContaining({ id: docId, type: 'page' }));
    // Untyped search deliberately caps each group at three in FtsSearchRepo.
    // Explicitly typed search is the path that uses the requested limit.
    const agents = results.filter((result) => result.type === 'agent');
    expect(agents).toHaveLength(3);
    expect(agents.every((result) => agentIds.includes(result.id))).toBe(true);
  });

  it('filters results by type', () => {
    const results = runJson<SearchResult[]>(
      `search --query "${fixtureKey}" --type page --json -L 10`,
    );

    expect(results).toContainEqual(expect.objectContaining({ id: docId, type: 'page' }));
    expect(results.every((result) => result.type === 'page')).toBe(true);
    expect(results.some((result) => agentIds.includes(result.id))).toBe(false);
  });

  it('applies the requested limit to an explicit result type', () => {
    const results = runJson<SearchResult[]>(
      `search --query "${fixtureKey}" --type agent --json -L 2`,
    );
    expect(results).toHaveLength(2);
    expect(results.every((result) => result.type === 'agent' && agentIds.includes(result.id))).toBe(
      true,
    );
  });

  it('reports the exact error for an invalid type', () => {
    try {
      run(`search --query "${fixtureKey}" --type invalidtype`);
      throw new Error('Expected search to reject an invalid type');
    } catch (error) {
      const stderr = (error as { stderr?: string }).stderr?.trim();
      expect(stderr).toBe(
        'Invalid type: invalidtype. Must be one of: agent, topic, file, folder, message, page, memory, mcp, plugin, communityAgent, knowledgeBase',
      );
    }
  });
});
