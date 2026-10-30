export interface SecretInputLabels {
  cancel: string;
  /** Shown on the confirm button while a prose-looking submit is held. */
  confirmProse: string;
  /** Placeholder for each field; receives the field name. */
  placeholder: (field: string) => string;
  submit: string;
  /** Shown on the submit button while the sink write is in flight. */
  submitting: string;
  /**
   * Warning for prose-looking values (a pasted sentence / chat text). Receives
   * the field names held for confirmation. Undefined hides the warning row.
   */
  proseWarning: (fields: string[]) => string;
}
