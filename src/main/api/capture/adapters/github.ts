import type { SiteAdapter } from '../types'

export const github: SiteAdapter = {
  name: 'GitHub',

  match: (url) => url.hostname === 'github.com',

  cleanTitle: (title) => {
    // "GitHub - user/repo: description" → "repo"
    const m = title.match(/^GitHub\s*-\s*[\w.-]+\/([\w.-]+)/)
    return m ? m[1] : title.replace(/^GitHub\s*-\s*/, '')
  },
}
