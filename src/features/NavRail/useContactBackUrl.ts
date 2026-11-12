import { useImLayout } from './useImLayout';

/**
 * Where back leaves an agent or group for. The rail files every page inside one
 * under Contacts, so back returns to that list; the sidebar layout goes home.
 */
export const useContactBackUrl = (): string => (useImLayout() ? '/agents' : '/');
