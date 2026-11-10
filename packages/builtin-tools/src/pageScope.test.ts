import { CloudSandboxManifest } from '@lobechat/builtin-tool-cloud-sandbox';
import type { HumanInterventionRule } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { resolveCloudSandboxInPageScope } from './pageScope';

const resolve = resolveCloudSandboxInPageScope(CloudSandboxManifest);

const interventionOf = (scope: string, apiName: string) =>
  resolve({ scope } as any)!.api.find((api) => api.name === apiName)?.humanIntervention;

// The first rule whose regex matches the command wins, as in InterventionChecker.
const policyForCommand = (command: string) => {
  const rules = interventionOf('page', 'runCommand') as HumanInterventionRule[];
  return rules.find((rule) => {
    const matcher = rule.match?.command;
    if (!matcher) return true;
    return typeof matcher === 'object' && new RegExp(matcher.pattern).test(command);
  })?.policy;
};

describe('cloud sandbox in page scope', () => {
  it('edits files without asking', () => {
    for (const apiName of ['editFile', 'executeCode', 'moveFiles', 'writeFile']) {
      expect(interventionOf('page', apiName)).toBe('never');
    }
  });

  it('runs page commands without asking', () => {
    expect(policyForCommand("sed -i 's/a/b/' /mnt/page/doc.xml")).toBe('never');
  });

  it('still asks before an lh command, which acts on the user account', () => {
    expect(policyForCommand('lh doc edit docs_1 -b x')).toBe('required');
    expect(policyForCommand('cd /tmp && lh agent list')).toBe('required');
    expect(policyForCommand("bash -c 'timeout 60 lh kb list'")).toBe('required');
  });

  it('does not mistake a path or word containing lh for the CLI', () => {
    expect(policyForCommand('cat /mnt/page/lh.txt')).toBe('never');
    expect(policyForCommand('echo highlight')).toBe('never');
  });

  it('keeps the manifest outside page scope', () => {
    expect(resolve({ scope: 'main' } as any)).toBe(CloudSandboxManifest);
  });
});
