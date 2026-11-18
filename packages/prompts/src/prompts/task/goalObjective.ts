/** One lane of the leaderboard, as a Task run's prompt lists it. */
export interface TaskRunPromptObjectiveLane {
  best: number;
  evaluations: number;
  lane: string;
  latest: number;
  title: string;
}

export interface TaskRunPromptGoalObjective {
  direction: 'max' | 'min';
  evaluator: string;
  /** Best lane first; already capped by the caller. */
  lanes: TaskRunPromptObjectiveLane[];
  title?: string;
  /** This run's lane id. */
  you?: string;
}

const formatScore = (value: number) => String(Number(value.toFixed(4)));

/**
 * The `<goal_objective>` section of a Goal Task run: what score the goal
 * pushes, how to grade with `lh goal evaluate`, and where every lane stands.
 */
export const buildGoalObjectiveSection = ({
  direction,
  evaluator,
  lanes,
  title,
  you,
}: TaskRunPromptGoalObjective): string => {
  const name = title || 'the objective score';
  const board =
    lanes.length > 0
      ? [
          'Leaderboard (best first):',
          ...lanes.map(
            (lane, index) =>
              `${index + 1}. ${lane.title}${lane.lane === you ? ' (your lane)' : ''} — best ${formatScore(lane.best)}, latest ${formatScore(lane.latest)}, ${lane.evaluations} evaluation(s)`,
          ),
        ].join('\n')
      : 'No evaluation recorded yet.';
  return [
    '<goal_objective>',
    `This Goal ${direction === 'max' ? 'maximises' : 'minimises'} ${name} (${direction === 'max' ? 'higher' : 'lower'} is better).`,
    `Grade your work with \`lh goal evaluate\` from your working directory: it runs \`${evaluator}\` there, records the score for your lane and prints the score and feedback (\`-d\` for details). Evaluate as soon as something runs, then after each improvement. Do not edit or bypass the evaluator, and do not report a score it did not produce.`,
    board,
    '</goal_objective>',
  ].join('\n');
};
