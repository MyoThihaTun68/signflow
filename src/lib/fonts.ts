import { Caveat, Dancing_Script, Great_Vibes } from 'next/font/google';

const dancing = Dancing_Script({ subsets: ['latin'], weight: ['600'], display: 'swap' });
const vibes = Great_Vibes({ subsets: ['latin'], weight: ['400'], display: 'swap' });
const caveat = Caveat({ subsets: ['latin'], weight: ['600'], display: 'swap' });

export const SIGNATURE_FONTS = [
  { id: 'dancing', label: 'Classic', family: dancing.style.fontFamily, className: dancing.className },
  { id: 'vibes', label: 'Elegant', family: vibes.style.fontFamily, className: vibes.className },
  { id: 'caveat', label: 'Casual', family: caveat.style.fontFamily, className: caveat.className },
] as const;
