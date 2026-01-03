import { AgentBuilderApiName } from '../../types';
import InstallPlugin from './InstallPlugin';

/**
 * Agent Builder Intervention Components Registry
 * Only register APIs that have custom intervention UI
 */
export const AgentBuilderInterventions = {
  [AgentBuilderApiName.installPlugin]: InstallPlugin,
};
