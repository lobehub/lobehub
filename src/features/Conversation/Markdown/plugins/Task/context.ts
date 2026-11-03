import { createContext, useContext } from 'react';

const TaskCardScopeContext = createContext(false);

export const TaskCardScopeProvider = TaskCardScopeContext.Provider;

export const useTaskCardScope = () => useContext(TaskCardScopeContext);
