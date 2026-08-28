import type { AnalyticsManager } from '@lobehub/analytics';

import { trackProductUsageEvent } from '@/libs/analytics/productUsageEvent';

export type CreateAgentModalSubmitSource = 'blank' | 'manual' | 'example' | 'example_edited';

export type CreateAgentModalSkillSuggestionAction =
  | 'create_agent_anyway_clicked'
  | 'install_clicked'
  | 'install_failed'
  | 'install_succeeded'
  | 'open_skills_clicked'
  | 'shown'
  | 'try_in_lobeai_clicked';

interface TrackCreateAgentModalCreationSucceededParams {
  analytics?: AnalyticsManager | null;
  source: CreateAgentModalSubmitSource;
  type: 'agent' | 'group';
}

interface TrackCreateAgentModalSkillSuggestionActionParams {
  action: CreateAgentModalSkillSuggestionAction;
  analytics?: AnalyticsManager | null;
  selectedSkillIdentifier?: string;
  skillIdentifiers?: string[];
  source: CreateAgentModalSubmitSource;
}

export const trackCreateAgentModalCreationSucceeded = ({
  analytics,
  source,
  type,
}: TrackCreateAgentModalCreationSucceededParams) => {
  if (type !== 'agent') return Promise.resolve(false);

  return trackProductUsageEvent(
    {
      name: 'create_agent_modal_creation_succeeded',
      properties: {
        source,
        spm: 'home.create_agent_modal.submit',
        type,
      },
    },
    { analytics },
  );
};

export const trackCreateAgentModalSkillSuggestionAction = ({
  action,
  analytics,
  selectedSkillIdentifier,
  skillIdentifiers,
  source,
}: TrackCreateAgentModalSkillSuggestionActionParams) => {
  const properties: Record<string, number | string> = {
    action,
    source,
    spm: `home.create_agent_modal.skill_suggestion.${action}`,
  };

  if (skillIdentifiers) {
    properties.skill_count = skillIdentifiers.length;
    const [topSkillIdentifier] = skillIdentifiers;
    if (topSkillIdentifier) properties.top_skill_identifier = topSkillIdentifier;
  }

  if (selectedSkillIdentifier) {
    properties.selected_skill_identifier = selectedSkillIdentifier;
  }

  return trackProductUsageEvent(
    {
      name: 'create_agent_modal_skill_suggestion_action',
      properties,
    },
    { analytics },
  );
};
