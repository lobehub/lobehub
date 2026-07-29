import { modelDescriptionOverrides } from '../modelDescriptionOverrides';

/**
 * The client already receives each model's English description with its model card and uses it as
 * i18next's defaultValue. Keep only app-owned overrides in the browser namespace so loading the
 * models locale does not import the complete model-bank catalog.
 */
export default modelDescriptionOverrides;
