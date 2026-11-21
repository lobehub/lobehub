import { ReviewFileList } from 'verification:component';

import { FixtureI18n } from './FixtureI18n';
import { flatRepo, groupedRepo } from './ReviewFileListFixtureData';

const composerTarget = { reason: 'read-only', writable: false } as const;

export const Fixture = ({ variant }: { variant: string }) => (
  <FixtureI18n>
    <div style={{ display: 'flex', flexDirection: 'column', maxWidth: 480 }}>
      <ReviewFileList
        active
        composerTarget={composerTarget}
        showTree={false}
        workingDirectory={variant === 'flat' ? flatRepo : groupedRepo}
        onToggleTree={() => {}}
      />
    </div>
  </FixtureI18n>
);
