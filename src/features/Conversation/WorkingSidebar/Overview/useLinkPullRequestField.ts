import { toast } from '@lobehub/ui';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** `https://github.com/<owner>/<repo>/pull/<n>`, also with a tab or query after it. */
const PULL_URL_RE = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+(?:[/?#]\S*)?$/i;

export const isPullRequestUrl = (value: string) => PULL_URL_RE.test(value.trim());

/**
 * State of the "Link a pull request" dialog's field: links on submit, explains
 * a URL that is not a PR without asking the server, and calls `onDone` once
 * linked (the dialog closes then). A failed link keeps the field for a retry.
 */
export const useLinkPullRequestField = (
  onLink: (url: string) => Promise<string | undefined>,
  onDone: () => void,
) => {
  const { t } = useTranslation('chat');
  const [value, setValue] = useState('');
  const [linking, setLinking] = useState(false);
  const [invalid, setInvalid] = useState(false);

  const change = useCallback((next: string) => {
    setValue(next);
    setInvalid(false);
  }, []);

  const submit = useCallback(async () => {
    if (linking) return;
    const url = value.trim();
    if (!isPullRequestUrl(url)) {
      setInvalid(true);
      return;
    }
    setLinking(true);
    try {
      const identifier = await onLink(url);
      toast.success(t('workingPanel.overview.pr.linked', { name: identifier ?? url }));
      onDone();
    } catch {
      toast.error(t('workingPanel.overview.pr.linkFailed'));
    } finally {
      setLinking(false);
    }
  }, [linking, onDone, onLink, t, value]);

  return { change, invalid, linking, submit, value };
};
