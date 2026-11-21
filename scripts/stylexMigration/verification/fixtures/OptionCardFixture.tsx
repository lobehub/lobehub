import { OptionCard } from 'verification:component';

export const Fixture = ({ variant }: { variant: string }) => (
  <OptionCard
    description="Deterministic description"
    disabled={variant.endsWith('disabled')}
    highlighted={variant.endsWith('highlighted')}
    index={1}
    label="Choice"
    recommendedText="Suggested"
    selected={variant.includes('selected')}
    onToggle={() => {}}
  />
);
