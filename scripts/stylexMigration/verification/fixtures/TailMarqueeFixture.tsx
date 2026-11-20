import { TailMarquee } from 'verification:component';

export const Fixture = ({ variant }: { variant: string }) => (
  <button style={{ display: 'flex', width: '100%' }} type="button">
    <TailMarquee>
      {variant === 'short'
        ? 'file.tsx'
        : '/project/a-long-deterministic-directory/components/another-long-directory/path-to-a-component/another-long-directory/path-to-a-component/ExampleComponent.tsx'}
    </TailMarquee>
  </button>
);
