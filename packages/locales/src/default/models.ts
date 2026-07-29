import { LOBE_DEFAULT_MODEL_LIST } from 'model-bank';

import { modelDescriptionOverrides } from '../modelDescriptionOverrides';

const locales: Record<`${string}.description`, string> = {};

LOBE_DEFAULT_MODEL_LIST.forEach((model) => {
  if (!model.description) return;

  locales[`${model.id}.description`] = model.description;
});

Object.assign(locales, modelDescriptionOverrides);

export default locales;
