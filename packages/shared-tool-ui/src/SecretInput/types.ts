export interface SecretInputLabels {
  cancel: string;
  /** Placeholder for each field; receives the field name. */
  placeholder: (field: string) => string;
  submit: string;
  /** Shown on the submit button while the sink write is in flight. */
  submitting: string;
}
