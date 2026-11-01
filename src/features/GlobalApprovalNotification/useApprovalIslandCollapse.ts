import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from 'react';

/**
 * Owns the approval island's collapsed/expanded state and the ONE piece of
 * auto-expand logic that is easy to get wrong.
 *
 * The island auto-expands only on the idle → active transition (`prevCount`
 * was 0). Once the user collapses it, further approvals from a still-busy run
 * must NOT pop it back open — re-expanding fights the user's explicit choice;
 * the pill's live count is the only signal they need. A naive
 * `count > prevCount` check regresses exactly this case.
 */
export const useApprovalIslandCollapse = (
  count: number,
): [boolean, Dispatch<SetStateAction<boolean>>] => {
  const [collapsed, setCollapsed] = useState(false);
  const prevCount = useRef(0);

  useEffect(() => {
    if (prevCount.current === 0 && count > 0) setCollapsed(false);
    prevCount.current = count;
  }, [count]);

  return [collapsed, setCollapsed];
};
