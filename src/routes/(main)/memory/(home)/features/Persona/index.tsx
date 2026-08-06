import { Flexbox } from '@lobehub/ui';
import { cx } from 'antd-style';
import { memo } from 'react';

import { openEditorModal } from '@/features/EditorModal';
import { useUserMemoryStore } from '@/store/userMemory';

import PersonaDetail from './PersonaDetail';
import PersonaSummary from './PersonaSummary';

interface PersonaProps {
  className?: string;
  onEditClick?: () => void;
}

export const usePersonaEditor = () => {
  const persona = useUserMemoryStore((s) => s.persona);

  const openEditor = () => {
    if (!persona) return;
    openEditorModal({ value: persona.content });
  };

  return { openEditor };
};

const Persona = memo<PersonaProps>(({ className }) => {
  const useFetchPersona = useUserMemoryStore((s) => s.useFetchPersona);
  const persona = useUserMemoryStore((s) => s.persona);

  const { isLoading } = useFetchPersona();

  if (isLoading || !persona) return null;

  return (
    <Flexbox className={cx(className)} gap={24}>
      {persona.summary && <PersonaSummary>{persona.summary}</PersonaSummary>}
      <PersonaDetail>{persona.content}</PersonaDetail>
    </Flexbox>
  );
});

export default Persona;
