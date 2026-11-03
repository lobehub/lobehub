import { parseAsBoolean, useQueryState } from './useQueryParam';

export const useShowMobileWorkspace = () => {
  const [showMobileWorkspace] = useQueryState('showMobileWorkspace', parseAsBoolean);

  return showMobileWorkspace;
};
