import { Flexbox } from '@lobehub/ui';
import { cx } from 'antd-style';
import { memo, useState } from 'react';

import { EditorModal } from '@/features/EditorModal';
import { useUserMemoryStore } from '@/store/userMemory';

import PersonaDetail from './PersonaDetail';
import PersonaSummary from './PersonaSummary';

interface PersonaProps {
  className?: string;
  onEditClick?: () => void;
}

export const usePersonaEditor = () => {
  const [editOpen, setEditOpen] = useState(false);
  const persona = useUserMemoryStore((s) => s.persona);

  const openEditor = () => setEditOpen(true);
  const closeEditor = () => setEditOpen(false);

  const EditorModalElement = persona ? (
    <EditorModal
      open={editOpen}
      value={persona.content}
      onCancel={closeEditor}
      onConfirm={async () => {
        closeEditor();
      }}
    />
  ) : null;

  return { EditorModalElement, openEditor };
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
