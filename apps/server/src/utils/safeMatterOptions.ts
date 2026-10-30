export const safeMatterOptions = {
  engines: {
    javascript: () => {
      throw new Error('Executable frontmatter is not supported');
    },
  },
};
