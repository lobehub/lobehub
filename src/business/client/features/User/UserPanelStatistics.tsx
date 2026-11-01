import DataStatistics from '@/features/User/DataStatistics';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

/**
 * Statistics section of the user panel. Business slot: the default renders the
 * personal data statistics cards linked to the stats page; overrides may swap
 * in a context-aware statistics surface.
 */
export default function UserPanelStatistics() {
  return (
    <WorkspaceLink style={{ color: 'inherit' }} to={'/settings/stats'}>
      <DataStatistics />
    </WorkspaceLink>
  );
}
