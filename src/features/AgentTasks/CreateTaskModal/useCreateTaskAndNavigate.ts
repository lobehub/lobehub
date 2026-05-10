import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import { createTaskModal } from './index';

interface Options {
  showInlineToggle?: boolean;
}

export const useCreateTaskAndNavigate = ({ showInlineToggle }: Options = {}) => {
  const navigate = useNavigate();
  return useCallback(() => {
    createTaskModal({
      onCreated: (task) => {
        navigate(`/task/${task.identifier}`);
      },
      showInlineToggle,
    });
  }, [navigate, showInlineToggle]);
};
