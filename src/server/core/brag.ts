export function isWinningRun(ticks: number, targetTicks: number): boolean {
  return Number.isInteger(ticks) && Number.isInteger(targetTicks) && ticks > 0 && ticks < targetTicks
}

export function bragText(ticks: number, targetTicks: number, deaths: number, tickRate: number): string {
  if (!isWinningRun(ticks, targetTicks)) throw new Error('This run did not beat the target.')
  const difference = targetTicks - ticks
  const time = (Math.floor(ticks * 100 / tickRate) / 100).toFixed(2)
  const result = `I beat the level in ${time} s! ${deaths} ${deaths === 1 ? 'death' : 'deaths'}`
  if (difference < tickRate / 2) return `Photofinish! ${result}`
  if (difference <= tickRate * 2) return `Close, but ${result}`
  return `Easy 😎, ${result}`
}
