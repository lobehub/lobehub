import { MemoryRouter } from 'react-router';
import { RulesOnboarding } from 'verification:component';

const noop = () => {};

export const Fixture = ({ variant }: { variant: string }) => (
  <MemoryRouter>
    <RulesOnboarding
      backlogRounds={variant === 'minimal' ? undefined : 3}
      inline={variant === 'inline'}
      agents={
        variant === 'minimal'
          ? undefined
          : { agentCount: 2, lessonCount: 5, name: 'Reviewer', onOpen: noop }
      }
      onDistill={noop}
      onWrite={noop}
    />
  </MemoryRouter>
);
