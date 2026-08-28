export type RuntimeAdditionalContextValue =
  | boolean
  | null
  | number
  | string
  | readonly RuntimeAdditionalContextValue[]
  | RuntimeAdditionalContextObject;

export interface RuntimeAdditionalContextObject {
  readonly [key: string]: RuntimeAdditionalContextValue;
}

export interface RuntimeAdditionalContextSection {
  readonly format: 'compact_json' | 'json' | 'text';
  readonly tag: string;
  readonly value: RuntimeAdditionalContextValue;
}

export interface RuntimeAdditionalContextFragment {
  readonly content:
    | {
        readonly sections: readonly RuntimeAdditionalContextSection[];
        readonly type: 'sections';
      }
    | {
        readonly text: string;
        readonly type: 'text';
      };
  readonly placement: 'stable_prefix' | 'virtual_tail';
  readonly wrapper: {
    readonly attributes?: Readonly<Record<string, string>>;
    readonly tag: string;
  };
}
