import { OPS_ASSETS_BASE_URL } from '@lobechat/const';

export interface ChiefAgentArtwork {
  avatar: string;
  hero: string;
  id: string;
  tint: string;
}

const asset = (hash: string) => `${OPS_ASSETS_BASE_URL}/${hash}.webp`;

/**
 * Shared Chief Agent artwork catalog. The same avatar-to-hero pairing is used
 * by onboarding and the Inbox-owned home surface.
 */
export const CHIEF_AGENT_ARTWORKS: ChiefAgentArtwork[] = [
  {
    avatar: asset('887f1fa54f3896e91d8a0f5633f241bdc1bbddfe0877b806fe332be6194beed9'),
    hero: asset('aecf77a7df115e25f612dcdbfa250a87f1aaff4604c4cab932bcacd0aa04da2b'),
    id: 'lobe',
    tint: '#c98d81',
  },
  {
    avatar: asset('9f544d279dba487afe9134872bedc713add740fe8ecf7537b3ffe3dcadf828bd'),
    hero: asset('1375f50a1877121d132300d857aa409dfb8e502c56fa85025c157d70ac047432'),
    id: 'blueprint',
    tint: '#949dac',
  },
  {
    avatar: asset('060291e30cf08dd0cc19b1cd6b756a5a02f006c08a22cfca41f67aa18ac0c85b'),
    hero: asset('81e103976bef00a09a3171b07485f16c5f68251030c076875d4d7fc5cc1200a4'),
    id: 'breeze',
    tint: '#7e9d40',
  },
  {
    avatar: asset('6c69dcfa89c9500fcc8929335e471de2badbf14cb365745db100dc410d46e78b'),
    hero: asset('5596341587517e573d0816c5c1590798adb9569e5c37a3e9dd46071365bfc2a7'),
    id: 'buttercup',
    tint: '#eea856',
  },
  {
    avatar: asset('99d6ed604c0e068fd6cfe0d1df85b49caa7305ec6760a3059a8728d7be028e0d'),
    hero: asset('b6bb53d017ddd9161429a8b8022c4122091f644ece78af84fb6bcadcb995cbb6'),
    id: 'byte',
    tint: '#5a97db',
  },
  {
    avatar: asset('29a341b373683443f4a933026e1610357604e3e38e60f5a4c0acf44a6d851ab6'),
    hero: asset('a164b67adff205466b2b0987cb1dcb34830bf0cab5d5dd17bbbc1ffb7d139212'),
    id: 'coco',
    tint: '#f090a8',
  },
  {
    avatar: asset('fde19dbb08eeaae54e217a62f1d75dc0ed08b1e94f5782f071dc62c4a5bce0af'),
    hero: asset('18675c706284614bfa569386b7d48cc04168c788e6fe14afb1e202a55e898874'),
    id: 'dispatch',
    tint: '#5982c0',
  },
  {
    avatar: asset('ed5fa7edf75d4b5861fa312e51caa5797ddd0bd781eb81fb217f742758f78e77'),
    hero: asset('8e454fc33f0478d8fbb209d5db1e0b2416db4acb3321bb0a0abd184015a2f5cc'),
    id: 'flex',
    tint: '#e17530',
  },
  {
    avatar: asset('6740bc9a4836a1a27394c615fc349875139627d663a66addf2b46bbbbe063f79'),
    hero: asset('2b76a6229698229c9cdcc80668fcf218b2bd4c632c4511840f6ff99352f5754b'),
    id: 'hexley',
    tint: '#864fa4',
  },
  {
    avatar: asset('16dd03b20d96dcb84c44b3f000e25b6fe784dd7af4a18245f28251a3cb1bb60d'),
    hero: asset('5ec913f157704c4b8f8cd2ddebfcbf1da780e8cc25edcc2f8c4639d672f659b2'),
    id: 'kernel',
    tint: '#42424c',
  },
  {
    avatar: asset('76503f233e866ae6e09530d1e6037ad41b01efb7901bc43ad6081da6a55250c6'),
    hero: asset('a63be4071d9145084c6ee8e494d58d74ec561e45140dbecad5669ccda002f228'),
    id: 'latte',
    tint: '#c17739',
  },
  {
    avatar: asset('91d99e04f0808653d9a249b60f8aac3ffba127816f70eef8dcf95f3866c170fb'),
    hero: asset('0f62471c801fb327f8f4edec153136fcde1dfbb49bf81f51e043aa7692e647d8'),
    id: 'maestro',
    tint: '#b36bbc',
  },
  {
    avatar: asset('6ec33a8a3708cd2a4f01d0f40eeb1c50dedda73000b4a79eaf6a1a3aaba7a076'),
    hero: asset('557aca98e44af6ec65f3ed9e573f5d97c3342f3fe171441472845e8da64123fb'),
    id: 'moss',
    tint: '#d99d39',
  },
  {
    avatar: asset('d2c5ccc860e92b42a8bbeef8262b140afaade3d9d4227f39af7a6af060c8c277'),
    hero: asset('58539f0e1efe9155324c49a23cab20c5e50c5c69e5f4099fd58492967c42c712'),
    id: 'riot',
    tint: '#c43736',
  },
  {
    avatar: asset('1f905a9d3f1fa5af15ae7443f76c9fca93eed7e8170d87dd68ab35e3aa743663'),
    hero: asset('811ad76b771ace2f9a050aeb47bf38ae59ab5aeb2dd1599ae1a7437c3863bd7e'),
    id: 'shutter',
    tint: '#3f3c3e',
  },
  {
    avatar: asset('3e72dc1976f3c5089e9e196dc0769baa1ac52eb1e9bc50a100a8d54ff1f1a36f'),
    hero: asset('9622c5fbc4dc7d87457299d5fa73d7c456f95929dcbb10d8639e3cd476f74969'),
    id: 'sienna',
    tint: '#e9ad39',
  },
];

export const DEFAULT_CHIEF_AGENT_ARTWORK = CHIEF_AGENT_ARTWORKS[0];

export const resolveChiefAgentArtwork = (avatar?: string): ChiefAgentArtwork =>
  CHIEF_AGENT_ARTWORKS.find((item) => item.avatar === avatar) ?? DEFAULT_CHIEF_AGENT_ARTWORK;
