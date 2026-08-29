import type { TrajectoryNode, TrajectoryResult } from '@lobechat/agent-tracing';
import pc from 'picocolors';

const truncate = (text: string, max = 160) => {
  const oneLine = text.replaceAll(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
};

export const printTrajectoryNode = (node: TrajectoryNode, totalNodes: number) => {
  const label = `node ${node.nodeIndex + 1}/${totalNodes}  ${pc.dim(`step ${node.stepIndex}`)}`;

  if (node.attempt.error) {
    console.log(`${pc.red('✗')} ${label}`);
    console.log(pc.red(`    error: ${node.attempt.error}`));
    return;
  }

  const mark = node.divergence ? pc.yellow('≠') : pc.green('✓');
  console.log(`${mark} ${label}  ${pc.dim(`${node.attempt.durationMs}ms`)}`);

  if (node.divergence) {
    console.log(pc.yellow(`    ${node.divergence.field}`));
    console.log(pc.yellow(`      recorded  ${node.divergence.recorded || '(final answer)'}`));
    console.log(pc.yellow(`      replayed  ${node.divergence.replayed || '(final answer)'}`));
  } else if (node.recorded.toolSignature) {
    console.log(pc.dim(`    ${node.recorded.toolSignature}`));
  }

  if (node.attempt.content) console.log(pc.dim(`    ${truncate(node.attempt.content)}`));
};

export const printTrajectorySummary = (result: TrajectoryResult) => {
  const replayed = result.nodes.length;
  const diverged = result.nodes.filter((node) => node.divergence).length;

  console.log('');
  console.log(pc.bold('Trajectory'));
  console.log(`  nodes replayed  ${replayed}/${result.totalNodes}`);

  const failed = result.nodes.filter((node) => node.attempt.error).length;

  console.log(
    diverged === 0
      ? `  ${pc.green('every node matched the recorded tool sequence')}`
      : `  ${pc.yellow(`${diverged}/${replayed} nodes chose different tools`)}`,
  );
  if (failed > 0) {
    console.log(`  ${pc.red(`${failed}/${replayed} nodes did not reach the model`)}`);
  }

  if (result.reproduction) {
    const verdict = result.reproduction.passed ? pc.green('PASS') : pc.red('FAIL');
    console.log(
      `  reproduction    ${verdict} ${result.reproduction.score.toFixed(2)} ${pc.dim(
        result.reproduction.reason ?? '',
      )}`,
    );
  }
};
