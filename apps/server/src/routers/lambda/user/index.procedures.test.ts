// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { userRouter } from '.';

/**
 * Pins the router's public surface: every procedure path, its kind, and its
 * middleware chain length (which encodes the procedure builder and its input
 * parsers). Splitting the router across files must keep all three.
 */
describe('userRouter procedures', () => {
  const procedures = (userRouter as any)._def.procedures as Record<string, any>;

  it('exposes exactly the expected procedure paths', () => {
    expect(Object.keys(procedures).sort()).toEqual(expected().map(([name]) => name));
  });

  it.each(expected())('%s is a %s with %i middlewares', (name, type, middlewares) => {
    expect(procedures[name]._def.type).toBe(type);
    expect(procedures[name]._def.middlewares).toHaveLength(middlewares);
  });
});

function expected(): Array<
  [name: string, type: 'mutation' | 'query' | 'subscription', middlewares: number]
> {
  return [
    ['confirmOnboardingUnderstanding', 'mutation', 14],
    ['createOnboardingTasks', 'mutation', 13],
    ['finishOnboarding', 'mutation', 11],
    ['getOnboardingAgentContext', 'query', 10],
    ['getOnboardingBootstrapState', 'query', 10],
    ['getOnboardingTaskRecommendations', 'query', 13],
    ['getOnboardingUnderstanding', 'query', 14],
    ['getOrCreateOnboardingState', 'query', 10],
    ['getSupportedUnderstandingProviders', 'query', 13],
    ['getUserActivitySummary', 'query', 10],
    ['getUserRegistrationDuration', 'query', 10],
    ['getUserSSOProviders', 'query', 10],
    ['getUserState', 'query', 10],
    ['makeUserOnboarded', 'mutation', 10],
    ['patchOnboardingDocument', 'mutation', 11],
    ['readOnboardingDocument', 'query', 11],
    ['resetAgentOnboarding', 'mutation', 10],
    ['resetSettings', 'mutation', 10],
    ['retryOnboardingUnderstandingSource', 'mutation', 14],
    ['reviseOnboardingUnderstanding', 'mutation', 14],
    ['saveUserQuestion', 'mutation', 11],
    ['sendOnboardingFirstMessage', 'mutation', 11],
    ['startOnboardingUnderstanding', 'mutation', 14],
    ['updateAgentOnboarding', 'mutation', 11],
    ['updateAvatar', 'mutation', 11],
    ['updateFullName', 'mutation', 11],
    ['updateGuide', 'mutation', 11],
    ['updateInterests', 'mutation', 11],
    ['updateOnboarding', 'mutation', 11],
    ['updateOnboardingDocument', 'mutation', 11],
    ['updatePreference', 'mutation', 11],
    ['updateSettings', 'mutation', 11],
    ['updateToolChannels', 'mutation', 11],
    ['updateToolIntervention', 'mutation', 11],
    ['updateUninstalledBuiltinTools', 'mutation', 11],
    ['updateUsername', 'mutation', 11],
    ['watchOnboardingGenerationProgress', 'subscription', 13],
  ];
}
