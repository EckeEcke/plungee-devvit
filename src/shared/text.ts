/** Reject C0 control characters without a control-character regex. */
export function hasControlCharacters(text: string): boolean {
  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) < 32) return true
  }
  return false
}
