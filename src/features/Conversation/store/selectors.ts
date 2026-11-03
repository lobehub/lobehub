import { contextSelectors } from './slices/context/selectors';
import { dataSelectors } from './slices/data/selectors';
import { inputSelectors } from './slices/input/selectors';
import { messageStateSelectors } from './slices/messageState/selectors';
import { virtuaListSelectors } from './slices/virtuaList/selectors';

export { contextSelectors } from './slices/context/selectors';
export { dataSelectors } from './slices/data/selectors';
export { inputSelectors } from './slices/input/selectors';
export { messageStateSelectors } from './slices/messageState/selectors';
export { virtuaListSelectors } from './slices/virtuaList/selectors';

export const conversationSelectors = {
  ...contextSelectors,
  ...dataSelectors,
  ...inputSelectors,
  ...messageStateSelectors,
  ...virtuaListSelectors,
};
