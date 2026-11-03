export const setNamespace = (namespace: string) => {
  return <P = undefined>(type: string, payload?: P) => {
    const name = [namespace, type].filter(Boolean).join('/');
    return (
      payload
        ? {
            payload,
            type: name,
          }
        : name
    ) as P extends undefined ? string : { payload: P; type: string };
  };
};

export type Action =
  | string
  | {
      [x: string | number | symbol]: unknown;
      type: string;
    };
