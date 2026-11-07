export interface Option<T extends string> {
  id: T
  label: string
}

export interface ColorOption extends Option<string> {
  /** null = Farbe des jeweiligen Themes (hell und dunkel haben ein eigenes Pink) */
  body: string | null
  shade: string | null
}

// Kein Rot (Gefahr) und kein Weiß (verschwindet mit den Augen)
export const COLORS: readonly ColorOption[] = [
  { id: 'pink', label: 'Pink', body: null, shade: null },
  { id: 'coral', label: 'Coral', body: '#FF8F9C', shade: '#D96378' },
  { id: 'orange', label: 'Orange', body: '#FF8A3D', shade: '#D9601A' },
  { id: 'yellow', label: 'Yellow', body: '#FFD23F', shade: '#D4A51E' },
  { id: 'lime', label: 'Lime', body: '#A6E22E', shade: '#78AE12' },
  { id: 'green', label: 'Green', body: '#2ECC71', shade: '#1E9E54' },
  { id: 'turquoise', label: 'Turquoise', body: '#2DD4BF', shade: '#159E91' },
  { id: 'blue', label: 'Blue', body: '#3A86FF', shade: '#2563D6' },
  { id: 'purple', label: 'Purple', body: '#9B6BFF', shade: '#7447D6' },
  { id: 'lavender', label: 'Lavender', body: '#C4A7FF', shade: '#9575D6' },
  { id: 'cream', label: 'Cream', body: '#E8E6D9', shade: '#C4C1B0' },
]

export const EYES = [
  { id: 'round', label: 'Round' },
  { id: 'big', label: 'Big' },
  { id: 'focus', label: 'Focus' },
  { id: 'small', label: 'Small' },
  { id: 'googly', label: 'Googly' },
  { id: 'sleepy', label: 'Sleepy' },
  { id: 'lashes', label: 'Lashes' },
] as const

export type EyeId = (typeof EYES)[number]['id']

export const PATTERNS = [
  { id: 'none', label: 'None' },
  { id: 'stripes', label: 'Stripes' },
  { id: 'diagonal', label: 'Diagonal' },
  { id: 'sprinkles', label: 'Sprinkles' },
  { id: 'squiggles', label: 'Squiggles' },
  { id: 'mini-zigzags', label: 'Mini zigzags' },
  { id: 'dots', label: 'Dots' },
  { id: 'checks', label: 'Checks' },
  { id: 'stars', label: 'Stars' },
  { id: 'hearts', label: 'Hearts' },
] as const

export type PatternId = (typeof PATTERNS)[number]['id']

export interface PatternColor extends Option<string> {
  /** null = Konturfarbe des jeweiligen Themes (dunkel auf hellem Körper) */
  hex: string | null
}

// Kein Rot (Gefahr)
export const PATTERN_COLORS: readonly PatternColor[] = [
  { id: 'white', label: 'White', hex: '#FFFFFF' },
  { id: 'ink', label: 'Dark', hex: null },
  { id: 'yellow', label: 'Yellow', hex: '#FFD23F' },
  { id: 'rose', label: 'Rose', hex: '#FF8FC2' },
  { id: 'mint', label: 'Mint', hex: '#7BE0C3' },
  { id: 'sky', label: 'Sky', hex: '#8EC5FF' },
  { id: 'orange', label: 'Orange', hex: '#FF8A3D' },
  { id: 'turquoise', label: 'Turquoise', hex: '#2DD4BF' },
  { id: 'coral', label: 'Coral', hex: '#FF8F9C' },
  { id: 'lavender', label: 'Lavender', hex: '#C4A7FF' },
]

export interface Look {
  color: string
  eyes: EyeId
  pattern: PatternId
  patternColor: string
}

export const DEFAULT_LOOK: Readonly<Look> = { color: 'pink', eyes: 'round', pattern: 'none', patternColor: 'white' }

