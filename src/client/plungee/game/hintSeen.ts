/**
 * Der Start-Button wird nur einmal pro laufender App-Session angezeigt.
 * Bewusst ohne localStorage oder sessionStorage.
 */
let seenInMemory = false

export function consumeControlsHint(): boolean {
  if (seenInMemory) return false
  seenInMemory = true
  return true
}
