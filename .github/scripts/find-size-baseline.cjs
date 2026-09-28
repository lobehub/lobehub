/**
 * Find the most recent successful `canary` push run whose commit is an ancestor
 * of the code being measured and contains a given size-baseline artifact. Return
 * its run id (or '' when none exists). Used with actions/download-artifact's
 * `run-id` input:
 *
 *   const finder = require('<workspace>/.github/scripts/find-size-baseline.js');
 *   return await finder({ github, context, workflowId: 'e2e.yml', artifactName: 'bundle-size-baseline-web', targetSha: context.sha });
 *
 * The returned string becomes the step's `result` output (empty string = no
 * baseline yet, callers should skip the download step and let the gate degrade
 * to a warning).
 */
const findSizeBaseline = async ({
  github,
  context,
  workflowId,
  artifactName,
  artifactPrefix,
  targetSha,
}) => {
  if (!targetSha) throw new Error('targetSha is required to select a lineage-safe baseline');

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
    const { data: comparison } = await github.request(
      'GET /repos/{owner}/{repo}/compare/{basehead}',
      {
        basehead: `${run.head_sha}...${targetSha}`,
        owner: context.repo.owner,
        repo: context.repo.repo,
      },
    );

    if (comparison.status !== 'ahead' && comparison.status !== 'identical') {
      console.log(
        `Skipping canary run ${run.id} (${run.head_sha}): not an ancestor of ${targetSha} (${comparison.status})`,
      );
      continue;
    }

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
