import qs from 'query-string';
import urlJoin from 'url-join';

import { GITHUB } from '@/const/url';

class GitHubService {
  submitDBV1UpgradeError = (version: number, error?: { message: string }) => {
    const body = ['```json', JSON.stringify(error, null, 2), '```'].join('\n');

    const message = error?.message || '';

    const url = qs.stringifyUrl({
      query: {
        body,
        labels: '❌ Database Migration Error',
        title: `[Migration Error V${version}] ${message}`,
      },
      url: urlJoin(GITHUB, '/issues/new'),
    });

    window.open(url, '_blank');
  };

  submitImportError = (error?: { message: string }) => {
    const body = ['```json', JSON.stringify(error, null, 2), '```'].join('\n');

    const message = error?.message || '';

    const url = qs.stringifyUrl({
      query: {
        body,
        labels: '❌ Import Config Error',
        title: `[Config Import Error] ${message}`,
      },
      url: urlJoin(GITHUB, '/issues/new'),
    });

    window.open(url, '_blank');
  };
}

export const githubService = new GitHubService();
