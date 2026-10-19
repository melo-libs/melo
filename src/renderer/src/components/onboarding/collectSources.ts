import type { ResolvedLanguage } from '@shared/types/ipc'

export type CollectSourceId = 'anthropic' | 'wechat' | 'zhihu' | 'substack' | 'medium'
export interface CollectSource {
  id: CollectSourceId
  name: string
  host: string
}

export const COLLECT_ARTICLE_URL = 'https://www.anthropic.com/engineering/building-effective-agents'

export const COLLECT_SOURCES = {
  'zh-CN': [
    { id: 'anthropic', name: 'Anthropic', host: 'anthropic.com' },
    { id: 'wechat', name: '微信公众号', host: 'mp.weixin.qq.com' },
    { id: 'zhihu', name: '知乎', host: 'zhihu.com' },
  ],
  en: [
    { id: 'anthropic', name: 'Anthropic', host: 'anthropic.com' },
    { id: 'substack', name: 'Substack', host: 'substack.com' },
    { id: 'medium', name: 'Medium', host: 'medium.com' },
  ],
} as const satisfies Record<ResolvedLanguage, readonly CollectSource[]>
