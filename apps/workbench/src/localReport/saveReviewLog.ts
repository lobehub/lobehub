import { getLocalReport } from './localReportData';

/** `reviews.json` content, downloaded where the CLI looks for it. */
export const reviewExportFileName = (acceptanceId: string) =>
  `acceptance-reviews-${acceptanceId}.json`;

const download = (fileName: string, content: string) => {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/**
 * Download every decision made on this acceptance as its review log, and
 * return the file name. A file opened from disk cannot write next to itself;
 * the CLI picks the newest download up on its next `view` or `feedback` and
 * files it beside the rounds.
 */
export const saveReviewLog = () => {
  const report = getLocalReport();
  const fileName = reviewExportFileName(report.acceptanceId);
  download(fileName, `${JSON.stringify(report.exportLog(), null, 2)}\n`);
  report.markExported();
  return fileName;
};
