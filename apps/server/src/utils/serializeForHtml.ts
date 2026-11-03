/**
 * Safely serialize a JS value into a string that can be embedded inside
 * an HTML `<script>` tag as a JSON expression.
 *
 * Escapes `</script>`, `<!--`, and `<![CDATA[` patterns so the output
 * cannot break out of the script context.
 */
export function serializeForHtml(value: unknown): string {
  const json = JSON.stringify(value);

  // https://html.spec.whatwg.org/multipage/scripting.html#restrictions-for-contents-of-script-elements
  return json
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll("'", '\\u0027');
}
