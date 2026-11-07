export type LegalPage = 'privacy' | 'terms' | 'support'
export type LegalDestination = { page: LegalPage } | { url: string }

/** Keep bundled documents in-app and hand absolute external links to Devvit. */
export function legalDestination(href: string, origin: string): LegalDestination | null {
  try {
    const url = new URL(href, origin)
    if (url.origin === origin) {
      const page = /^\/(privacy|terms|support)\.html$/.exec(url.pathname)?.[1]
      return page ? { page: page as LegalPage } : null
    }
    if (url.protocol !== 'https:' || url.username || url.password) return null
    return { url: url.href }
  } catch { return null }
}
