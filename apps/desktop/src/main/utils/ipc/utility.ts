// Extract method signatures from service classes
type ExtractMethodSignature<T> = T extends (...args: infer Args) => infer Output
  ? (...args: Args) => AlwaysPromise<Output>
  : never;

export type ExtractServiceMethods<T> = {
  [K in keyof T as T[K] extends (...args: any[]) => any ? K : never]: ExtractMethodSignature<T[K]>;
};

type AlwaysPromise<T> = Promise<Awaited<T>>;

// TypeScript utility type to automatically merge IPC services
// This version works with both the old object format and new createServices format
export type MergeIpcService<T> = {
  [K in keyof T]: T[K] extends new (...args: any[]) => infer Instance
    ? ExtractServiceMethods<Instance>
    : T[K] extends infer Instance
      ? ExtractServiceMethods<Instance>
      : never;
};
