import { Profiler, type ProfilerOnRenderCallback, type ReactNode } from 'react';

import {
  isRenderProfileEnabled,
  recordRegionRender,
  type RenderProfileRegion,
} from '@/libs/renderProfile';

interface RenderProfilerProps {
  children: ReactNode;
  region: RenderProfileRegion;
}

const onRender: ProfilerOnRenderCallback = (id, phase, actualDuration, _base, _start, commit) => {
  recordRegionRender(id as RenderProfileRegion, phase, actualDuration, commit);
};

/**
 * Counts renders of one screen region for render-budget E2E runs. Ordinary
 * production builds fold `isRenderProfileEnabled()` to `false` and render the
 * children directly, so the wrapper adds nothing to the tree there.
 */
export const RenderProfiler = ({ children, region }: RenderProfilerProps) => {
  if (!isRenderProfileEnabled()) return children;

  return (
    <Profiler id={region} onRender={onRender}>
      {children}
    </Profiler>
  );
};
