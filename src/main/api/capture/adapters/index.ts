import type { SiteAdapter } from '../types'
import { github } from './github'
import { wechat } from './wechat'
import { zhihu } from './zhihu'

/** Registry of built-in adapters — order matters (first match wins). */
export const builtinAdapters: SiteAdapter[] = [wechat, zhihu, github]
