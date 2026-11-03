export interface StoreSetter<TStore> {
  (
    partial: TStore | Partial<TStore> | ((state: TStore) => TStore | Partial<TStore>),
    replace?: false | undefined,
    action?: any,
  ): void;
  (state: TStore | ((state: TStore) => TStore), replace: true, action?: any): void;
}
