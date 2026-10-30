import { FilePathDisplay } from 'verification:component';

export const Fixture = ({ variant }: { variant: string }) => (
  <div style={{ alignItems: 'center', display: 'flex' }}>
    <FilePathDisplay
      isDirectory={variant === 'directory'}
      filePath={
        variant === 'image'
          ? '/project/images/example.png'
          : variant === 'directory'
            ? '/project/components'
            : '/project/src/example.tsx'
      }
    />
  </div>
);
