import { PullRequestDockActionButton } from 'verification:component';

const noop = () => {};
const onAction = async () => true;
const detail = { baseRefName: 'canary', headRefName: 'feat/fixture', headRefOid: 'abc123' };

const actions = {
  'merge-success': { kind: 'merge', method: 'squash', tone: 'success' },
  'merge-error': { admin: true, kind: 'merge', method: 'merge', tone: 'error' },
  'merge-plain': { kind: 'merge', method: 'rebase', tone: 'plain' },
  'update-busy': { busy: true, kind: 'updateBranch', tone: 'success' },
  'secondary': { kind: 'updateBranch', tone: 'success' },
} as const;

export const Fixture = ({ variant }: { variant: string }) => {
  const key = variant.replace(/^dark-/, '') as keyof typeof actions;
  return (
    <PullRequestDockActionButton
      action={actions[key]}
      bypass={false}
      detail={detail}
      secondary={key === 'secondary'}
      onAction={onAction}
      onPickMethod={noop}
      onToggleBypass={noop}
    />
  );
};
