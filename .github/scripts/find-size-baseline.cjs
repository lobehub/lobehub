/**
 * Find the most recent successful `canary` push run of a workflow that
 * contains a given size-baseline artifact, and return its run id (or '' when
 * none exists). Used with actions/download-artifact's `run-id` input:
 *
 *   const finder = require('<workspace>/.github/scripts/find-size-baseline.js');
 *   return await finder({ github, context, workflowId: 'e2e.yml', artifactName: 'bundle-size-baseline-web' });
 *
 * The returned string becomes the step's `result` output (empty string = no
 * baseline yet, callers should skip the download step and let the gate degrade
 * to a warning).
 */
const findSizeBaseline = async ({ github, context, workflowId, artifactName, artifactPrefix }) => {
  const { data } = await github.rest.actions.listWorkflowRuns({
    branch: 'canary',
    event: 'push',
    owner: context.repo.owner,
    per_page: 20,
    repo: context.repo.repo,
    status: 'success',
    workflow_id: workflowId,
  });

  for (const run of data.workflow_runs) {
    const { data: artifacts } = await github.rest.actions.listWorkflowRunArtifacts({
      owner: context.repo.owner,
      per_page: 100,
      repo: context.repo.repo,
      run_id: run.id,
    });

    const match = artifacts.artifacts.find((artifact) =>
      artifactName ? artifact.name === artifactName : artifact.name.startsWith(artifactPrefix),
    );

    if (match) {
      console.log(`Found baseline artifact "${match.name}" in run ${run.id} (${run.created_at})`);
      return String(run.id);
    }
  }

  console.warn(
    `No baseline artifact found in recent canary runs of ${workflowId} — gate will skip.`,
  );
  return '';
};

module.exports = findSizeBaseline;
