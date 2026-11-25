import { useEffect } from 'react';

import { loadArtboardTool } from './loadArtboardTool';
import { useArtboardFeature } from './useArtboardFeature';
import { useOpenArtboardFromRoute } from './useOpenArtboardFromRoute';

export const useRegisterArtboardTool = () => {
  const { enabled } = useArtboardFeature();
  useEffect(() => {
    if (enabled) void loadArtboardTool();
  }, [enabled]);
  useOpenArtboardFromRoute();
};
