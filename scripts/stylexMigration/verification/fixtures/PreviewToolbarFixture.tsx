import { EyeIcon } from 'lucide-react';
import { PreviewToolbar } from 'verification:component';

import { ToolbarActionButton } from '@/features/Portal/LocalFile/PreviewToolbar';

export const Fixture = ({ variant }: { variant: string }) => (
  <PreviewToolbar
    path="/workspace/components/example.tsx"
    rootPath="/workspace"
    actions={
      variant === 'no-actions' ? undefined : variant === 'hidden-actions' ? (
        []
      ) : (
        <ToolbarActionButton
          active={variant === 'dark-actions'}
          icon={EyeIcon}
          label="Preview file"
        />
      )
    }
  />
);
