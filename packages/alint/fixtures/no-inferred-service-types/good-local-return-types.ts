// Fixture: ReturnType of local functions, timers, store APIs and hooks is not service inference.
import { useForm } from 'antd/es/form/Form';
import { createStore } from 'zustand/vanilla';

import { documentService } from '@/services/document';

type FormInstance = ReturnType<typeof useForm>[0];

const createEditorStore = () => createStore<{ dirty: boolean }>(() => ({ dirty: false }));
type EditorStore = ReturnType<typeof createEditorStore>;

export const createAutosave = (store: EditorStore, form: FormInstance) => {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const requestSave = async (id: string) => {
    const values = form.getFieldsValue();
    return documentService.updateDocument({ id, ...values });
  };

  const flush = async (id: string) => {
    let saved: Awaited<ReturnType<typeof requestSave>> | undefined;
    if (store.getState().dirty) saved = await requestSave(id);
    return saved;
  };

  const schedule = (id: string) => {
    clearTimeout(timer);
    timer = setTimeout(() => void flush(id), 1000);
  };

  return { flush, schedule };
};
