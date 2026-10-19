import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import { createInstance, type i18n } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { IpcChannels, type IpcResponse, type ResolvedLanguage } from '@shared/types/ipc'
import { en } from '@shared/locales/en'
import { zhCN } from '@shared/locales/zh-CN'
import { WorkspaceOpener } from '../WorkspaceOpener'
import { TOUR_COMPLETED_KEY } from './tour'
import { COLLECT_ARTICLE_URL } from './collectSources'

describe('the user-paced CODE introduction', () => {
  let root: Root
  let doc: Document
  let storage: Map<string, string>
  let hidden: boolean
  let reducedMotion: boolean
  let notifyMotionChange: () => void
  let focus: ReturnType<typeof vi.spyOn>
  let translation: i18n
  const invoke = vi.fn(
    async (
      _channel: IpcChannels,
      args: { language: ResolvedLanguage },
    ): Promise<IpcResponse<{ resolved: ResolvedLanguage }>> => ({
      success: true,
      data: { resolved: args.language },
    }),
  )
  const actions = {
    onOpenWorkspace: vi.fn(async () => {}),
    onCreateWorkspace: vi.fn(async () => {}),
    onOpenFile: vi.fn(async () => {}),
  }

  beforeEach(async () => {
    vi.useFakeTimers()
    const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>')
    doc = document
    hidden = false
    reducedMotion = false
    storage = new Map()
    vi.stubGlobal('window', window)
    vi.stubGlobal('document', document)
    vi.stubGlobal('navigator', { platform: 'MacIntel' })
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    })
    const media = Object.assign(new window.EventTarget(), {
      matches: false,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })
    Object.defineProperty(media, 'matches', { get: () => reducedMotion })
    window.matchMedia = () => media
    notifyMotionChange = () => {
      media.dispatchEvent(new window.Event('change'))
    }
    Object.defineProperty(document, 'hidden', { get: () => hidden })
    Object.defineProperty(window, 'api', { value: { invoke }, configurable: true })
    translation = createInstance()
    await translation.init({
      lng: 'en',
      fallbackLng: 'en',
      resources: { en: { translation: en }, 'zh-CN': { translation: zhCN } },
      interpolation: { escapeValue: false },
    })
    focus = vi.spyOn(window.HTMLElement.prototype, 'focus')
    root = createRoot(document.getElementById('root')!)
    vi.clearAllMocks()
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  const mount = () =>
    act(async () =>
      root.render(
        createElement(
          I18nextProvider,
          { i18n: translation },
          createElement(WorkspaceOpener, actions),
        ),
      ),
    )
  const step = () => doc.querySelector('.ws-opener')?.getAttribute('data-step')
  const playing = () => doc.querySelector('.ws-opener')?.getAttribute('data-playing')
  const click = (selector: string) =>
    act(async () => {
      doc.querySelector<HTMLElement>(selector)!.click()
    })
  const mountDemo = async () => {
    await mount()
    await click('.ob-continue')
  }
  const selectLanguage = (language: ResolvedLanguage) =>
    act(async () => {
      const select = doc.querySelector<HTMLSelectElement>('.ob-language-picker select')!
      for (const option of select.querySelectorAll('option')) {
        option.selected = option.value === language
      }
      select.dispatchEvent(new window.Event('change', { bubbles: true }))
    })
  const wait = () =>
    act(async () => {
      vi.advanceTimersByTime(60000)
    })
  const press = (key: string, options: Partial<KeyboardEvent> = {}) =>
    act(async () => {
      window.dispatchEvent(Object.assign(new window.Event('keydown'), { key, ...options }))
    })

  it('starts with the welcome and keeps every page user-paced without a language gate', async () => {
    await mount()
    expect(focus).toHaveBeenCalledOnce()
    expect(step()).toBe('welcome')
    expect(doc.querySelector('select[aria-label="语言 / Language"]')).not.toBeNull()
    expect(doc.querySelector('.ob-language, .ob-language-confirm')).toBeNull()
    await wait()
    expect(step()).toBe('welcome')
    expect(invoke).not.toHaveBeenCalled()
    expect(doc.querySelector('.ob-collect-art')).toBeNull()
    expect(playing()).toBe('false')
    expect(doc.querySelector('.ob-watch, .ob-auto-progress')).toBeNull()
    await click('.ob-continue')
    for (const feature of ['collect', 'organize', 'distill', 'express']) {
      expect(step()).toBe(feature)
      await wait()
      expect(step()).toBe(feature)
      expect(storage.get(TOUR_COMPLETED_KEY)).toBeUndefined()
      await click('.ob-continue')
    }
    expect(step()).toBe('start')
    expect(storage.get(TOUR_COMPLETED_KEY)).toBe('1')
    expect(actions.onOpenWorkspace).not.toHaveBeenCalled()
  })

  it('replays the current animation without advancing the page or stealing focus', async () => {
    await mountDemo()
    const artwork = doc.querySelector('.ob-art')
    focus.mockClear()
    await click('.ob-replay-scene')
    expect(doc.querySelector('.ob-art')).not.toBe(artwork)
    expect(step()).toBe('collect')
    expect(focus).not.toHaveBeenCalled()
    await wait()
    expect(step()).toBe('collect')
  })

  it('shares one navigation footer across the welcome, features, language changes and replays', async () => {
    await mount()
    const footer = doc.querySelector('.ob-navigation')
    const button = doc.querySelector('.ob-continue')
    const paginationSlot = doc.querySelector('.ob-pagination-slot')
    expect(footer?.parentElement?.className).toBe('ob-content')
    expect(footer?.parentElement?.parentElement?.className).toBe('ws-opener')
    expect(doc.querySelector('.ob-main .ob-continue, .ob-main .ob-pagination')).toBeNull()
    expect(paginationSlot?.children).toHaveLength(0)
    for (const feature of ['collect', 'organize', 'distill', 'express']) {
      await click('.ob-continue')
      expect(step()).toBe(feature)
      expect(doc.querySelector('.ob-navigation')).toBe(footer)
      expect(doc.querySelector('.ob-continue')).toBe(button)
      expect(doc.querySelector('.ob-pagination-slot')).toBe(paginationSlot)
      expect(doc.querySelectorAll('.ob-page-dot')).toHaveLength(4)
    }
    await selectLanguage('zh-CN')
    await click('.ob-replay-scene')
    expect(doc.querySelector('.ob-continue')).toBe(button)
    expect(button?.textContent).toBe(zhCN.onboarding.startUsing)
    await click('.ob-continue')
    expect(step()).toBe('start')
    expect(doc.querySelector('.ob-navigation')).toBeNull()
  })

  it('resets content scrolling only when the page changes', async () => {
    await mountDemo()
    const main = doc.querySelector<HTMLElement>('.ob-main')!
    main.scrollTop = 120
    await click('.ob-replay-scene')
    expect(main.scrollTop).toBe(120)
    await selectLanguage('zh-CN')
    expect(main.scrollTop).toBe(120)
    await click('.ob-continue')
    expect(step()).toBe('organize')
    expect(main.scrollTop).toBe(0)
    main.scrollTop = 60
    await click('.ob-page-dot:nth-child(3)')
    expect(step()).toBe('distill')
    expect(main.scrollTop).toBe(0)
  })

  it('applies the chosen language to the welcome and source artwork before continuing', async () => {
    await mount()
    await selectLanguage('zh-CN')
    expect(invoke).toHaveBeenCalledWith(IpcChannels.InvokeSetLanguage, { language: 'zh-CN' })
    expect(translation.language).toBe('zh-CN')
    expect(doc.querySelector('h1')?.textContent).toBe(zhCN.onboarding.welcomeTitle)
    await click('.ob-continue')
    expect(
      [...doc.querySelectorAll('.ob-source-hint > span:last-child')].map(
        (item) => item.textContent,
      ),
    ).toEqual(['Anthropic', '微信公众号', '知乎'])
    expect(doc.querySelector('.ob-clip-link strong')?.textContent).toBe(
      zhCN.onboarding.demo.articleTitle,
    )
    expect(doc.querySelector('.ob-captured h2')?.textContent).toBe(
      zhCN.onboarding.demo.articleTitle,
    )
    expect(doc.querySelectorAll('.ob-captured')).toHaveLength(1)
    expect(doc.querySelectorAll('.ob-article-reading')).toHaveLength(1)
    expect(doc.querySelectorAll('.ob-article-figure img')).toHaveLength(1)
    expect(doc.querySelector('.ob-clip-save')?.textContent).toContain('收件箱')
  })

  it('reflects the resolved language without writing a preference on mount', async () => {
    await translation.changeLanguage('zh-CN')
    await mount()
    expect(doc.querySelector<HTMLSelectElement>('select')?.value).toBe('zh-CN')
    expect(invoke).not.toHaveBeenCalled()
    await act(async () => root.render(null))
    await mount()
    expect(step()).toBe('welcome')
    expect(storage.get(TOUR_COMPLETED_KEY)).toBeUndefined()
  })

  it('prevents duplicate language writes without blocking or resetting page navigation', async () => {
    let finish!: (value: IpcResponse<{ resolved: ResolvedLanguage }>) => void
    invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    await mount()
    await selectLanguage('zh-CN')
    expect(step()).toBe('welcome')
    expect(doc.querySelector<HTMLSelectElement>('select')?.disabled).toBe(false)
    expect(doc.querySelector('select')?.getAttribute('aria-busy')).toBe('true')
    expect(doc.querySelector('option[value="en"]')?.hasAttribute('disabled')).toBe(true)
    expect(doc.querySelector('option[value="zh-CN"]')?.hasAttribute('disabled')).toBe(false)
    await press('ArrowRight')
    await selectLanguage('en')
    expect(invoke).toHaveBeenCalledOnce()
    expect(step()).toBe('collect')
    await act(async () => finish({ success: true, data: { resolved: 'zh-CN' } }))
    expect(step()).toBe('collect')
    expect(translation.language).toBe('zh-CN')
    expect(doc.querySelector<HTMLSelectElement>('select')?.disabled).toBe(false)
    expect(doc.querySelector('select')?.hasAttribute('aria-busy')).toBe(false)
    expect(doc.querySelector('option[value="en"]')?.hasAttribute('disabled')).toBe(false)
  })

  it('keeps language selection available when saving fails and allows retrying', async () => {
    invoke.mockResolvedValueOnce({ success: false, error: 'Could not save the preference' })
    await mount()
    await selectLanguage('zh-CN')
    expect(step()).toBe('welcome')
    expect(doc.querySelector('[role="alert"]')?.textContent).toContain(
      'Couldn’t change your language',
    )
    expect(doc.querySelector<HTMLSelectElement>('select')?.value).toBe('en')
    expect(doc.querySelector<HTMLSelectElement>('select')?.disabled).toBe(false)
    await selectLanguage('zh-CN')
    expect(step()).toBe('welcome')
    expect(translation.language).toBe('zh-CN')
    expect(doc.querySelector('[role="alert"]')).toBeNull()
  })

  it('reports an IPC rejection and restores the previous language', async () => {
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    invoke.mockRejectedValueOnce(new Error('IPC unavailable'))
    await mount()
    await selectLanguage('zh-CN')
    expect(step()).toBe('welcome')
    expect(doc.querySelector('[role="alert"]')).not.toBeNull()
    expect(translation.language).toBe('en')
    expect(doc.querySelector<HTMLSelectElement>('select')?.value).toBe('en')
    expect(report).toHaveBeenCalledOnce()
  })

  it('can change language during a feature without completing or restarting the tour', async () => {
    await mountDemo()
    await selectLanguage('zh-CN')
    expect(step()).toBe('collect')
    expect(doc.querySelector('h1')?.textContent).toBe('⌘K，把文章存到本地')
    expect(storage.get(TOUR_COMPLETED_KEY)).toBeUndefined()
  })

  it('shows English sources together while keeping one article as the capture example', async () => {
    await mountDemo()
    expect(
      [...doc.querySelectorAll('.ob-source-hint > span:last-child')].map(
        (item) => item.textContent,
      ),
    ).toEqual(['Anthropic', 'Substack', 'Medium'])
    expect(doc.querySelector('.ob-clip-domain')?.textContent).toBe('anthropic.com')
    expect(doc.querySelector('.ob-captured .ob-article-byline')?.textContent).toContain('Anthropic')
    expect(doc.querySelectorAll('.ob-captured')).toHaveLength(1)
  })

  it('preserves the official article, author, text, and bundled image in the saved example', async () => {
    await mountDemo()
    expect(doc.querySelector('.ob-clip-link strong')?.textContent).toBe(
      doc.querySelector('.ob-captured h2')?.textContent,
    )
    expect(doc.querySelector('.ob-captured .ob-article-excerpt')?.textContent).toBe(
      en.onboarding.demo.articleExcerpt,
    )
    expect(doc.querySelector('.ob-article-byline')?.textContent).toBe(
      en.onboarding.demo.articleByline,
    )
    expect(doc.querySelector('.ob-captured .ob-article-source')).toBeNull()
    expect(doc.querySelector('.ob-captured')?.textContent?.match(/Anthropic/g)).toHaveLength(1)
    expect(doc.querySelector('.ob-clip-url')?.textContent).toBe(COLLECT_ARTICLE_URL)
    const captured = doc.querySelector<HTMLImageElement>('.ob-captured .ob-article-figure img')!
    expect(captured.getAttribute('src')).toContain('anthropic-routing.png')
    expect(captured.getAttribute('src')).not.toMatch(/^https?:/)
    expect(captured.getAttribute('alt')).toBe(en.onboarding.demo.articleImageAlt)
    expect(captured.getAttribute('width')).toBe('2401')
    expect(captured.getAttribute('height')).toBe('1000')
    expect(doc.querySelector('.ob-capture-status')?.textContent).toBe(
      en.onboarding.features.collect.result,
    )
  })

  it('marks the left-hand sources as examples rather than a closed platform list in both languages', async () => {
    await mountDemo()
    for (const language of ['en', 'zh-CN']) {
      await act(async () => translation.changeLanguage(language))
      expect(doc.querySelector('.ob-clip-palette .ob-source-label')?.textContent).toBe(
        language === 'zh-CN'
          ? zhCN.onboarding.demo.sourceExamples
          : en.onboarding.demo.sourceExamples,
      )
      expect(doc.querySelectorAll('.ob-clip-palette .ob-source-hint')).toHaveLength(3)
      expect(doc.querySelector('.ob-clip-palette .ob-source-more')?.textContent).toBe('…')
    }
  })

  it('shows the pasted link and saved result without simulated loading steps or capture calls', async () => {
    await mountDemo()
    expect(doc.querySelector('.ob-clip-field kbd')?.textContent).toBe('⌘K')
    expect(doc.querySelector('.ob-clip-placeholder, .ob-clip-fetching, .ob-clip-ready')).toBeNull()
    expect(doc.querySelector('.ob-clip-url')?.textContent).toBe(COLLECT_ARTICLE_URL)
    expect(doc.querySelector('.ob-captured h2')?.textContent).toBe(en.onboarding.demo.articleTitle)
    expect(doc.querySelector('.ob-clip-save')?.textContent).toBe('Save to Inbox')
    expect(doc.querySelector('.ob-browser, .ob-shortcut, .ob-capture-link')).toBeNull()
    expect(doc.querySelector('.ob-art input, .ob-art button, .ob-art a')).toBeNull()
    await wait()
    expect(invoke).not.toHaveBeenCalled()
    expect(actions.onOpenWorkspace).not.toHaveBeenCalled()
  })

  it('shows an editable-document example with real math, code, a figure, a table and a checklist', async () => {
    await mountDemo()
    await click('.ob-page-dot:nth-child(3)')
    expect(step()).toBe('distill')
    for (const language of ['en', 'zh-CN']) {
      await act(async () => translation.changeLanguage(language))
      const demo = language === 'zh-CN' ? zhCN.onboarding.demo.editor : en.onboarding.demo.editor
      expect(doc.querySelector('.ob-editor-main h2')?.textContent).toBe(demo.title)
      expect(doc.querySelector('.ob-editor-lead')?.textContent).toBe(
        `${demo.lead}${demo.highlight}${demo.end}`,
      )
      expect(doc.querySelector('.ob-editor-lead mark')?.textContent).toBe(demo.highlight)
      expect(doc.querySelector('.ob-editor-equation .katex')).not.toBeNull()
      expect(doc.querySelector('.ob-editor-equation annotation')?.textContent).toContain(
        String.raw`\sigma\sqrt{2\pi}`,
      )
      expect(doc.querySelectorAll('.ob-editor-table tr')).toHaveLength(3)
      expect(doc.querySelector('.ob-editor-figure svg')?.getAttribute('aria-label')).toBe(
        demo.imageAlt,
      )
      expect(doc.querySelector('.ob-editor-code code')?.textContent).toBe(
        'from math import exp, pi, sqrt\nx = 0\nf = exp(-x**2 / 2) / sqrt(2*pi)',
      )
      expect(doc.querySelectorAll('.ob-editor-code .ob-editor-keyword')).toHaveLength(2)
      expect(doc.querySelector('.ob-editor-checklist li')?.textContent).toBe(demo.task)
      expect(doc.querySelector('.ob-reference, .ob-writing, .ob-writing-caret')).toBeNull()
      expect(
        doc.querySelector('.ob-editor-art input, .ob-editor-art button, [contenteditable]'),
      ).toBeNull()
      expect(doc.querySelector<HTMLButtonElement>('.ob-continue')?.disabled).toBe(false)
    }
    await wait()
    expect(step()).toBe('distill')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('shows the platform shortcut for non-Mac users', async () => {
    vi.stubGlobal('navigator', { platform: 'Win32' })
    await mountDemo()
    await act(async () => translation.changeLanguage('zh-CN'))
    expect(doc.querySelector('h1')?.textContent).toBe('CtrlK，把文章存到本地')
    expect(doc.querySelector('.ob-clip-field kbd')?.textContent).toBe('CtrlK')
    await click('.ob-continue')
    expect(doc.querySelector('.ob-organize-search kbd')?.textContent).toBe('CtrlK')
  })

  it('shows folder management and Smart Folder views without opening a note or touching the workspace', async () => {
    await mountDemo()
    await click('.ob-continue')
    expect(step()).toBe('organize')
    expect(doc.querySelector('.ob-organize-art article, .ob-organize-note')).toBeNull()
    expect(doc.querySelector('.ob-organize-folder strong')?.textContent).toBe(
      en.onboarding.demo.organize.technology,
    )
    expect(doc.querySelector('[data-view="today"] strong')?.textContent).toBe(
      en.onboarding.demo.organize.today,
    )
    expect(doc.querySelector('[data-view="topic"] strong')?.textContent).toBe(
      en.onboarding.demo.organize.topic,
    )
    expect(doc.querySelectorAll('.ob-organize-directory')).toHaveLength(2)
    expect(doc.querySelectorAll('.ob-organize-file')).toHaveLength(2)
    expect(doc.querySelector('.ob-organize-file span')?.textContent).toBe(
      `${en.onboarding.demo.articleTitle}.md`,
    )
    expect(doc.querySelector('[data-view="today"] .ob-organize-rule')?.textContent).toBe(
      en.onboarding.demo.organize.todayRule,
    )
    expect(doc.querySelector('[data-view="topic"] .ob-organize-rule')?.textContent).toBe(
      en.onboarding.demo.organize.topicRule,
    )
    const results = [...doc.querySelectorAll('.ob-organize-result')]
    expect(results.map((result) => result.getAttribute('data-result-path'))).toEqual([
      `${en.onboarding.demo.organize.technology}/${en.onboarding.demo.articleTitle}.md`,
      `${en.onboarding.demo.organize.life}/${en.onboarding.demo.organize.campingNote}.md`,
    ])
    expect(
      doc.querySelector('.ob-organize-art input, .ob-organize-art button, .ob-organize-art a'),
    ).toBeNull()
    await wait()
    expect(step()).toBe('organize')
    expect(invoke).not.toHaveBeenCalled()
    expect(actions.onOpenWorkspace).not.toHaveBeenCalled()
  })

  it('localizes search and clearly separates planned AI organization in each language', async () => {
    await mountDemo()
    await click('.ob-continue')
    for (const language of ['en', 'zh-CN']) {
      await act(async () => translation.changeLanguage(language))
      const demo = language === 'zh-CN' ? zhCN.onboarding.demo : en.onboarding.demo
      expect(doc.querySelector('.ob-organize-query > span')?.textContent).toBe(
        demo.organize.searchQuery,
      )
      expect(doc.querySelector('.ob-organize-search-heading')).toBeNull()
      expect(doc.querySelector('.ob-organize-query')?.lastElementChild?.tagName).toBe('KBD')
      expect(doc.querySelector('.ob-organize-query kbd')?.textContent).toBe('⌘K')
      const results = [...doc.querySelectorAll('.ob-organize-result')]
      expect(results).toHaveLength(2)
      expect(results[0].querySelector('.ob-organize-result-excerpt mark')?.textContent).toBe(
        demo.organize.searchQuery,
      )
      expect(results[1].querySelector('.ob-organize-result-title mark')?.textContent).toBe(
        demo.organize.searchQuery,
      )
      expect(results[0].querySelector('.ob-organize-result-title mark')).toBeNull()
      expect(results[1].querySelector('.ob-organize-result-excerpt mark')).toBeNull()
      expect(results[1].querySelector('.ob-organize-result-excerpt')?.textContent).toBe(
        demo.organize.campingExcerpt,
      )
      expect(doc.querySelector('.ob-organize-root strong')?.textContent).toBe(
        demo.organize.workspace,
      )
      const upcoming = doc.querySelector('.ob-organize-upcoming')
      const copy = language === 'zh-CN' ? zhCN.onboarding : en.onboarding
      expect(upcoming?.textContent).toBe(copy.features.organize.upcoming)
      expect(doc.querySelector('.ob-description')?.nextElementSibling).toBe(upcoming)
      expect(doc.querySelector('.ob-art .ob-organize-upcoming')).toBeNull()
      expect(upcoming?.getAttribute('data-availability')).toBe('planned')
      expect(upcoming?.childElementCount).toBe(0)
    }
  })

  it('shows all organization capabilities immediately without a replay action or motion dependency', async () => {
    await mountDemo()
    await click('.ob-continue')
    const capabilities = () =>
      [...doc.querySelectorAll('.ob-feature [data-capability]')]
        .map((item) => item.getAttribute('data-capability'))
        .sort()
    expect(capabilities()).toEqual(['ai', 'folders', 'search', 'smart'])
    expect(doc.querySelector('.ob-replay-scene')).toBeNull()
    expect(playing()).toBe('false')
    await act(async () => {
      reducedMotion = true
      notifyMotionChange()
    })
    expect(playing()).toBe('false')
    expect(capabilities()).toEqual(['ai', 'folders', 'search', 'smart'])
    expect(doc.querySelector('.ob-organize-tree')).not.toBeNull()
    await wait()
    expect(step()).toBe('organize')
  })

  it('keeps outcomes inside the demo artwork without floating pills or category badges', async () => {
    await mountDemo()
    expect(doc.querySelector('.ob-captured .ob-capture-status')).not.toBeNull()
    expect(doc.querySelector('.ob-clip-palette .ob-capture-status')).toBeNull()
    for (const feature of ['collect', 'organize', 'distill', 'express']) {
      expect(step()).toBe(feature)
      expect(doc.querySelector('.ob-demo-result, .ob-feature-label')).toBeNull()
      expect(doc.querySelector('.ob-organize-upcoming') !== null).toBe(feature === 'organize')
      if (feature === 'distill') expect(doc.querySelector('.ob-editor-save')).not.toBeNull()
      if (feature === 'express') {
        expect(doc.querySelector('.ob-chat-preview small')?.textContent).toBe(
          en.onboarding.features.express.result,
        )
      }
      await click('.ob-continue')
    }
  })

  it('pauses the artwork while hidden without remounting it or advancing', async () => {
    await mountDemo()
    const artwork = doc.querySelector('.ob-art')
    await act(async () => {
      hidden = true
      doc.dispatchEvent(new window.Event('visibilitychange'))
    })
    expect(playing()).toBe('false')
    await wait()
    expect(step()).toBe('collect')
    await act(async () => {
      hidden = false
      doc.dispatchEvent(new window.Event('visibilitychange'))
    })
    expect(playing()).toBe('true')
    expect(doc.querySelector('.ob-art')).toBe(artwork)
  })

  it('keeps the static outcome and manual navigation available with reduced motion', async () => {
    reducedMotion = true
    await mountDemo()
    expect(step()).toBe('collect')
    expect(playing()).toBe('false')
    expect(doc.querySelector('.ob-captured .ob-capture-status')).not.toBeNull()
    expect(doc.querySelector('.ob-replay-scene')).toBeNull()
    await wait()
    expect(step()).toBe('collect')
    await click('.ob-continue')
    expect(step()).toBe('organize')
  })

  it('responds to reduced-motion changes without changing pages', async () => {
    await mountDemo()
    await act(async () => {
      reducedMotion = true
      notifyMotionChange()
    })
    expect(playing()).toBe('false')
    expect(doc.querySelector('.ob-replay-scene')).toBeNull()
    await wait()
    await act(async () => {
      reducedMotion = false
      notifyMotionChange()
    })
    expect(playing()).toBe('true')
    expect(step()).toBe('collect')
  })

  it('goes directly to entry after completion and replays from the welcome page', async () => {
    storage.set(TOUR_COMPLETED_KEY, '1')
    await mount()
    expect(step()).toBe('start')
    await click('.ob-replay')
    expect(step()).toBe('welcome')
    expect(doc.querySelector('.ob-collect-art')).toBeNull()
    await wait()
    expect(step()).toBe('welcome')
    await click('.ob-continue')
    expect(step()).toBe('collect')
  })

  it('uses a transparent SVG brand mark without a raster image or background rectangle', async () => {
    await mount()
    const logo = doc.querySelector('svg.ob-mascot')!
    expect(logo).not.toBeNull()
    expect(logo.querySelectorAll('path')).toHaveLength(4)
    expect(logo.querySelector('rect, image')).toBeNull()
    expect(logo.querySelector('path[fill="#EEF1F4"]')).not.toBeNull()
    expect(doc.querySelector('.ob-welcome img')).toBeNull()
  })

  it('offers no Skip action or hidden Escape shortcut during the introduction', async () => {
    await mount()
    await press('Escape')
    expect(step()).toBe('welcome')
    for (const screen of ['welcome', 'collect', 'organize', 'distill', 'express']) {
      expect(step()).toBe(screen)
      expect(doc.querySelector('.ob-skip')).toBeNull()
      await press('Escape')
      expect(step()).toBe(screen)
      expect(storage.get(TOUR_COMPLETED_KEY)).toBeUndefined()
      await click('.ob-continue')
    }
    expect(step()).toBe('start')
    expect(storage.get(TOUR_COMPLETED_KEY)).toBe('1')
  })

  it('supports keyboard navigation including the welcome page and ignores composing or modified keys', async () => {
    await mount()
    await press('ArrowLeft')
    expect(step()).toBe('welcome')
    await act(async () => {
      doc
        .querySelector('select')!
        .dispatchEvent(
          Object.assign(new window.Event('keydown', { bubbles: true }), { key: 'ArrowRight' }),
        )
    })
    expect(step()).toBe('welcome')
    await press('ArrowRight')
    expect(step()).toBe('collect')
    await press('ArrowRight')
    expect(step()).toBe('organize')
    await press('ArrowLeft')
    expect(step()).toBe('collect')
    await press('ArrowRight', { isComposing: true })
    await press('ArrowRight', { metaKey: true })
    expect(step()).toBe('collect')
    await press('ArrowLeft')
    expect(step()).toBe('welcome')
  })

  it('can choose a feature directly without completing the introduction', async () => {
    await mountDemo()
    await click('.ob-page-dot:nth-child(4)')
    expect(step()).toBe('express')
    expect(storage.get(TOUR_COMPLETED_KEY)).toBeUndefined()
    await wait()
    expect(step()).toBe('express')
  })

  it('keeps folder choice primary and exposes create and file actions as localized text links', async () => {
    storage.set(TOUR_COMPLETED_KEY, '1')
    await mount()
    for (const language of ['en', 'zh-CN']) {
      await act(async () => translation.changeLanguage(language))
      const copy = language === 'zh-CN' ? zhCN.onboarding : en.onboarding
      expect(doc.querySelectorAll('.ob-choose-folder')).toHaveLength(1)
      expect(doc.querySelectorAll('.ob-entry-screen button')).toHaveLength(3)
      expect(doc.querySelectorAll('.ob-secondary-actions .ob-entry-link')).toHaveLength(2)
      expect(doc.querySelector('.ob-create-folder')?.textContent).toBe(copy.newFolder)
      expect(doc.querySelector('.ob-open-file')?.textContent).toBe(copy.openFile)
      expect(doc.querySelector('.ob-entry, .ob-entry-list')).toBeNull()
      expect(doc.querySelector('.ob-choose-folder')?.textContent).toBe(copy.chooseFolder)
      expect(doc.querySelector('.ob-top .ob-tour-brand')?.textContent).toBe('Melo')
      expect(doc.querySelector('.ob-top .ob-replay')?.textContent).toBe(copy.replay)
      expect(doc.querySelector('.ob-entry-screen .ob-replay, .ob-folder-hint')).toBeNull()
      expect(doc.querySelector('.ob-entry-folder')?.getAttribute('aria-hidden')).toBe('true')
      expect(doc.querySelector('.ob-choose-folder')?.hasAttribute('aria-describedby')).toBe(false)
    }
    expect(actions.onOpenWorkspace).not.toHaveBeenCalled()
    expect(actions.onCreateWorkspace).not.toHaveBeenCalled()
    expect(actions.onOpenFile).not.toHaveBeenCalled()
  })

  it.each([
    ['folder', '.ob-choose-folder', 'onOpenWorkspace'],
    ['create', '.ob-create-folder', 'onCreateWorkspace'],
    ['file', '.ob-open-file', 'onOpenFile'],
  ] as const)(
    'disables all entry actions during the %s picker and recovers on cancellation',
    async (_action, selector, callback) => {
      storage.set(TOUR_COMPLETED_KEY, '1')
      let finish!: () => void
      actions[callback].mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve
          }),
      )
      await mount()
      const originalLabel = doc.querySelector(selector)?.textContent
      await click(selector)
      expect(actions[callback]).toHaveBeenCalledOnce()
      expect(doc.querySelector(selector)?.getAttribute('aria-busy')).toBe('true')
      expect(doc.querySelector<HTMLButtonElement>('.ob-top .ob-replay')?.disabled).toBe(true)
      expect(doc.querySelector<HTMLSelectElement>('.ob-language-picker select')?.disabled).toBe(
        true,
      )
      expect(
        [...doc.querySelectorAll<HTMLButtonElement>('.ob-entry-screen button')].every(
          (button) => button.disabled,
        ),
      ).toBe(true)
      await act(async () => finish())
      expect(doc.querySelector<HTMLButtonElement>('.ob-top .ob-replay')?.disabled).toBe(false)
      expect(doc.querySelector<HTMLSelectElement>('.ob-language-picker select')?.disabled).toBe(
        false,
      )
      expect(
        [...doc.querySelectorAll<HTMLButtonElement>('.ob-entry-screen button')].every(
          (button) => !button.disabled,
        ),
      ).toBe(true)
      expect(doc.querySelector(selector)?.textContent).toBe(originalLabel)
      expect(doc.querySelector(selector)?.getAttribute('aria-busy')).toBe('false')
      await click(selector)
      expect(actions[callback]).toHaveBeenCalledTimes(2)
      expect(step()).toBe('start')
    },
  )
})
