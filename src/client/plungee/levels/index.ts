import { levelHash } from '../editor/hash'
import { validateLevel, type LevelData } from '../sim'
import parData from './par.json'

export type Difficulty = 'easy' | 'normal' | 'hard'

/** Reihenfolge und Namen der Schwierigkeitsgrade. Der Ordnername unter src/levels/ ist die id. */
export const DIFFICULTIES: ReadonlyArray<{ id: Difficulty; label: string }> = [
  { id: 'easy', label: 'Easy' },
  { id: 'normal', label: 'Normal' },
  { id: 'hard', label: 'Hard' },
]

export interface LevelEntry {
  /** Ordner/Dateiname ohne Endung, stabil für Bestzeiten und Fortschritt */
  key: string
  difficulty: Difficulty
  title: string
  data: LevelData
  /** Richtzeit in Ticks (Solver), null solange `npm run par` noch nicht gelaufen ist */
  par: number | null
}

const PAR = parData as Record<string, { hash: string; ticks: number | null }>

/**
 * Alle Dateien `src/levels/<easy|normal|hard>/*.level.ts` werden automatisch eingesammelt.
 * Der Ordner bestimmt den Schwierigkeitsgrad, der Dateiname die Reihenfolge darin (Nummern voranstellen,
 * z. B. `easy/03-mein-level.level.ts`). Jede Datei exportiert eine Funktion, die ein LevelData liefert.
 */
const modules = import.meta.glob<Record<string, unknown>>('./*/*.level.ts', { eager: true })

const ids = new Set<string>(DIFFICULTIES.map((d) => d.id))

export const LEVELS_BY_DIFFICULTY: Record<Difficulty, LevelEntry[]> = { easy: [], normal: [], hard: [] }

// Retain the original definitions for Reddit posts that already reference them.
// Replaced levels are no longer offered in the current campaign or new weeklies.
const RETIRED_KEYS = new Set([
  'easy/14-don-tget-crushed',
  'easy/19-up-in-the-corner',
  'easy/20-drop-it-like-it-shot',
  'easy/23-jump-jump',
])
const legacyLevels: LevelEntry[] = []

for (const path of Object.keys(modules).sort()) {
  const key = path.replace(/^\.\//, '').replace(/\.level\.ts$/, '')
  const folder = key.split('/')[0]
  if (!ids.has(folder)) {
    console.error(`[levels] ${path}: Ordner "${folder}" ist kein Schwierigkeitsgrad (${[...ids].join(', ')})`)
    continue
  }
  const make = Object.values(modules[path]).find((v) => typeof v === 'function') as (() => LevelData) | undefined
  if (!make) {
    console.error(`[levels] ${path}: keine Funktion exportiert`)
    continue
  }
  const data = make()
  const errors = validateLevel(data)
  if (errors.length) {
    console.error(`[levels] ${path} ist ungültig und wird übersprungen:\n- ${errors.join('\n- ')}`)
    continue
  }
  const p = PAR[key]
  const par = p && p.hash === levelHash(data) ? (p.ticks ?? null) : null
  const entries = RETIRED_KEYS.has(key) ? legacyLevels : LEVELS_BY_DIFFICULTY[folder as Difficulty]
  entries.push({
    key,
    difficulty: folder as Difficulty,
    title: data.title || key,
    data,
    par,
  })
}

/** Alle Level, nach Schwierigkeit und Dateiname geordnet */
export const LEVELS: LevelEntry[] = DIFFICULTIES.flatMap((d) => LEVELS_BY_DIFFICULTY[d.id])

/** Resolve both current campaign IDs and IDs used by existing Reddit posts. */
export function findLevel(key: unknown): LevelEntry | undefined {
  return LEVELS.find(level => level.key === key) ?? legacyLevels.find(level => level.key === key)
}
