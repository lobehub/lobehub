import { Parent } from 'unist';
import { expect } from 'vitest';

import { treeNodeToString } from './getNodeContent';

describe('treeNodeToString', () => {
  it('with latex', () => {
    const nodes = [
      {
        type: 'paragraph',
        children: [
          {
            type: 'text',
            value: '设正向数列 ',
            position: {
              start: {
                line: 3,
                column: 1,
                offset: 9,
              },
              end: {
                line: 3,
                column: 7,
                offset: 15,
              },
            },
          },
          {
            type: 'inlineMath',
            value: '{ a_n }',
            data: {
              hName: 'code',
              hProperties: {
                className: ['language-math', 'math-inline'],
              },
              hChildren: [
                {
                  type: 'text',
                  value: '{ a_n }',
                },
              ],
            },
            position: {
              start: {
                line: 3,
                column: 7,
                offset: 15,
              },
              end: {
                line: 3,
                column: 18,
                offset: 26,
              },
            },
          },
          {
            type: 'text',
            value: ' 的首项为 ',
            position: {
              start: {
                line: 3,
                column: 18,
                offset: 26,
              },
              end: {
                line: 3,
                column: 24,
                offset: 32,
              },
            },
          },
          {
            type: 'inlineMath',
            value: '4',
            data: {
              hName: 'code',
              hProperties: {
                className: ['language-math', 'math-inline'],
              },
              hChildren: [
                {
                  type: 'text',
                  value: '4',
                },
              ],
            },
            position: {
              start: {
                line: 3,
                column: 24,
                offset: 32,
              },
              end: {
                line: 3,
                column: 29,
                offset: 37,
              },
            },
          },
          {
            type: 'text',
            value: ' ，满足 ',
            position: {
              start: {
                line: 3,
                column: 29,
                offset: 37,
              },
              end: {
                line: 3,
                column: 34,
                offset: 42,
              },
            },
          },
          {
            type: 'inlineMath',
            value: 'a^2_n = a_{n+1} + 3na_n - 3',
            data: {
              hName: 'code',
              hProperties: {
                className: ['language-math', 'math-inline'],
              },
              hChildren: [
                {
                  type: 'text',
                  value: 'a^2_n = a_{n+1} + 3na_n - 3',
                },
              ],
            },
            position: {
              start: {
                line: 3,
                column: 34,
                offset: 42,
              },
              end: {
                line: 3,
                column: 65,
                offset: 73,
              },
            },
          },
          {
            type: 'text',
            value: '.',
            position: {
              start: {
                line: 3,
                column: 65,
                offset: 73,
              },
              end: {
                line: 3,
                column: 66,
                offset: 74,
              },
            },
          },
        ],
        position: {
          start: {
            line: 3,
            column: 1,
            offset: 9,
          },
          end: {
            line: 3,
            column: 66,
            offset: 74,
          },
        },
      },
      {
        type: 'list',
        ordered: true,
        start: 1,
        spread: false,
        children: [
          {
            type: 'listItem',
            spread: false,
            checked: null,
            children: [
              {
                type: 'paragraph',
                children: [
                  {
                    type: 'text',
                    value: '求 ',
                    position: {
                      start: {
                        line: 5,
                        column: 5,
                        offset: 80,
                      },
                      end: {
                        line: 5,
                        column: 7,
                        offset: 82,
                      },
                    },
                  },
                  {
                    type: 'inlineMath',
                    value: 'a_2',
                    data: {
                      hName: 'code',
                      hProperties: {
                        className: ['language-math', 'math-inline'],
                      },
                      hChildren: [
                        {
                          type: 'text',
                          value: 'a_2',
                        },
                      ],
                    },
                    position: {
                      start: {
                        line: 5,
                        column: 7,
                        offset: 82,
                      },
                      end: {
                        line: 5,
                        column: 14,
                        offset: 89,
                      },
                    },
                  },
                  {
                    type: 'text',
                    value: ' 和 ',
                    position: {
                      start: {
                        line: 5,
                        column: 14,
                        offset: 89,
                      },
                      end: {
                        line: 5,
                        column: 17,
                        offset: 92,
                      },
                    },
                  },
                  {
                    type: 'inlineMath',
                    value: 'a_3',
                    data: {
                      hName: 'code',
                      hProperties: {
                        className: ['language-math', 'math-inline'],
                      },
                      hChildren: [
                        {
                          type: 'text',
                          value: 'a_3',
                        },
                      ],
                    },
                    position: {
                      start: {
                        line: 5,
                        column: 17,
                        offset: 92,
                      },
                      end: {
                        line: 5,
                        column: 24,
                        offset: 99,
                      },
                    },
                  },
                  {
                    type: 'text',
                    value: '，根据前三项的规律猜想该数列的通项公式',
                    position: {
                      start: {
                        line: 5,
                        column: 24,
                        offset: 99,
                      },
                      end: {
                        line: 5,
                        column: 43,
                        offset: 118,
                      },
                    },
                  },
                ],
                position: {
                  start: {
                    line: 5,
                    column: 5,
                    offset: 80,
                  },
                  end: {
                    line: 5,
                    column: 43,
                    offset: 118,
                  },
                },
              },
            ],
            position: {
              start: {
                line: 5,
                column: 2,
                offset: 77,
              },
              end: {
                line: 5,
                column: 43,
                offset: 118,
              },
            },
          },
          {
            type: 'listItem',
            spread: false,
            checked: null,
            children: [
              {
                type: 'paragraph',
                children: [
                  {
                    type: 'text',
                    value: '用数学归纳法证明你的猜想。',
                    position: {
                      start: {
                        line: 6,
                        column: 5,
                        offset: 123,
                      },
                      end: {
                        line: 6,
                        column: 18,
                        offset: 136,
                      },
                    },
                  },
                ],
                position: {
                  start: {
                    line: 6,
                    column: 5,
                    offset: 123,
                  },
                  end: {
                    line: 6,
                    column: 18,
                    offset: 136,
                  },
                },
              },
            ],
            position: {
              start: {
                line: 6,
                column: 2,
                offset: 120,
              },
              end: {
                line: 6,
                column: 18,
                offset: 136,
              },
            },
          },
        ],
        position: {
          start: {
            line: 5,
            column: 2,
            offset: 77,
          },
          end: {
            line: 6,
            column: 18,
            offset: 136,
          },
        },
      },
    ];

    const result = treeNodeToString(nodes as Parent[]);

    expect(result).toEqual(`设正向数列 \${ a_n }$ 的首项为 $4$ ，满足 $a^2_n = a_{n+1} + 3na_n - 3$.

1. 求 $a_2$ 和 $a_3$，根据前三项的规律猜想该数列的通项公式
2. 用数学归纳法证明你的猜想。`);
  });

  describe('link node', () => {
    it('with url', () => {
      const nodes = [
        {
          type: 'paragraph',
          children: [
            {
              type: 'link',
              title: null,
              url: 'citation-1',
              children: [
                {
                  type: 'text',
                  value: '#citation-1',
                  position: {
                    start: {
                      line: 5,
                      column: 26,
                      offset: 78,
                    },
                    end: {
                      line: 5,
                      column: 37,
                      offset: 89,
                    },
                  },
                },
              ],
              position: {
                start: {
                  line: 5,
                  column: 25,
                  offset: 77,
                },
                end: {
                  line: 5,
                  column: 50,
                  offset: 102,
                },
              },
            },
          ],
          position: {
            start: {
              line: 5,
              column: 1,
              offset: 53,
            },
            end: {
              line: 5,
              column: 220,
              offset: 272,
            },
          },
        },
      ];

      const result = treeNodeToString(nodes as Parent[]);

      expect(result).toEqual(`[#citation-1](citation-1)`);
    });

    it('handle error case', () => {
      const nodes = [
        {
          type: 'paragraph',
          children: [
            {
              type: 'link',
              title: null,
              url: 'citation-1',
              children: [],
              position: {
                start: {
                  line: 5,
                  column: 25,
                  offset: 77,
                },
                end: {
                  line: 5,
                  column: 50,
                  offset: 102,
                },
              },
            },
          ],
          position: {
            start: {
              line: 5,
              column: 1,
              offset: 53,
            },
            end: {
              line: 5,
              column: 220,
              offset: 272,
            },
          },
        },
      ];

      const result = treeNodeToString(nodes as Parent[]);

      expect(result).toEqual(`[](citation-1)`);
    });
  });
});
