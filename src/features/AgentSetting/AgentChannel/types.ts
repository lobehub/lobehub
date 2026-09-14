export interface PlatformSettingsFieldExtrasProps {
  disabled?: boolean;
  /**
   * Report that the helper wrote into the form. `form.setFieldValue` does not
   * fire the Form's `onValuesChange`, so without this the page never learns it
   * has unsaved changes and the Discard button stays hidden.
   */
  onFilled?: () => void;
  /** Platform the field belongs to — the shared Feishu/Lark schema needs it to pick a domain. */
  platformId: string;
  /**
   * The field's value as currently persisted, which is what a helper should
   * test before acting on its own: antd hydrates the form after mount, so a
   * watched empty value cannot distinguish "unset" from "not loaded yet".
   */
  savedValue?: unknown;
}
