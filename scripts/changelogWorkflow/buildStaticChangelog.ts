import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { consola } from 'consola';
import { readJsonSync, writeJSONSync } from 'fs-extra';
import semver from 'semver';

import { markdownToTxt } from '@/utils/markdownToTxt';

import { CHANGELOG_DIR, CHANGELOG_FILE } from './const';

export interface ChangelogStaticItem {
  children: {
    [category: string]: string[];
  };
  date: string;
  version: string;
}

class BuildStaticChangelog {
  private removeDetailsTag = (changelog: string): string => {
    const detailsRegex: RegExp = /<details\b[^>]*>[\s\S]*?<\/details>/gi;
    return changelog.replaceAll(detailsRegex, '');
  };

  private cleanVersion = (version: string): string => {
    return semver.clean(version) || version;
  };

  private formatCategory = (category: string): string => {
    const cate = category.trim().toLowerCase();

    switch (cate) {
      case 'bug fixes': {
        return 'fixes';
      }
      case 'features': {
        return 'features';
      }
      default: {
        return 'improvements';
      }
    }
  };

  private formatChangelog = (changelog: string): ChangelogStaticItem[] => {
    const cleanedChangelog = this.removeDetailsTag(changelog);
    const input = markdownToTxt(cleanedChangelog);
    const versions = input.split(/Version&nbsp;|Version /).slice(1);

    const output: ChangelogStaticItem[] = [];

    for (const version of versions) {
      const lines = version.trim().split('\n');
      const versionNumber = lines[0].trim();
      const date = lines[2].replace('Released on ', '').trim();

      const entry: ChangelogStaticItem = {
        children: {},
        date: date,
        version: this.cleanVersion(versionNumber),
      };

      let currentCategory = '';
      let skipSection = false;

      for (let i = 3; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line === '') continue;

        if (/^\p{Emoji}/u.test(line)) {
          currentCategory = this.formatCategory(line.replace(/^\p{Emoji} /u, ''));
          if (!currentCategory) continue;
          entry.children[currentCategory] = [];
          skipSection = false;
        } else if (line.startsWith('misc:') && !skipSection && currentCategory) {
          entry.children[currentCategory].push(line.replace('misc:', '').trim());
        }
      }

      // Remove empty categories
      for (const category in entry.children) {
        if (entry.children[category].length === 0) {
          delete entry.children[category];
        }
      }

      output.push(entry);
    }

    return output;
  };

  private mergeAndSortVersions = (oldVersions: any, newVersions: any) => {
    const mergedVersions = [...oldVersions];

    for (const newVersion of newVersions) {
      const existingIndex = mergedVersions.findIndex(
        (v) => this.cleanVersion(v.version) === this.cleanVersion(newVersion.version),
      );
      if (existingIndex === -1) {
        const insertIndex = mergedVersions.findIndex(
          (v) =>
            semver.compare(this.cleanVersion(newVersion.version), this.cleanVersion(v.version)) > 0,
        );
        if (insertIndex === -1) {
          mergedVersions.push(newVersion);
        } else {
          mergedVersions.splice(insertIndex, 0, newVersion);
        }
      }
    }

    return mergedVersions;
  };

  run() {
    Object.entries(CHANGELOG_FILE).forEach(([version, path]) => {
      const data = readFileSync(path, 'utf8');
      const newFile = this.formatChangelog(data);

      const filename = resolve(CHANGELOG_DIR, `${version}.json`);
      let mergedFile = newFile;

      if (existsSync(filename)) {
        const oldFile = readJsonSync(filename, 'utf8');
        mergedFile = this.mergeAndSortVersions(oldFile, newFile);
      }

      writeJSONSync(filename, mergedFile, { spaces: 2 });

      consola.success(`Changelog ${version} has been built successfully!`);
    });
  }
}

export const buildStaticChangelog = new BuildStaticChangelog();
