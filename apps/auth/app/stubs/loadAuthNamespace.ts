// The prerender pass renders one locale, already bundled — it never switches
// language, so the on-demand loader's glob has no business in that graph.
export const loadAuthNamespace = async () => undefined;
