/**
 * Ein Theme ist nur eine Farbtabelle. Die Farbrollen bleiben in jedem Theme gleich:
 * solide = ruhig, Gefahr = immer rot/orange, Hilfe = kühl/gelb, Spieler = hell und auffällig.
 */
export interface Theme {
  id: string
  name: string
  bgTop: string
  bgBottom: string
  /** Fläche neben dem Spielfeld (breite Bildschirme) und deren Rahmenlinie */
  surround: string
  frame: string
  decor: string[]
  decorAlpha: number
  /** Harter Schatten der Hintergrundformen (Farbe und Deckkraft) */
  decorShadow: string
  decorShadowAlpha: number
  solid: string
  solidTop: string
  solidShade: string
  /** Eis, brüchige Plattform */
  ice: string
  iceTop: string
  iceShade: string
  brittle: string
  brittleTop: string
  brittleShade: string
  danger: string
  dangerDark: string
  help: string
  help2: string
  goal: string
  player: string
  playerShade: string
  outline: string
  eyeWhite: string
  pupil: string
  /** line: Rahmen auf Panels und Hintergründen. Im dunklen Theme ist --outline fast so dunkel wie das Panel, dort braucht es eine helle Linie. */
  ui: { panel: string; text: string; accent: string; highlight: string; muted: string; line: string; success: string }
}

/** Memphis, dunkel: Türkis, Magenta, Gelb auf Nachtblau (90er) */
export const MEMPHIS_DARK: Theme = {
  id: 'memphis-dark',
  name: 'Memphis dunkel',
  bgTop: '#140B2E',
  bgBottom: '#2B1056',
  surround: '#05030F',
  frame: '#FF3EC8',
  decor: ['#00E5FF', '#FF3EC8', '#FFE14D', '#7B5CFF'],
  decorAlpha: 0.34,
  decorShadow: '#000000',
  decorShadowAlpha: 0.95,
  solid: '#4A2C8A',
  solidTop: '#8A6BFF',
  solidShade: '#341C66',
  ice: '#3F9FD0',
  iceTop: '#BDEBFF',
  iceShade: '#276F99',
  brittle: '#A8623A',
  brittleTop: '#E6A06E',
  brittleShade: '#6E3D22',
  danger: '#FF5A36',
  dangerDark: '#B8310F',
  help: '#00F0FF',
  help2: '#FFE14D',
  goal: '#FFE14D',
  player: '#FF4FD8',
  playerShade: '#C128A0',
  outline: '#0B0620',
  eyeWhite: '#FFFFFF',
  pupil: '#0B0620',
  ui: { panel: 'rgba(8, 4, 28, 0.82)', text: '#FFFFFF', accent: '#FFE14D', highlight: '#9B7DEA', muted: '#B9A8F0', line: 'rgba(185, 168, 240, 0.55)', success: '#2ECC71' },
}

