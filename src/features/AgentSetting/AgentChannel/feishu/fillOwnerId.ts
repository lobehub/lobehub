interface OwnerLookupForm {
  getFieldValue: (name: string | string[]) => unknown;
  isFieldTouched: (name: string[]) => boolean;
  setFieldValue: (name: string[], value: string) => void;
}

interface AppCredentials {
  appId: string;
  appSecret: string;
  platform: 'feishu' | 'lark';
}

interface AppOwner {
  name?: string;
  openId: string;
}

/** Apply a lookup only while its credentials and the operator's field are unchanged. */
export async function fillOwnerId({
  credentials,
  fetchOwner,
  form,
  isCurrent,
}: {
  credentials: AppCredentials;
  fetchOwner: (credentials: AppCredentials) => Promise<AppOwner>;
  form: OwnerLookupForm;
  isCurrent: () => boolean;
}): Promise<AppOwner | undefined> {
  const field = ['settings', 'userId'];
  const initialValue = form.getFieldValue(field);
  if (typeof initialValue === 'string' && initialValue.trim()) return undefined;
  const initiallyTouched = form.isFieldTouched(field);
  const owner = await fetchOwner(credentials);

  if (
    !isCurrent() ||
    String(form.getFieldValue('applicationId') ?? '').trim() !== credentials.appId ||
    String(form.getFieldValue(['credentials', 'appSecret']) ?? '').trim() !==
      credentials.appSecret ||
    form.getFieldValue(field) !== initialValue ||
    form.isFieldTouched(field) !== initiallyTouched
  ) {
    return undefined;
  }

  form.setFieldValue(field, owner.openId);
  return owner;
}
