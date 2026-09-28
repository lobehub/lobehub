const assert = require('node:assert/strict');
const { test } = require('node:test');

const findSizeBaseline = require('./find-size-baseline.cjs');

test('selects the newest baseline in the target commit lineage', async () => {
  const artifactRunIds = [];
  const github = {
    request: async (_route, { basehead }) => ({
      data: { status: basehead.startsWith('future...') ? 'diverged' : 'ahead' },
    }),
    rest: {
      actions: {
        listWorkflowRunArtifacts: async ({ run_id }) => {
          artifactRunIds.push(run_id);
          return { data: { artifacts: [{ name: 'baseline' }] } };
        },
        listWorkflowRuns: async () => ({
          data: {
            workflow_runs: [
              { created_at: 'later', head_sha: 'future', id: 300 },
              { created_at: 'earlier', head_sha: 'base', id: 200 },
            ],
          },
        }),
      },
    },
  };

  const result = await findSizeBaseline({
    artifactName: 'baseline',
    context: { repo: { owner: 'lobehub', repo: 'lobehub' } },
    github,
    targetSha: 'head',
    workflowId: 'e2e.yml',
  });

  assert.equal(result, '200');
  assert.deepEqual(artifactRunIds, [200]);
});
