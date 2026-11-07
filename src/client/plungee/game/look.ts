import { reactive, watch } from 'vue'
import type { Theme } from './theme'

/**
 * Aussehen der Figur. Rein optisch: Physik, Replays und Bestzeiten bleiben unberührt.
 * Die Farbe wird über das Theme angewendet (applyLook), alles andere zeichnet character.ts.
 */

import { COLORS, EYES, PATTERNS, PATTERN_COLORS, DEFAULT_LOOK, type Look } from '../../../shared/character-options'
export * from '../../../shared/character-options'

const pick = <T extends string>(list: ReadonlyArray<{ id: T }>, v: unknown, fallback: T): T =>
  list.some((o) => o.id === v) ? (v as T) : fallback

/** Unbekannte oder kaputte Werte (alte Version, von Hand geändert) werden durch den Standard ersetzt */
export function sanitizeLook(raw: unknown): Look {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    color: pick(COLORS, r.color, DEFAULT_LOOK.color),
    eyes: pick(EYES, r.eyes, DEFAULT_LOOK.eyes),
    pattern: pick(PATTERNS, r.pattern, DEFAULT_LOOK.pattern),
    patternColor: pick(PATTERN_COLORS, r.patternColor, DEFAULT_LOOK.patternColor),
  }
}

/** Das Theme mit der gewählten Körperfarbe. Alles, was th.player nutzt (Partikel, Marker, Menü), folgt damit automatisch. */
export function applyLook(theme: Theme, l: Pick<Look, 'color'>): Theme {
  const c = COLORS.find((o) => o.id === l.color)
  if (!c || !c.body || !c.shade) return theme
  return { ...theme, player: c.body, playerShade: c.shade }
}

/** Zufällige Kombination aus allen Optionen; `not` ist das aktuelle Aussehen, das nicht noch einmal herauskommt */
export function randomLook(rand: () => number = Math.random, not?: Look): Look {
  const one = <T>(list: readonly T[]): T => list[Math.min(list.length - 1, Math.floor(rand() * list.length))]
  for (let i = 0; i < 20; i++) {
    const l: Look = {
      color: one(COLORS).id,
      eyes: one(EYES).id,
      pattern: one(PATTERNS).id,
      patternColor: one(PATTERN_COLORS).id,
    }
    // Ohne Muster zählt die Musterfarbe nicht: sie bleibt wie sie war
    if (l.pattern === 'none') l.patternColor = not?.patternColor ?? DEFAULT_LOOK.patternColor
    const same = not && l.color === not.color && l.eyes === not.eyes && l.pattern === not.pattern && l.patternColor === not.patternColor
    if (!same) return l
  }
  // Nur bei einem kaputten Zufall: wenigstens eine andere Körperfarbe als jetzt
  const base = not ?? DEFAULT_LOOK
  const i = COLORS.findIndex((c) => c.id === base.color)
  return { ...base, color: COLORS[(i + 1) % COLORS.length].id }
}

const KEY = 'plungee:look'

export function loadLook(): Look {
  try {
    const raw = localStorage.getItem(KEY)
    return sanitizeLook(raw ? JSON.parse(raw) : null)
  } catch {
    return { ...DEFAULT_LOOK }
  }
}

function saveLook(l: Look): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ color: l.color, eyes: l.eyes, pattern: l.pattern, patternColor: l.patternColor }))
  } catch {
    /* nicht kritisch */
  }
}

/** Aktuelles Aussehen, wird bei jeder Änderung gespeichert */
export const look = reactive<Look>(loadLook())
watch(look, saveLook, { deep: true })
