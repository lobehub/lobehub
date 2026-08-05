import { useParams } from 'react-router';

export const useActiveRouteParams = <
  T extends Record<string, string | undefined> = Record<string, string | undefined>,
>() => useParams<T>();
