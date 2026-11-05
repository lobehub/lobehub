const notExercised = async () => {
  throw new Error('BUSINESS_MUTATION_OUTSIDE_STYLE_FIXTURE');
};

const evalActions = { updateTestCase: notExercised };
export const useEvalStore = <T>(selector: (state: typeof evalActions) => T): T =>
  selector(evalActions);

export const agentEvalService = {
  createTestCase: notExercised,
  listAllDatasets: async () => [{ id: 'dataset-1', name: 'Regression set' }],
};

export const useActiveWorkspaceSlug = () => undefined;
