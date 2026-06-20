import { type FC } from 'react';

/**
 * Safely serialize JSON-LD to prevent XSS.
 * `JSON.stringify` can produce strings containing `</script>` which would
 * break out of the `<script>` element. We escape angle brackets as Unicode
 * escape sequences so the JSON stays valid but is safe inside HTML.
 */
const safeJsonLdStringify = (data: unknown): string =>
  JSON.stringify(data)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026');

const StructuredData: FC<{ ld: Record<string, unknown> }> = ({ ld }) => {
  return (
    <script
      dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(ld) }}
      id="structured-data"
      type="application/ld+json"
    />
  );
};
export default StructuredData;
