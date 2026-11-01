/**
 * Default personal names assigned to a freshly created agent.
 *
 * An agent's `name` is the identity it is addressed by ("Alice", "小满"), while
 * `title` describes the role it plays ("Health Assistant"). A brand-new agent has
 * no role yet, so we seed a name immediately — it gives the agent a face in the
 * sidebar before the Agent Builder conversation has produced anything, and the
 * builder is free to replace it with one that fits the finished role.
 *
 * Names are deliberately plain and common: they should read as a person, not as
 * a product. Nothing here may collide with an assistant brand (Siri, Alexa,
 * Claude, Gemini, ...) or with LobeHub's own naming.
 *
 * Chinese names are a fixed two characters shaped like an assistant ("小满",
 * "朵朵"); every other language draws from a flat pool of common given names. Languages
 * without a pool fall back to English, which reads acceptably across
 * Latin-script locales.
 */

const pick = <T>(pool: readonly T[]): T => pool[Math.floor(Math.random() * pool.length)];

// prettier-ignore
const EN_AGENT_NAMES = [
  'Abby', 'Adam', 'Aiden', 'Alice', 'Amber', 'Amelia', 'Amy', 'Anna', 'Annie', 'Archie',
  'Aria', 'Arlo', 'Asher', 'Aubrey', 'Audrey', 'August', 'Autumn', 'Beau', 'Bella', 'Blake',
  'Bonnie', 'Brooke', 'Caleb', 'Callie', 'Carter', 'Cassie', 'Charlie', 'Chloe', 'Claire', 'Clara',
  'Cole', 'Colin', 'Connor', 'Cora', 'Daisy', 'Dylan', 'Eden', 'Elena', 'Eli', 'Elias',
  'Elise', 'Ella', 'Ellie', 'Eloise', 'Emily', 'Emma', 'Emmett', 'Erin', 'Esme', 'Ethan',
  'Eva', 'Evan', 'Everett', 'Felix', 'Fiona', 'Flora', 'Freya', 'Gavin', 'George', 'Georgia',
  'Grace', 'Gwen', 'Hailey', 'Hannah', 'Harper', 'Harvey', 'Hazel', 'Heidi', 'Henry', 'Holly',
  'Hope', 'Hudson', 'Iris', 'Isaac', 'Isla', 'Ivy', 'Jack', 'Jade', 'Jamie', 'Jasper',
  'Jenna', 'Joel', 'Jonah', 'Jordan', 'Josie', 'Jude', 'Julia', 'June', 'Kai', 'Kara',
  'Kate', 'Katie', 'Kayla', 'Kevin', 'Kira', 'Kyle', 'Landon', 'Lara', 'Laura', 'Lauren',
  'Lena', 'Leo', 'Levi', 'Liam', 'Lily', 'Logan', 'Lottie', 'Lucy', 'Luke', 'Luna',
  'Mabel', 'Maddie', 'Marcus', 'Margot', 'Marie', 'Martha', 'Mason', 'Matilda', 'Maya', 'Megan',
  'Miles', 'Milo', 'Molly', 'Morgan', 'Nadia', 'Naomi', 'Natalie', 'Nate', 'Nell', 'Nina',
  'Noah', 'Nolan', 'Nora', 'Olive', 'Oliver', 'Ollie', 'Opal', 'Oscar', 'Owen', 'Paige',
  'Parker', 'Pearl', 'Penny', 'Phoebe', 'Piper', 'Quinn', 'Reed', 'Reese', 'Riley', 'Robin',
  'Rory', 'Rosa', 'Rose', 'Rowan', 'Ruby', 'Ryan', 'Sadie', 'Sawyer', 'Scarlett', 'Seth',
  'Silas', 'Skye', 'Sophie', 'Stella', 'Summer', 'Sylvia', 'Tessa', 'Theo', 'Thomas', 'Tilly',
  'Toby', 'Tristan', 'Vera', 'Violet', 'Wade', 'Wendy', 'Wesley', 'Willa', 'Willow', 'Wren',
  'Wyatt', 'Zach', 'Zara', 'Zoe',
];

/**
 * Flat given-name pools keyed by base language code (the part before the `-`).
 * Kept small on purpose — around twenty familiar, friendly names per language
 * is enough variety for a sidebar of agents.
 */
const FLAT_POOLS: Record<string, readonly string[]> = {
  ar: [
    'آدم',
    'أمل',
    'حسن',
    'دانا',
    'رنا',
    'زيد',
    'سارة',
    'سامي',
    'طارق',
    'عمر',
    'فارس',
    'كريم',
    'لينا',
    'ليلى',
    'مريم',
    'نور',
    'هدى',
    'يوسف',
  ],
  bg: [
    'Боян',
    'Весела',
    'Виктор',
    'Георги',
    'Ива',
    'Калин',
    'Мила',
    'Митко',
    'Надя',
    'Петър',
    'Рая',
    'Румен',
    'Стоян',
    'Цвета',
    'Яна',
  ],
  de: [
    'Anton',
    'Ben',
    'Carla',
    'Emil',
    'Finn',
    'Frieda',
    'Greta',
    'Hanna',
    'Ida',
    'Johanna',
    'Jonas',
    'Klara',
    'Lotte',
    'Lukas',
    'Marlene',
    'Mia',
    'Moritz',
    'Paul',
  ],
  en: EN_AGENT_NAMES,
  es: [
    'Adrián',
    'Ainhoa',
    'Alba',
    'Álvaro',
    'Carmen',
    'Claudia',
    'Diego',
    'Iker',
    'Inés',
    'Javier',
    'Lucía',
    'Marina',
    'Marta',
    'Mateo',
    'Nerea',
    'Pablo',
    'Paula',
    'Sofía',
    'Valentina',
  ],
  fa: [
    'آرش',
    'آرمان',
    'بابک',
    'بهار',
    'پارسا',
    'دریا',
    'رعنا',
    'سارا',
    'سامان',
    'شیرین',
    'کیان',
    'مهسا',
    'نگار',
    'نوید',
    'نیلوفر',
    'یاسمن',
  ],
  fr: [
    'Anaïs',
    'Arthur',
    'Baptiste',
    'Camille',
    'Chloé',
    'Élise',
    'Gabriel',
    'Hugo',
    'Jules',
    'Juliette',
    'Léa',
    'Louise',
    'Lucas',
    'Maëlys',
    'Manon',
    'Margaux',
    'Nathan',
    'Océane',
    'Romain',
    'Théo',
  ],
  it: [
    'Alessia',
    'Aurora',
    'Beatrice',
    'Chiara',
    'Davide',
    'Federico',
    'Francesca',
    'Ginevra',
    'Giulia',
    'Irene',
    'Lorenzo',
    'Marco',
    'Martina',
    'Matteo',
    'Paolo',
    'Riccardo',
    'Serena',
    'Simone',
    'Tommaso',
  ],
  ja: [
    '葵',
    '陽葵',
    '結衣',
    '芽依',
    '咲良',
    '美月',
    '千尋',
    '楓',
    '澪',
    '遥',
    '紬',
    '蓮',
    '湊',
    '悠真',
    '颯太',
    '律',
    '陽菜',
    '心春',
    '直樹',
    '春香',
  ],
  ko: [
    '나윤',
    '다은',
    '도윤',
    '민준',
    '서연',
    '서준',
    '수아',
    '시우',
    '예은',
    '유진',
    '윤서',
    '은서',
    '주원',
    '지안',
    '지우',
    '지호',
    '채원',
    '태오',
    '하윤',
    '하은',
  ],
  nl: [
    'Anouk',
    'Bram',
    'Daan',
    'Eline',
    'Femke',
    'Fleur',
    'Isa',
    'Jesse',
    'Koen',
    'Lieke',
    'Luuk',
    'Maud',
    'Niels',
    'Roos',
    'Ruben',
    'Sanne',
    'Sven',
    'Thijs',
  ],
  pl: [
    'Agata',
    'Bartek',
    'Basia',
    'Ewa',
    'Franek',
    'Hania',
    'Iga',
    'Julka',
    'Kasia',
    'Kuba',
    'Magda',
    'Marek',
    'Michał',
    'Ola',
    'Piotr',
    'Tomek',
    'Wojtek',
    'Zofia',
  ],
  pt: [
    'Beatriz',
    'Bianca',
    'Bruna',
    'Caio',
    'Camila',
    'Felipe',
    'Fernanda',
    'Gustavo',
    'Isabela',
    'João',
    'Juliana',
    'Larissa',
    'Letícia',
    'Mariana',
    'Matheus',
    'Rafael',
    'Renata',
    'Thiago',
    'Vinícius',
  ],
  ru: [
    'Алиса',
    'Аня',
    'Ваня',
    'Вера',
    'Даша',
    'Дима',
    'Женя',
    'Катя',
    'Костя',
    'Маша',
    'Миша',
    'Настя',
    'Никита',
    'Оля',
    'Полина',
    'Саша',
    'Соня',
    'Тимур',
  ],
  tr: [
    'Aylin',
    'Ayşe',
    'Baran',
    'Burak',
    'Can',
    'Cem',
    'Defne',
    'Deniz',
    'Ece',
    'Elif',
    'Emre',
    'İpek',
    'Kaan',
    'Mert',
    'Merve',
    'Nazlı',
    'Selin',
    'Zeynep',
  ],
  vi: [
    'An',
    'Bảo',
    'Dũng',
    'Hà',
    'Hương',
    'Huy',
    'Khánh',
    'Lan',
    'Linh',
    'Mai',
    'Minh',
    'Ngọc',
    'Phương',
    'Quân',
    'Thảo',
    'Trang',
    'Trung',
    'Tuấn',
    'Vy',
  ],
};

/**
 * Chinese names are always two characters and read as an assistant rather than
 * a stranger. Three shapes, weighted in `rollZhName`:
 *
 * - "小X" (小满, 小柚): the shape everyone already uses for helpers.
 * - Reduplicated nicknames (朵朵, 安安): warm and easy to call.
 * - Composed given names (知夏, 予安): `ZH_GIVEN_FIRST` × `ZH_GIVEN_SECOND`,
 *   which is what gives the space its size (~5k names).
 *
 * The single-character pools are vetted name by name — no assistant brand
 * (小爱, 小度, 小艺, 小冰, 小布, 小娜, 小米 ...), no Japanese surname (小林,
 * 小泉, 小野 ...), no famous character (小新, 小葵, 小兰, 小霞) and no everyday
 * word (小心, 小时, 小说 ...). Composed pairs are screened by `ZH_BLOCKED`.
 */
// prettier-ignore
const ZH_XIAO_SUFFIXES = [
  '满', '禾', '鹿', '舟', '橙', '柚', '桃', '棠', '荷', '芽',
  '苗', '麦', '豆', '糖', '晴', '星', '月', '云', '雪', '雨',
  '溪', '羽', '鸥', '安', '宁', '乐', '悦', '欣', '诺', '可',
  '墨', '夏', '秋', '初', '橘', '栗', '梨', '杏', '梅', '竹',
  '桐', '枫', '叶', '果', '朵', '暖', '晨', '曦', '光', '澄',
  '清', '汐', '澜', '沐', '帆', '航', '远', '树', '椰', '柠',
  '莓', '茉', '芸', '薇', '熙', '圆', '蕊', '蝶', '萤', '鲸',
  '狸', '栀', '芊', '菲', '琪', '琳', '瑶', '遥', '岚', '屿',
  '洲', '沫', '珂', '菁', '茵', '伊', '依', '棉', '铃', '笛',
  '琴', '诗', '书', '音', '蓓', '芷', '莲', '芙', '蔓', '菱',
  '茶', '桂', '楠', '榕', '宇', '辰', '昕', '涵', '沁', '漫',
  '湘', '洛', '鹤', '燕', '翎', '念', '予', '亦', '允', '静',
  '慧', '敏', '洁', '婷', '雯', '霏', '舒', '恬', '怡', '宜',
  '妍', '颖', '盈', '莹', '萱', '茜',
];

// prettier-ignore
const ZH_REDUPLICATED = [
  '安', '乐', '朵', '糖', '果', '豆', '圆', '悠', '可', '桃',
  '柚', '橙', '甜', '笑', '月', '晴', '欣', '宁', '茉', '栗',
  '苗', '禾', '满', '芽', '点', '依', '菲', '楠', '萌', '绵',
  '芊', '沐', '晨', '涵', '洋', '嘉', '佳', '琪', '莹', '媛',
  '淼', '森', '墨', '夏', '初', '雪', '冉', '恬', '怡', '菁',
  '莉', '琳', '瑶', '舟', '棠', '杏', '莓', '椰',
];

// prettier-ignore
const ZH_GIVEN_FIRST = [
  '子', '若', '亦', '云', '清', '沐', '晚', '静', '知', '慕',
  '听', '望', '书', '予', '语', '诗', '思', '心', '依', '安',
  '星', '明', '晓', '春', '秋', '雨', '青', '松', '荷', '墨',
  '南', '初', '可', '佳', '鹿', '悠', '一', '以', '念', '素',
  '景', '兰', '竹', '梅', '新', '锦', '雅', '芸', '洛', '婉',
  '允', '宁', '夕', '忆', '嘉', '文', '晨', '乐', '宛', '芷',
];

// prettier-ignore
const ZH_GIVEN_SECOND = [
  '瑶', '宁', '安', '欣', '澜', '悦', '远', '青', '晴', '夏',
  '云', '薇', '然', '涵', '溪', '舟', '月', '兰', '桐', '深',
  '洲', '竹', '言', '川', '辰', '汐', '如', '雨', '诺', '之',
  '歌', '和', '瑾', '舒', '曦', '萱', '棠', '禾', '笙', '熙',
  '昕', '恬', '怡', '宜', '妍', '颖', '岚', '雪', '星', '蕊',
  '枫', '墨', '帆', '芊', '苓', '霖', '仪', '遥', '微', '琪',
  '琳', '菲', '槿', '蓉', '凝', '柔', '初', '意', '晚', '容',
  '白', '桥', '阳', '书', '秋', '乐', '可', '朵', '屿', '音',
];

/** Composed pairs that read as everyday words, place names or famous people. */
// prettier-ignore
const ZH_BLOCKED = new Set([
  '明白', '晚安', '雪白', '清白', '青白', '雨雪', '梅雨', '春秋', '春晚', '一月',
  '一朵', '云朵', '一晚', '一如', '宛如', '依然', '若然', '亦然', '亦可', '可乐',
  '安乐', '心意', '新意', '诗意', '语意', '文意', '一意', '诗歌', '新歌', '听歌',
  '诗书', '文书', '新书', '听书', '文言', '语言', '文墨', '明星', '新星', '望远',
  '慕容', '婉容', '南宁', '南阳', '洛阳', '安阳', '夕阳', '雅安', '新竹', '安溪',
  '荷兰', '宁夏', '语音', '宁可', '乐意', '清初', '知青', '新颖', '可言', '念书',
  '明晚', '婉言', '允诺', '明言', '诗云', '心仪',
]);

/** Simplified → traditional for the characters above that differ. */
// prettier-ignore
const ZH_HANT_CHARS: Record<string, string> = {
  乐: '樂', 云: '雲', 叶: '葉', 圆: '圓', 宁: '寧', 悦: '悅', 枫: '楓', 柠: '檸',
  树: '樹', 满: '滿', 澜: '瀾', 点: '點', 绵: '綿', 萤: '螢', 诺: '諾', 远: '遠',
  鲸: '鯨', 鸥: '鷗', 麦: '麥', 瑶: '瑤', 遥: '遙', 岚: '嵐', 屿: '嶼', 铃: '鈴',
  诗: '詩', 书: '書', 莲: '蓮', 静: '靜', 洁: '潔', 颖: '穎', 莹: '瑩', 语: '語',
  晓: '曉', 锦: '錦', 兰: '蘭', 忆: '憶', 仪: '儀', 桥: '橋', 阳: '陽', 听: '聽',
  鹤: '鶴', 栀: '梔',
};

interface ZhNamePools {
  blocked: ReadonlySet<string>;
  givenFirst: readonly string[];
  givenSecond: readonly string[];
  reduplicated: readonly string[];
  xiao: readonly string[];
}

const toZhPools = (toScript: (text: string) => string): ZhNamePools => ({
  blocked: new Set([...ZH_BLOCKED].map(toScript)),
  givenFirst: ZH_GIVEN_FIRST.map(toScript),
  givenSecond: ZH_GIVEN_SECOND.map(toScript),
  reduplicated: ZH_REDUPLICATED.map((char) => toScript(char).repeat(2)),
  xiao: ZH_XIAO_SUFFIXES.map((char) => `小${toScript(char)}`),
});

const ZH_HANS = toZhPools((text) => text);
const ZH_HANT = toZhPools((text) => [...text].map((char) => ZH_HANT_CHARS[char] ?? char).join(''));

/**
 * Compose a given name from the first/second pools, rejecting doubled
 * characters and pairs that read as words. Rejections are a few percent of the
 * space, so the loop returns within a draw or two; the "小X" fallback is an
 * unreachable-in-practice backstop.
 */
const composeGivenName = (pools: ZhNamePools): string => {
  for (let i = 0; i < 32; i++) {
    const name = pick(pools.givenFirst) + pick(pools.givenSecond);
    if (name[0] !== name[1] && !pools.blocked.has(name)) return name;
  }
  return pick(pools.xiao);
};

/**
 * One weighted roll across the three shapes: "小X" 35%, reduplicated 10%,
 * composed 55%. "小X" carries the assistant feel, but its pool is the smallest
 * that is drawn often, so it is the share that most decides how soon two
 * agents meet the same name; the composed half keeps repeats rare.
 */
const rollZhName = (pools: ZhNamePools): string => {
  const roll = Math.random();

  if (roll < 0.35) return pick(pools.xiao);
  if (roll < 0.45) return pick(pools.reduplicated);
  return composeGivenName(pools);
};

/**
 * Draw from a generator while avoiding taken names. The composed space is
 * thousands wide, so a handful of retries all but guarantees a fresh one; when
 * luck runs out, a repeat name beats no name.
 */
const drawComposed = (generate: () => string, taken: ReadonlySet<string>): string => {
  let candidate = generate();
  for (let i = 0; i < 20 && taken.has(candidate.toLowerCase()); i++) candidate = generate();
  return candidate;
};

/**
 * Pick a random display name for a new agent, matching the user's language.
 *
 * Chinese locales get a two-character assistant name — traditional script for
 * `zh-TW` / `zh-HK` / `zh-Hant`, simplified otherwise. Other languages with a
 * dedicated pool (Japanese, Korean, French, ...) draw from it; everything else
 * falls back to the English pool.
 *
 * `exclude` keeps the caller from handing out a name it already has in view —
 * two agents called "Alice" in one sidebar are indistinguishable. When every
 * candidate is excluded the full pool comes back rather than nothing: a repeat
 * name beats no name.
 */
export const randomAgentName = (locale?: string, exclude?: Iterable<string>): string => {
  const tag = locale?.toLowerCase() ?? '';
  const taken = new Set(
    [...(exclude ?? [])].map((name) => name.trim().toLowerCase()).filter(Boolean),
  );

  if (tag.startsWith('zh')) {
    const traditional = tag.startsWith('zh-tw') || tag.startsWith('zh-hk') || tag.includes('hant');
    const pools = traditional ? ZH_HANT : ZH_HANS;
    return drawComposed(() => rollZhName(pools), taken);
  }

  const fullPool = FLAT_POOLS[tag.split('-')[0]] ?? EN_AGENT_NAMES;
  const available = taken.size > 0 ? fullPool.filter((n) => !taken.has(n.toLowerCase())) : fullPool;
  const pool = available.length > 0 ? available : fullPool;

  return pick(pool);
};
