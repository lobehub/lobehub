import { GalleyGrid } from 'verification:component';

const items = ['one', 'two', 'three', 'four', 'five', 'six'];

export const Fixture = ({ variant }: { variant: string }) => (
  <GalleyGrid
    col={variant === 'single' ? 1 : variant === 'compact' ? 2 : 3}
    gap={variant === 'compact' ? 2 : 6}
    max={420}
  >
    {items.map((item) => (
      <div key={item} style={{ background: '#8cb4ff', height: 80 }}>
        {item}
      </div>
    ))}
  </GalleyGrid>
);
