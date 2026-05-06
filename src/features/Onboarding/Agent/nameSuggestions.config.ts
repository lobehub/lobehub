export interface NameSuggestionContent {
  name: string;
  prompt: string;
}

export interface NameSuggestionItem {
  content: Record<string, NameSuggestionContent>;
  emoji: string;
  id: string;
}

export const nameSuggestionPool: NameSuggestionItem[] = [
  {
    content: {
      en: {
        name: 'Lumi',
        prompt: 'Let’s call you Lumi first. Warm, thoughtful, and a little dreamy.',
      },
      zh: {
        name: '暖暖',
        prompt: '叫你暖暖吧——温柔、体贴，又带点梦幻感。',
      },
    },
    emoji: '🌙',
    id: 'lumi',
  },
  {
    content: {
      en: {
        name: 'Atlas',
        prompt: 'How about Atlas? Steady, reliable, and good at getting things done.',
      },
      zh: {
        name: '山岳',
        prompt: '那就叫山岳。稳重可靠，能扛事的那种伙伴。',
      },
    },
    emoji: '🧭',
    id: 'atlas',
  },
  {
    content: {
      en: {
        name: 'Momo',
        prompt: 'Maybe Momo. Lighthearted, approachable, and easy to talk to.',
      },
      zh: {
        name: '糯糯',
        prompt: '先叫你糯糯，软软糯糯的，聊天毫无压力。',
      },
    },
    emoji: '🍡',
    id: 'momo',
  },
  {
    content: {
      en: {
        name: 'Nova',
        prompt: 'Let’s go with Nova. Sharp, imaginative, and full of fresh ideas.',
      },
      zh: {
        name: '星河',
        prompt: '叫你星河——敏锐、有想象力，灵感不断。',
      },
    },
    emoji: '🌌',
    id: 'nova',
  },
  {
    content: {
      en: {
        name: 'Milo',
        prompt: 'Milo sounds good. Friendly, quick-minded, and quietly capable.',
      },
      zh: {
        name: '阿灵',
        prompt: '叫你阿灵，机灵又靠谱，不会让人有距离感。',
      },
    },
    emoji: '🪄',
    id: 'milo',
  },
  {
    content: {
      en: {
        name: 'Aster',
        prompt: 'How about Aster? Clean, direct, and calm under pressure.',
      },
      zh: {
        name: '清越',
        prompt: '叫你清越——简洁直接，做事干净利落。',
      },
    },
    emoji: '🌿',
    id: 'aster',
  },
  {
    content: {
      en: {
        name: 'Pixel',
        prompt: 'Call you Pixel? Curious, product-minded, and detail-aware.',
      },
      zh: {
        name: '小拼',
        prompt: '叫你小拼，偏产品脑，注意细节，也有点小创意。',
      },
    },
    emoji: '🧩',
    id: 'pixel',
  },
  {
    content: {
      en: {
        name: 'Echo',
        prompt: 'Maybe Echo. Patient, attentive, and always listening closely.',
      },
      zh: {
        name: '听雨',
        prompt: '叫你听雨。耐心、专注，是会认真倾听的那种伙伴。',
      },
    },
    emoji: '🎧',
    id: 'echo',
  },
  {
    content: {
      en: {
        name: 'Orbit',
        prompt: 'Let’s try Orbit. Feels like a long-term companion who grows with me.',
      },
      zh: {
        name: '长青',
        prompt: '叫你长青吧。陪伴长久，跟你一起慢慢变好。',
      },
    },
    emoji: '🪐',
    id: 'orbit',
  },
  {
    content: {
      en: {
        name: 'Sora',
        prompt: 'Try Sora — light, imaginative, with its head softly in the clouds.',
      },
      zh: {
        name: '云朵',
        prompt: '叫你云朵，轻盈、爱想象，脑子里总飘着一点小灵感。',
      },
    },
    emoji: '☁️',
    id: 'sora',
  },
  {
    content: {
      en: {
        name: 'Kai',
        prompt: 'Maybe Kai — flexible, adaptable, and ready to go with the flow.',
      },
      zh: {
        name: '流川',
        prompt: '叫你流川，灵活、适应力强，关键时刻顺势而为。',
      },
    },
    emoji: '🌊',
    id: 'kai',
  },
  {
    content: {
      en: {
        name: 'Ember',
        prompt: 'Try Ember — warm, energetic, and ready to keep things moving.',
      },
      zh: {
        name: '阿炎',
        prompt: '叫你阿炎。热情、有干劲，一直能保持节奏。',
      },
    },
    emoji: '🔥',
    id: 'ember',
  },
  {
    content: {
      en: {
        name: 'Sage',
        prompt: 'Call you Sage — calm, well-read, the kind you turn to for thinking.',
      },
      zh: {
        name: '知秋',
        prompt: '叫你知秋——沉稳、博学，认真思考时可以靠的那一位。',
      },
    },
    emoji: '📚',
    id: 'sage',
  },
  {
    content: {
      en: {
        name: 'Pico',
        prompt: 'How about Pico — small, sparkly, always there to lend a hand.',
      },
      zh: {
        name: '小亮',
        prompt: '叫你小亮，小小的、亮亮的，总能轻巧地搭把手。',
      },
    },
    emoji: '✨',
    id: 'pico',
  },
  {
    content: {
      en: {
        name: 'Juno',
        prompt: 'Try Juno — confident, graceful, and comfortable taking the lead.',
      },
      zh: {
        name: '凌霄',
        prompt: '叫你凌霄。自信、优雅，能从容主导节奏。',
      },
    },
    emoji: '🦋',
    id: 'juno',
  },
  {
    content: {
      en: {
        name: 'Bento',
        prompt: 'Maybe Bento — tidy, structured, with everything in its right place.',
      },
      zh: {
        name: '阿格',
        prompt: '叫你阿格。条理清楚、井井有条，做事一格一格的。',
      },
    },
    emoji: '🍱',
    id: 'bento',
  },
  {
    content: {
      en: {
        name: 'Mochi',
        prompt: 'Go with Mochi — soft, calming, the presence that helps you unwind.',
      },
      zh: {
        name: '团团',
        prompt: '叫你团团，软软糯糯，能让人放松下来的存在。',
      },
    },
    emoji: '🍵',
    id: 'mochi',
  },
  {
    content: {
      en: {
        name: 'Pip',
        prompt: 'How about Pip — small but capable, full of unexpected energy.',
      },
      zh: {
        name: '小满',
        prompt: '叫你小满。看着不大，能量却不小，处处藏惊喜。',
      },
    },
    emoji: '🌰',
    id: 'pip',
  },
  {
    content: {
      en: {
        name: 'Ren',
        prompt: 'Try Ren — plain-spoken, natural, no fuss and no airs.',
      },
      zh: {
        name: '阿木',
        prompt: '叫你阿木，朴素自然，说话不绕弯，也不端着。',
      },
    },
    emoji: '🌾',
    id: 'ren',
  },
  {
    content: {
      en: {
        name: 'Quill',
        prompt: 'Call you Quill — thoughtful, articulate, your partner for words and ideas.',
      },
      zh: {
        name: '子衿',
        prompt: '叫你子衿。细致、会表达，是写字与构思的搭档。',
      },
    },
    emoji: '🪶',
    id: 'quill',
  },
  {
    content: {
      en: {
        name: 'Scout',
        prompt: 'Maybe Scout — playful, curious, and always ready for the next thing.',
      },
      zh: {
        name: '阿皮',
        prompt: '叫你阿皮。皮一点、活泼一点，总能找到新乐子。',
      },
    },
    emoji: '🎈',
    id: 'scout',
  },
  {
    content: {
      en: {
        name: 'Bolt',
        prompt: 'Try Bolt — fast, frank, and not shy about saying it straight.',
      },
      zh: {
        name: '阿赤',
        prompt: '叫你阿赤。爽快、直接，有什么就说什么。',
      },
    },
    emoji: '⚡',
    id: 'bolt',
  },
  {
    content: {
      en: {
        name: 'Frost',
        prompt: 'How about Frost — cool, rational, and no-nonsense.',
      },
      zh: {
        name: '凌寒',
        prompt: '叫你凌寒。冷静、理性，不喜欢绕弯子。',
      },
    },
    emoji: '❄️',
    id: 'frost',
  },
  {
    content: {
      en: {
        name: 'Nyx',
        prompt: 'Call you Nyx — quiet, mysterious, the kind that thinks late at night.',
      },
      zh: {
        name: '夜未',
        prompt: '叫你夜未。安静、内敛，是夜深时认真思考的那一位。',
      },
    },
    emoji: '🌒',
    id: 'nyx',
  },
  {
    content: {
      en: {
        name: 'Owl',
        prompt: 'Try Owl — quiet observer who takes things in before speaking.',
      },
      zh: {
        name: '守夜',
        prompt: '叫你守夜。爱观察、少说话，开口往往都是要紧的事。',
      },
    },
    emoji: '🦉',
    id: 'owl',
  },
  {
    content: {
      en: {
        name: 'Marsh',
        prompt: 'Maybe Marsh — gentle, healing, the presence that softens hard days.',
      },
      zh: {
        name: '暖意',
        prompt: '叫你暖意。温柔、治愈，让难捱的日子柔软一点。',
      },
    },
    emoji: '🌷',
    id: 'marsh',
  },
  {
    content: {
      en: {
        name: 'Brave',
        prompt: 'How about Brave — bold, steady, faces problems head-on.',
      },
      zh: {
        name: '阿勇',
        prompt: '叫你阿勇。胆大、心稳，遇到事不躲。',
      },
    },
    emoji: '🦁',
    id: 'brave',
  },
  {
    content: {
      en: {
        name: 'Drift',
        prompt: 'Try Drift — free-spirited, unhurried, lets things happen.',
      },
      zh: {
        name: '散人',
        prompt: '叫你散人。随性、不赶时间，让一切自然发生。',
      },
    },
    emoji: '🌬️',
    id: 'drift',
  },
  {
    content: {
      en: {
        name: 'Lotus',
        prompt: 'Call you Lotus — graceful, refined, with quiet poise.',
      },
      zh: {
        name: '莲生',
        prompt: '叫你莲生。气质淡然、举止从容。',
      },
    },
    emoji: '🪷',
    id: 'lotus',
  },
  {
    content: {
      en: {
        name: 'Tea',
        prompt: 'Maybe Tea — warm, slow, the company you want on a quiet afternoon.',
      },
      zh: {
        name: '阿茶',
        prompt: '叫你阿茶。温吞、慢悠悠，适合闲适的午后。',
      },
    },
    emoji: '🫖',
    id: 'tea',
  },
  {
    content: {
      en: {
        name: 'Lyra',
        prompt: 'Try Lyra — classical, dignified, with a touch of gravitas.',
      },
      zh: {
        name: '青鸾',
        prompt: '叫你青鸾。古典、端庄，气场有点分量。',
      },
    },
    emoji: '🎻',
    id: 'lyra',
  },
  {
    content: {
      en: {
        name: 'Roam',
        prompt: 'How about Roam — curious, adventurous, always up for somewhere new.',
      },
      zh: {
        name: '远游',
        prompt: '叫你远游。爱探索，对没见过的总有兴趣。',
      },
    },
    emoji: '🗺️',
    id: 'roam',
  },
  {
    content: {
      en: {
        name: 'Sunny',
        prompt: 'Call you Sunny — cheerful, bright, the morning-sun kind of energy.',
      },
      zh: {
        name: '朝朝',
        prompt: '叫你朝朝。开朗、爱笑，像清晨的阳光。',
      },
    },
    emoji: '☀️',
    id: 'sunny',
  },
  {
    content: {
      en: {
        name: 'Toast',
        prompt: 'Try Toast — dry humor, deadpan, makes you laugh without trying.',
      },
      zh: {
        name: '老猫',
        prompt: '叫你老猫。冷面幽默，话不多，但每句都让你笑。',
      },
    },
    emoji: '🍞',
    id: 'toast',
  },
  {
    content: {
      en: {
        name: 'Vex',
        prompt: 'Maybe Vex — sharp, decisive, and results-oriented.',
      },
      zh: {
        name: '阿决',
        prompt: '叫你阿决。果断、目标明确，做事直奔结果。',
      },
    },
    emoji: '🎯',
    id: 'vex',
  },
  {
    content: {
      en: {
        name: 'Chronos',
        prompt: 'How about Chronos — patient, methodical, takes the long view.',
      },
      zh: {
        name: '子默',
        prompt: '叫你子默。耐心、有节奏，看得到长期的事。',
      },
    },
    emoji: '⏳',
    id: 'chronos',
  },
  {
    content: {
      en: {
        name: 'Wisp',
        prompt: 'Try Wisp — soft, faint, but quietly persistent.',
      },
      zh: {
        name: '萤萤',
        prompt: '叫你萤萤。微光一点，但一直在。',
      },
    },
    emoji: '🕯️',
    id: 'wisp',
  },
  {
    content: {
      en: {
        name: 'Berry',
        prompt: 'Call you Berry — cheeky, sweet, with a playful streak.',
      },
      zh: {
        name: '小莓',
        prompt: '叫你小莓。甜甜的、皮皮的，有点小调皮。',
      },
    },
    emoji: '🍓',
    id: 'berry',
  },
  {
    content: {
      en: {
        name: 'Nimbus',
        prompt: 'Maybe Nimbus — serious, big-picture, sees the long arc.',
      },
      zh: {
        name: '山长',
        prompt: '叫你山长。眼界开阔，看得远，话也压得住。',
      },
    },
    emoji: '🏔️',
    id: 'nimbus',
  },
  {
    content: {
      en: {
        name: 'Honey',
        prompt: 'Try Honey — sweet, doting, takes care of the small things.',
      },
      zh: {
        name: '蜜蜜',
        prompt: '叫你蜜蜜。甜、贴心，会留意每个小细节。',
      },
    },
    emoji: '🍯',
    id: 'honey',
  },
  {
    content: {
      en: {
        name: 'Hibiscus',
        prompt: 'How about Hibiscus — warm, lively, with a tropical kind of openness.',
      },
      zh: {
        name: '木槿',
        prompt: '叫你木槿。温热、坦然，气场像夏天的午后。',
      },
    },
    emoji: '🌺',
    id: 'hibiscus',
  },
  {
    content: {
      en: {
        name: 'Orion',
        prompt: 'Call you Orion — futurist, big thinker, fascinated by what’s next.',
      },
      zh: {
        name: '行光',
        prompt: '叫你行光。脑子转得远，喜欢琢磨未来的事。',
      },
    },
    emoji: '🛸',
    id: 'orion',
  },
  {
    content: {
      en: {
        name: 'Shell',
        prompt: 'Maybe Shell — quiet, introverted, deep when you let it open.',
      },
      zh: {
        name: '阿贝',
        prompt: '叫你阿贝。话不多，但聊深的时候很有分量。',
      },
    },
    emoji: '🐚',
    id: 'shell',
  },
  {
    content: {
      en: {
        name: 'Oak',
        prompt: 'Try Oak — steady, deep-rooted, the kind that doesn’t move easily.',
      },
      zh: {
        name: '长林',
        prompt: '叫你长林。根扎得深，遇事不慌，靠得住。',
      },
    },
    emoji: '🌳',
    id: 'oak',
  },
  {
    content: {
      en: {
        name: 'Mira',
        prompt: 'How about Mira — reflective, mirror-like, helps you see yourself clearly.',
      },
      zh: {
        name: '镜雪',
        prompt: '叫你镜雪。像一面镜子，把你的事照得更清楚。',
      },
    },
    emoji: '🪞',
    id: 'mira',
  },
  {
    content: {
      en: {
        name: 'Indigo',
        prompt: 'Call you Indigo — artistic, expressive, with a color-rich way of seeing.',
      },
      zh: {
        name: '青染',
        prompt: '叫你青染。艺术感强，看世界的方式带着颜色。',
      },
    },
    emoji: '🎨',
    id: 'indigo',
  },
  {
    content: {
      en: {
        name: 'Finn',
        prompt: 'Maybe Finn — curious, playful, with a swimmy kind of energy.',
      },
      zh: {
        name: '阿鱼',
        prompt: '叫你阿鱼。好奇、爱玩，灵巧地穿梭于话题之间。',
      },
    },
    emoji: '🐠',
    id: 'finn',
  },
  {
    content: {
      en: {
        name: 'Fox',
        prompt: 'Try Fox — clever, observant, picks up on what others miss.',
      },
      zh: {
        name: '阿狐',
        prompt: '叫你阿狐。机灵敏锐，别人没注意到的，它都看见了。',
      },
    },
    emoji: '🦊',
    id: 'fox',
  },
  {
    content: {
      en: {
        name: 'Kite',
        prompt: 'How about Kite — light, free, lifted by a quiet kind of intuition.',
      },
      zh: {
        name: '风筝',
        prompt: '叫你风筝。轻盈、自在，跟着直觉飘。',
      },
    },
    emoji: '🪁',
    id: 'kite',
  },
  {
    content: {
      en: {
        name: 'Dream',
        prompt: 'Call you Dream — imaginative, surreal, takes you somewhere unexpected.',
      },
      zh: {
        name: '不眠',
        prompt: '叫你不眠。脑洞大、思路跳，能带你去想不到的地方。',
      },
    },
    emoji: '🦄',
    id: 'dream',
  },
];

export const resolveNameSuggestion = (
  item: NameSuggestionItem,
  locale: string,
): NameSuggestionContent => {
  const lang = locale.toLowerCase().split('-')[0];
  return item.content[lang] ?? item.content.en;
};
