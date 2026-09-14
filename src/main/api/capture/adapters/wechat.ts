import type { SiteAdapter } from '../types'

export const wechat: SiteAdapter = {
  name: 'WeChat',

  match: (url) => url.hostname === 'mp.weixin.qq.com',

  fetchHeaders: () => ({
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  }),

  imageHeaders: (pageUrl) => ({
    Referer: pageUrl.href,
  }),

  preprocessHtml: (html) => {
    let out = html
    // The article body sits in #js_content with visibility:hidden; JS
    // removes that on load.  Strip it so Readability can see the text.
    out = out.replace(
      /(<div[^>]*id="js_content"[^>]*?)style="[^"]*visibility:\s*hidden[^"]*"/i,
      '$1',
    )
    return out
  },
}
