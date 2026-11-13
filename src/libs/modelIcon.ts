import LobeModelIcon from '@lobehub/icons/es/features/ModelIcon';
import LobeModelTag from '@lobehub/icons/es/features/ModelTag';

import { registerLocalIconMappings } from './lobeIconMappings';

registerLocalIconMappings();

// Plain `export const` on purpose, for the same rolldown reason as ./providerIcon.
export const ModelIcon = LobeModelIcon;
export const ModelTag = LobeModelTag;
