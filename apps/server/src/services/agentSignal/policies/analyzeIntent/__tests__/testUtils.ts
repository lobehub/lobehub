import { createRuntimeProcessorContext } from '../../../runtime/context';

export const createFeedbackTestContext = () =>
  createRuntimeProcessorContext({
    backend: {
      async getGuardState() {
        return {};
      },
      async touchGuardState() {
        return {};
      },
    },
    scopeKey: 'topic:thread_1',
  });
