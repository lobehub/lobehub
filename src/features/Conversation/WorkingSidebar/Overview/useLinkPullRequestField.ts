import { toast } from '@lobehub/ui';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** `https://github.com/<owner>/<repo>/pull/<n>`, also with a tab or query after it. */
const PULL_URL_RE = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+(?:[/?#]\S*)?$/i;

export const isPullRequestUrl = (value: string) => PULL_URL_RE.test(value.trim());

/**
 * State of the Overview's "Link a pull request" field: a quiet row until
 * opened, then an input that links on Enter, explains a URL that is not a PR
 * without asking the server, and closes on Escape or when left empty.
 */
export const useLinkPullRequestField = (onLink: (url: string) => Promise<string | undefined>) => {
  const { t } = useTranslation('chat');
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [linking, setLinking] = useState(false);
  const [invalid, setInvalid] = useState(false);

  const close = useCallback(() => {
    setEditing(false);
    setValue('');
    setInvalid(false);
  }, []);

  const change = useCallback((next: string) => {
    setValue(next);
    setInvalid(false);
  }, []);

  const submit = useCallback(async () => {
    const url = value.trim();
    if (!url) return close();
    if (!isPullRequestUrl(url)) {
      setInvalid(true);
      return;
    }
    setLinking(true);
    try {
      const identifier = await onLink(url);
      toast.success(t('workingPanel.overview.pr.linked', { name: identifier ?? url }));
      close();
    } catch {
      toast.error(t('workingPanel.overview.pr.linkFailed'));
    } finally {
      setLinking(false);
    }
  }, [close, onLink, t, value]);

  return {
    change,
    close,
    editing,
    invalid,
    linking,
    open: () => setEditing(true),
    submit,
    value,
  };
};
