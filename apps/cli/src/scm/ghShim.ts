import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { ghShimBinDir, ghShimConfigDir } from './credentialEnv';

const shimScript = (binDir: string, helperInvocation: string) => `#!/bin/sh
token=$(printf 'protocol=https\\nhost=github.com\\n\\n' | ${helperInvocation} get | sed -n 's/^password=//p')
if [ -z "$token" ]; then
  echo "gh: no GitHub credential was issued for this run" >&2
  exit 1
fi
shim_dir='${binDir}'
old_ifs=$IFS
IFS=:
for dir in $PATH; do
  [ "$dir" = "$shim_dir" ] && continue
  if [ -x "$dir/gh" ]; then
    IFS=$old_ifs
    GH_TOKEN="$token" exec "$dir/gh" "$@"
  fi
done
IFS=$old_ifs
echo "gh: GitHub CLI is not installed on this device" >&2
exit 127
`;

export const ensureGhShim = async (shimDir: string, helperInvocation: string): Promise<string> => {
  const binDir = ghShimBinDir(shimDir);
  await mkdir(binDir, { recursive: true });
  await mkdir(ghShimConfigDir(shimDir), { mode: 0o700, recursive: true });

  const shimPath = path.join(binDir, 'gh');
  // Runs on one device share this shim; rename swaps it whole, so a `gh`
  // started mid-write never executes an empty file and silently succeeds.
  const tmpPath = `${shimPath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  await writeFile(tmpPath, shimScript(binDir, helperInvocation), { mode: 0o755 });
  await rename(tmpPath, shimPath);
  return shimPath;
};
