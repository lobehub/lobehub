import { useGlobalStore } from '@/store/global/index';
import { globalGeneralSelectors } from '@/store/global/selectors';

const getCurrentLanguage = () => globalGeneralSelectors.currentLanguage(useGlobalStore.getState());

export const globalHelpers = { getCurrentLanguage };
