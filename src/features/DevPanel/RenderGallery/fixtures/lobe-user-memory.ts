'use client';

import { defineFixtures, single, variants } from './_helpers';

export default defineFixtures({
  identifier: 'lobe-user-memory',
  fixtures: {
    addExperienceMemory: single({
      args: {
        details: 'A reusable preview harness saved time compared with manual screenshot stitching.',
        summary: 'Building /devtools made visual QA faster and repeatable.',
        tags: ['devtools', 'preview', 'qa'],
        title: 'Preview harness rollout',
        withExperience: {
          action: 'Built a development-only route backed by stable sample fixtures.',
          keyLearning: 'Reusable preview pages reduce repeated manual validation work.',
          possibleOutcome: 'Future render additions can be checked in one place.',
          reasoning: 'A route-based harness is easier to maintain than ad hoc screenshot scripts.',
          situation: 'We needed to verify many builtin tool cards quickly.',
        },
      },
    }),
    addPreferenceMemory: single({
      args: {
        details: 'Prefer route-based previews for UI verification over isolated screenshots.',
        summary: 'Use reusable local preview routes for internal QA.',
        tags: ['workflow', 'frontend'],
        title: 'Preview workflow preference',
        withPreference: {
          appContext: {
            app: 'LobeHub Desktop',
            feature: 'Builtin tool rendering',
            surface: '/devtools',
          },
          conclusionDirectives:
            'Keep fixtures close to the route and update them when new renders land.',
          originContext: {
            actor: 'Frontend engineer',
            applicableWhen: 'Adding or refactoring tool renders',
            scenario: 'Need to verify many cards at once',
            trigger: 'A screenshot or local QA request comes in',
          },
          suggestions: ['Add a preview fixture before shipping a new render.'],
          type: 'workflow',
        },
      },
    }),
    searchUserMemory: variants([
      {
        label: 'Has results',
        pluginState: {
          activities: [
            {
              feedback: 'The page made local validation much easier.',
              id: 'activity_devtools',
              narrative: 'Implemented a dev-only /devtools route for builtin render previews.',
              notes: 'Devtools preview route',
              tags: ['preview', 'devtools'],
              type: 'engineering',
            },
          ],
          experiences: [
            {
              action: 'Adopted a route-based preview harness.',
              id: 'experience_devtools',
              keyLearning: 'Stable fixtures are cheaper than repeating manual screenshots.',
              situation: 'Needed to verify many render components in one place.',
              tags: ['render', 'qa'],
            },
          ],
          preferences: [
            {
              conclusionDirectives:
                'Prefer reusable preview infrastructure for repeated UI checks.',
              id: 'preference_devtools',
              tags: ['workflow'],
              title: 'Preview harness preference',
            },
          ],
        },
      },
      {
        label: 'No results',
        pluginState: {
          activities: [],
          experiences: [],
          preferences: [],
        },
      },
    ]),
  },
});
