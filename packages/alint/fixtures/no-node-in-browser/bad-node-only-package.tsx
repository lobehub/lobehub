// Fixture: a browser component importing a package that spawns git.
import { memo, useEffect, useState } from 'react';
// alint-expect
import { simpleGit } from 'simple-git';

export const BranchBadge = memo<{ cwd: string }>(({ cwd }) => {
  const [branch, setBranch] = useState('');
  useEffect(() => {
    simpleGit(cwd)
      .branchLocal()
      .then((result) => setBranch(result.current));
  }, [cwd]);
  return <span>{branch}</span>;
});
