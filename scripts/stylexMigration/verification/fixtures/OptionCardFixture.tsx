import { OptionCard } from 'verification:component';

export const Fixture = ({ variant }: { variant: string }) => (
  <OptionCard
    description="Deterministic description"
    disabled={variant === 'disabled'}
    highlighted={variant === 'highlighted'}
    index={1}
    label="Choice"
    recommendedText="Suggested"
    selected={variant === 'selected'}
    onToggle={() => {}}
  />
);
