/**
 * Default personal names assigned to a freshly created agent.
 *
 * An agent's `name` is the identity it is addressed by ("Alice", "小艾"), while
 * `title` describes the role it plays ("Health Assistant"). A brand-new agent has
 * no role yet, so we seed a name immediately — it gives the agent a face in the
 * sidebar before the Agent Builder conversation has produced anything, and the
 * builder is free to replace it with one that fits the finished role.
 *
 * Names are deliberately plain and common: they should read as a person, not as
 * a product. Nothing here may collide with an assistant brand (Siri, Alexa,
 * Claude, Gemini, ...) or with LobeHub's own naming.
 *
 * Chinese names are composed from surname + given-name pools so the result
 * varies in length (2–4 characters); every other language draws from a flat
 * pool of common given names. Languages without a pool fall back to English,
 * which reads acceptably across Latin-script locales.
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
 * Building blocks for composed Chinese names. Double given names are composed
 * from `doubleFirst` × `doubleSecond` rather than enumerated, which is what
 * gives the space its size (~13k doubles → ~2.2M full names); `blocked` lists
 * the rare pairs that read as everyday words or place names instead of person
 * names, plus full composed names that collide with brands or iconic people.
 */
interface ZhNameCharset {
  blocked: ReadonlySet<string>;
  compoundSurnames: readonly string[];
  doubleFirst: readonly string[];
  doubleSecond: readonly string[];
  givenSingle: readonly string[];
  surnames: readonly string[];
}

const ZH_HANS: ZhNameCharset = {
  // prettier-ignore
  blocked: new Set([
    // pairs that read as everyday words / place names
    '明白', '晚安', '安眠', '雪白', '青白', '风月', '风雨', '云雨', '望风', '望远',
    '清华', '昭然', '雪山', '梅雨', '朝阳', '新华', '雅安', '洛阳', '宁夏', '新竹',
    '永和', '云烟', '风烟', '竹笙', '夕阳', '祈雨', '文言', '碧玉', '牧歌', '时辰',
    '岁月', '素颜', '新颖', '明星', '风雪', '文墨', '春梦', '鹿晗',
    // full surname+given names that collide with brands / iconic people
    '马云', '李宁', '周瑜',
  ]),
  // prettier-ignore
  compoundSurnames: [
    '东方', '上官', '公孙', '南宫', '司马', '司徒', '夏侯', '宇文', '尉迟', '慕容',
    '独孤', '皇甫', '百里', '西门', '诸葛', '轩辕', '长孙', '呼延', '令狐', '欧阳',
  ],
  // prettier-ignore
  doubleFirst: [
    '子', '若', '亦', '云', '清', '沐', '晚', '静', '知', '慕',
    '听', '望', '疏', '温', '书', '予', '半', '未', '语', '诗',
    '汀', '澄', '乐', '思', '心', '怀', '佩', '依', '令', '安',
    '宛', '星', '明', '晓', '春', '秋', '雪', '雨', '风', '芷',
    '青', '松', '荷', '墨', '昭', '凌', '鹤', '南', '初', '可',
    '佳', '采', '鹿', '维', '皓', '悠', '一', '以', '念', '素',
    '景', '沁', '泠', '兰', '竹', '梅', '桂', '栖', '晏', '暮',
    '朝', '暄', '新', '永', '长', '承', '沧', '千', '少', '锦',
    '雅', '芸', '洛', '池', '婉', '曼', '灵', '简', '蓝', '允',
    '宁', '夕', '霁', '淳', '忆', '惜', '攸', '栀', '祈', '筠',
    '嘉', '文', '碧', '丹', '彦', '君', '奕', '砚', '牧', '浅',
    '晨', '闻', '歆', '沅', '熹', '茗', '时', '岁', '皎', '翩',
  ],
  // prettier-ignore
  doubleSecond: [
    '瑶', '宁', '安', '欣', '澜', '悦', '远', '青', '轩', '晴',
    '欢', '夏', '云', '薇', '姝', '然', '涵', '溪', '舟', '风',
    '月', '白', '兰', '桐', '霖', '深', '洲', '辞', '竹', '影',
    '言', '川', '玉', '华', '霄', '鸣', '乔', '辰', '央', '汐',
    '如', '雨', '山', '眠', '桢', '诺', '之', '卿', '歌', '阳',
    '晖', '微', '和', '瑾', '仪', '舒', '宸', '曦', '珞', '瑄',
    '珂', '绮', '苓', '萱', '蓉', '茜', '苒', '芊', '帆', '棠',
    '禾', '笙', '熙', '昕', '潼', '滢', '淇', '恬', '怡', '兮',
    '烟', '霏', '雯', '霓', '岚', '宜', '妍', '嫣', '容', '颜',
    '盈', '莹', '颖', '琪', '琳', '璇', '璐', '渊', '雪', '星',
    '晗', '蕊', '菲', '枫', '槿', '墨', '彤', '梦', '寻', '玥',
  ],
  // prettier-ignore
  givenSingle: [
    '川', '汀', '汐', '沅', '沐', '沛', '泓', '洛', '洲', '涵', '淮', '清', '湘', '溪', '澄', '澈', '泽', '潇', '澜',
    '明', '昭', '星', '月', '晴', '晗', '暄', '曦', '曜', '晖', '晚', '光', '辉', '烨', '焕', '灿',
    '云', '风', '岚', '雪', '霜', '露', '霞', '虹',
    '禾', '松', '柏', '桐', '楠', '榆', '槐', '梧', '杉', '荷', '莲', '菱', '芷', '兰', '苇', '茉', '芊', '苓', '茵',
    '山', '峰', '峻', '崇', '岩', '屿',
    '文', '书', '墨', '章', '诗', '词', '琴', '棋', '画',
    '珊', '瑜', '瑾', '琛', '璟', '珩', '琅',
    '思', '念', '忆', '悟', '惟', '慧', '睿', '智', '聪', '谦', '谨', '诚', '毅', '信', '修', '俊', '卓', '嘉',
    '远', '遥', '逸', '然', '知', '衡', '野', '舟', '深',
    '鹤', '燕', '鸿', '雁', '声', '韵', '歌', '咏',
    '安', '宁', '和', '泰', '康', '青', '黛', '丹', '彤', '素', '春', '秋', '冬', '初', '若', '予', '亦',
    '宸', '辰', '宇', '轩', '昀', '昱', '晟',
    '瑶', '欣', '悦', '佩', '依', '姝', '卿', '泠', '仪', '舒',
    '珞', '珂', '萱', '熙', '昕', '恬', '怡', '霏', '雯', '玥',
    '妍', '盈', '莹', '颖', '琳', '蕊', '菲', '枫', '梦', '寻',
    '婉', '曼', '碧', '彦', '君', '奕', '砚', '茗', '歆', '攸',
    '筠', '淳', '霁', '皎', '翩', '瑄', '灵',
  ],
  // prettier-ignore
  surnames: [
    '王', '李', '张', '刘', '陈', '杨', '黄', '赵', '吴', '周',
    '徐', '孙', '马', '朱', '胡', '郭', '何', '林', '罗', '高',
    '郑', '梁', '谢', '宋', '唐', '许', '韩', '冯', '邓', '曹',
    '彭', '曾', '肖', '田', '董', '袁', '潘', '于', '蒋', '蔡',
    '余', '杜', '叶', '程', '苏', '魏', '吕', '丁', '任', '沈',
    '姚', '卢', '姜', '崔', '钟', '谭', '陆', '汪', '范', '金',
    '石', '廖', '贾', '夏', '韦', '傅', '方', '白', '邹', '孟',
    '熊', '秦', '邱', '江', '尹', '薛', '闫', '段', '雷', '侯',
    '龙', '史', '陶', '黎', '贺', '顾', '毛', '郝', '龚', '邵',
    '万', '钱', '严', '覃', '武', '戴', '莫', '孔', '向', '汤',
    '常', '赖', '庞', '樊', '兰', '殷', '施', '洪', '翟', '倪',
    '牛', '章', '鲁', '葛', '伍', '申', '尤', '毕', '聂', '焦',
    '俞', '柴', '邢', '路', '岳', '齐', '梅', '庄', '辛', '管',
    '祝', '左', '涂', '谷', '祁', '时', '舒', '耿', '詹', '关',
    '苗', '费', '纪', '靳', '盛', '童', '欧', '甄', '项', '曲',
  ],
};

const ZH_HANT: ZhNameCharset = {
  // prettier-ignore
  blocked: new Set([
    // pairs that read as everyday words / place names
    '明白', '晚安', '安眠', '雪白', '青白', '風月', '風雨', '雲雨', '望風', '望遠',
    '清華', '昭然', '雪山', '梅雨', '朝陽', '新華', '雅安', '洛陽', '寧夏', '新竹',
    '永和', '雲煙', '風煙', '竹笙', '夕陽', '祈雨', '文言', '碧玉', '牧歌', '時辰',
    '歲月', '素顏', '新穎', '明星', '風雪', '文墨', '春夢', '鹿晗',
    // full surname+given names that collide with brands / iconic people
    '馬雲', '李寧', '周瑜',
  ]),
  // prettier-ignore
  compoundSurnames: [
    '東方', '上官', '公孫', '南宮', '司馬', '司徒', '夏侯', '宇文', '尉遲', '慕容',
    '獨孤', '皇甫', '百里', '西門', '諸葛', '軒轅', '長孫', '呼延', '令狐', '歐陽',
  ],
  // prettier-ignore
  doubleFirst: [
    '子', '若', '亦', '雲', '清', '沐', '晚', '靜', '知', '慕',
    '聽', '望', '疏', '溫', '書', '予', '半', '未', '語', '詩',
    '汀', '澄', '樂', '思', '心', '懷', '佩', '依', '令', '安',
    '宛', '星', '明', '曉', '春', '秋', '雪', '雨', '風', '芷',
    '青', '松', '荷', '墨', '昭', '凌', '鶴', '南', '初', '可',
    '佳', '採', '鹿', '維', '皓', '悠', '一', '以', '念', '素',
    '景', '沁', '泠', '蘭', '竹', '梅', '桂', '棲', '晏', '暮',
    '朝', '暄', '新', '永', '長', '承', '滄', '千', '少', '錦',
    '雅', '芸', '洛', '池', '婉', '曼', '靈', '簡', '藍', '允',
    '寧', '夕', '霽', '淳', '憶', '惜', '攸', '梔', '祈', '筠',
    '嘉', '文', '碧', '丹', '彥', '君', '奕', '硯', '牧', '淺',
    '晨', '聞', '歆', '沅', '熹', '茗', '時', '歲', '皎', '翩',
  ],
  // prettier-ignore
  doubleSecond: [
    '瑤', '寧', '安', '欣', '瀾', '悅', '遠', '青', '軒', '晴',
    '歡', '夏', '雲', '薇', '姝', '然', '涵', '溪', '舟', '風',
    '月', '白', '蘭', '桐', '霖', '深', '洲', '辭', '竹', '影',
    '言', '川', '玉', '華', '霄', '鳴', '喬', '辰', '央', '汐',
    '如', '雨', '山', '眠', '楨', '諾', '之', '卿', '歌', '陽',
    '暉', '微', '和', '瑾', '儀', '舒', '宸', '曦', '珞', '瑄',
    '珂', '綺', '苓', '萱', '蓉', '茜', '苒', '芊', '帆', '棠',
    '禾', '笙', '熙', '昕', '潼', '瀅', '淇', '恬', '怡', '兮',
    '煙', '霏', '雯', '霓', '嵐', '宜', '妍', '嫣', '容', '顏',
    '盈', '瑩', '穎', '琪', '琳', '璇', '璐', '淵', '雪', '星',
    '晗', '蕊', '菲', '楓', '槿', '墨', '彤', '夢', '尋', '玥',
  ],
  // prettier-ignore
  givenSingle: [
    '川', '汀', '汐', '沅', '沐', '沛', '泓', '洛', '洲', '涵', '淮', '清', '湘', '溪', '澄', '澈', '澤', '瀟', '瀾',
    '明', '昭', '星', '月', '晴', '晗', '暄', '曦', '曜', '暉', '晚', '光', '輝', '燁', '煥', '燦',
    '雲', '風', '嵐', '雪', '霜', '露', '霞', '虹',
    '禾', '松', '柏', '桐', '楠', '榆', '槐', '梧', '杉', '荷', '蓮', '菱', '芷', '蘭', '葦', '茉', '芊', '苓', '茵',
    '山', '峰', '峻', '崇', '岩', '嶼',
    '文', '書', '墨', '章', '詩', '詞', '琴', '棋', '畫',
    '珊', '瑜', '瑾', '琛', '璟', '珩', '琅',
    '思', '念', '憶', '悟', '惟', '慧', '睿', '智', '聰', '謙', '謹', '誠', '毅', '信', '修', '俊', '卓', '嘉',
    '遠', '遙', '逸', '然', '知', '衡', '野', '舟', '深',
    '鶴', '燕', '鴻', '雁', '聲', '韻', '歌', '詠',
    '安', '寧', '和', '泰', '康', '青', '黛', '丹', '彤', '素', '春', '秋', '冬', '初', '若', '予', '亦',
    '宸', '辰', '宇', '軒', '昀', '昱', '晟',
    '瑤', '欣', '悅', '佩', '依', '姝', '卿', '泠', '儀', '舒',
    '珞', '珂', '萱', '熙', '昕', '恬', '怡', '霏', '雯', '玥',
    '妍', '盈', '瑩', '穎', '琳', '蕊', '菲', '楓', '夢', '尋',
    '婉', '曼', '碧', '彥', '君', '奕', '硯', '茗', '歆', '攸',
    '筠', '淳', '霽', '皎', '翩', '瑄', '靈',
  ],
  // prettier-ignore
  surnames: [
    '王', '李', '張', '劉', '陳', '楊', '黃', '趙', '吳', '周',
    '徐', '孫', '馬', '朱', '胡', '郭', '何', '林', '羅', '高',
    '鄭', '梁', '謝', '宋', '唐', '許', '韓', '馮', '鄧', '曹',
    '彭', '曾', '肖', '田', '董', '袁', '潘', '于', '蔣', '蔡',
    '余', '杜', '葉', '程', '蘇', '魏', '呂', '丁', '任', '沈',
    '姚', '盧', '姜', '崔', '鍾', '譚', '陸', '汪', '范', '金',
    '石', '廖', '賈', '夏', '韋', '傅', '方', '白', '鄒', '孟',
    '熊', '秦', '邱', '江', '尹', '薛', '閆', '段', '雷', '侯',
    '龍', '史', '陶', '黎', '賀', '顧', '毛', '郝', '龔', '邵',
    '萬', '錢', '嚴', '覃', '武', '戴', '莫', '孔', '向', '湯',
    '常', '賴', '龐', '樊', '蘭', '殷', '施', '洪', '翟', '倪',
    '牛', '章', '魯', '葛', '伍', '申', '尤', '畢', '聶', '焦',
    '俞', '柴', '邢', '路', '岳', '齊', '梅', '莊', '辛', '管',
    '祝', '左', '涂', '谷', '祁', '時', '舒', '耿', '詹', '關',
    '苗', '費', '紀', '靳', '盛', '童', '歐', '甄', '項', '曲',
  ],
};

/**
 * Compose a double given name from the first/second pools, rejecting doubled
 * characters and pairs that read as everyday words. Rejections are so rare
 * (<1% of the space) that the loop returns on the first draw in practice; the
 * fixed pair after it is an unreachable-in-practice backstop.
 */
const composeDouble = (charset: ZhNameCharset): string => {
  for (let i = 0; i < 32; i++) {
    const first = pick(charset.doubleFirst);
    const second = pick(charset.doubleSecond);
    if (first !== second && !charset.blocked.has(first + second)) return first + second;
  }
  return charset.doubleFirst[0] + charset.doubleSecond[0];
};

/**
 * One weighted roll across the four name shapes. Length distribution: two
 * characters 15% (bare double given name 5%, surname + single character 10%),
 * three characters 80% (surname + double given name), four characters 5%
 * (compound surname + double given name).
 *
 * The bare-double share keeps a surname-less name ("晚晴") in rotation for
 * warmth, weighted low because its pool (~13k) is the smallest bucket: the
 * overall Σp² ≈ 8.8e-7 gives an effective pool of ~1.1M names, and raising
 * the small buckets is what shrinks it.
 */
const rollZhName = (charset: ZhNameCharset): string => {
  const roll = Math.random();

  if (roll < 0.05) return composeDouble(charset);
  if (roll < 0.15) return pick(charset.surnames) + pick(charset.givenSingle);
  if (roll < 0.95) return pick(charset.surnames) + composeDouble(charset);
  return pick(charset.compoundSurnames) + composeDouble(charset);
};

/**
 * Compose one Chinese name. Beyond the pair-level screening inside
 * `composeDouble`, the FULL name is checked against `blocked` too — that is
 * what stops surname + single-character draws from minting "马云" or "李宁".
 * Only exact matches are rejected: "马云汐" is a fine name even though it
 * starts with a blocked one. The 4-character fallback cannot collide with the
 * all-2-character block list.
 */
const composeZhName = (charset: ZhNameCharset): string => {
  for (let i = 0; i < 8; i++) {
    const name = rollZhName(charset);
    if (!charset.blocked.has(name)) return name;
  }
  return pick(charset.compoundSurnames) + composeDouble(charset);
};

/**
 * Draw from a generator while avoiding taken names. Composed names come from a
 * space of thousands, so a handful of retries all but guarantees a fresh one;
 * when luck runs out, a repeat name beats no name.
 */
const drawComposed = (generate: () => string, taken: ReadonlySet<string>): string => {
  let candidate = generate();
  for (let i = 0; i < 20 && taken.has(candidate.toLowerCase()); i++) candidate = generate();
  return candidate;
};

/**
 * Pick a random display name for a new agent, matching the user's language.
 *
 * Chinese locales get a composed 2–4 character name — traditional script for
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
    return drawComposed(() => composeZhName(traditional ? ZH_HANT : ZH_HANS), taken);
  }

  const fullPool = FLAT_POOLS[tag.split('-')[0]] ?? EN_AGENT_NAMES;
  const available = taken.size > 0 ? fullPool.filter((n) => !taken.has(n.toLowerCase())) : fullPool;
  const pool = available.length > 0 ? available : fullPool;

  return pick(pool);
};
