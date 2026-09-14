import type { SiteAdapter } from '../types'

export const zhihu: SiteAdapter = {
  name: 'Zhihu',

  match: (url) =>
    url.hostname === 'zhuanlan.zhihu.com' ||
    url.hostname === 'www.zhihu.com' ||
    url.hostname === 'zhihu.com',

  imageHeaders: (pageUrl) => ({
    Referer: pageUrl.href,
  }),
}
