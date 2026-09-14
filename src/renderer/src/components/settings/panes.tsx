import { useEffect, useMemo, useState } from 'react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { IpcChannels, type LanguagePreference } from '@shared/types/ipc'
import type { AppSettings } from '@shared/types/settings'
import { settingsAtom, setSetting } from '../../store/settings'
import { MeloLogo } from '../MeloLogo'
import { Icon } from '../Icon'
import { SettingsIcon } from './SettingsIcon'
import { Row, Section, Segmented, Select, Toggle } from './controls'
import { loadTree } from '../../lib/workspace'

/* ============================================================
   Settings panes — every control here is live; nothing is a
   mock. Identity values (AppSettings unions) are translated
   only at render.
   ============================================================ */

const useSet = (): [AppSettings, typeof setSetting] => [useAtomValue(settingsAtom), setSetting]

// ---------- General ----------
export function GeneralPane() {
  const { t } = useTranslation()
  const [s] = useSet()
  const [language, setLanguage] = useState<LanguagePreference>('system')
  useEffect(() => {
    window.api.invoke(IpcChannels.InvokeGetLanguage, undefined).then((res) => {
      if (res.success && res.data) setLanguage(res.data.language)
    })
  }, [])
  const pickLanguage = (value: LanguagePreference) => {
    setLanguage(value)
    void window.api.invoke(IpcChannels.InvokeSetLanguage, { language: value })
  }
  return (
    <div className="pane">
      <Section title={t('prefs.secNewNotes')}>
        <Row
          label={t('prefs.newNoteLocation')}
          desc={t('prefs.newNoteLocationDesc')}
          control={
            <Select
              value={s.newNoteLocation}
              onChange={(v) => setSetting('newNoteLocation', v)}
              options={[
                { value: 'current', label: t('prefs.locFollow') },
                { value: 'inbox', label: t('prefs.locInbox') },
              ]}
            />
          }
        />
      </Section>

      <Section title={t('prefs.secLanguage')}>
        <Row
          label={t('prefs.appLanguage')}
          control={
            <Select
              value={language}
              onChange={pickLanguage}
              options={[
                { value: 'system', label: t('prefs.langSystem') },
                { value: 'en', label: 'English' },
                { value: 'zh-CN', label: '简体中文' },
              ]}
            />
          }
        />
      </Section>

      <Section title={t('prefs.secUpdates')}>
        <Row
          label={t('prefs.autoUpdate')}
          desc={t('prefs.autoUpdateDesc')}
          control={<Toggle on={s.autoUpdate} onChange={(v) => setSetting('autoUpdate', v)} />}
        />
      </Section>
    </div>
  )
}

// ---------- Appearance ----------
function ThemePreview({ kind }: { kind: 'light' | 'dark' | 'system' }) {
  if (kind === 'system') {
    return (
      <div className="theme-prev split">
        <div className="tp-half" data-half="light" />
        <div className="tp-half" data-half="dark" />
      </div>
    )
  }
  return (
    <div className="theme-prev" data-kind={kind}>
      <div className="tp-side" />
      <div className="tp-main">
        <div className="tp-line" style={{ width: '62%' }} data-strong />
        <div className="tp-line" style={{ width: '90%' }} />
        <div className="tp-line" style={{ width: '74%' }} />
      </div>
    </div>
  )
}

export function AppearancePane() {
  const { t } = useTranslation()
  const [s] = useSet()
  const themes: { value: AppSettings['theme']; label: string }[] = [
    { value: 'light', label: t('prefs.themeLight') },
    { value: 'dark', label: t('prefs.themeDark') },
    { value: 'system', label: t('prefs.themeSystem') },
  ]
  return (
    <div className="pane">
      <div className="s-section">
        <div className="s-section-title">{t('prefs.secTheme')}</div>
        <div className="theme-cards">
          {themes.map((th) => (
            <button
              key={th.value}
              className={s.theme === th.value ? 'theme-card active' : 'theme-card'}
              onClick={() => setSetting('theme', th.value)}
            >
              <ThemePreview kind={th.value} />
              <div className="theme-foot">
                {th.label}
                <span className="dot-ck">
                  <Icon name="tick" size={10} />
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>

      <Section title={t('prefs.secLayout')}>
        <Row
          label={t('prefs.editorWidth')}
          control={
            <Segmented
              value={s.editorWidth}
              onChange={(v) => setSetting('editorWidth', v)}
              options={[
                { value: 'narrow', label: t('prefs.widthNarrow') },
                { value: 'default', label: t('prefs.widthDefault') },
                { value: 'wide', label: t('prefs.widthWide') },
                { value: 'full', label: t('prefs.widthFull') },
              ]}
            />
          }
        />
        <Row
          label={t('prefs.outlineByDefault')}
          desc={t('prefs.outlineByDefaultDesc')}
          control={
            <Toggle on={s.outlineByDefault} onChange={(v) => setSetting('outlineByDefault', v)} />
          }
        />
      </Section>
    </div>
  )
}

// ---------- Editor ----------

/** Live sample rendered with the actual settings: heading and body share
 *  the chosen reading face (deliberately mixed-script — CJK and Latin
 *  metrics differ), and code uses the chosen indentation unit. */
function EditorPreview({ s }: { s: AppSettings }) {
  const { t } = useTranslation()
  const unit = s.codeIndent === 'tab' ? '\t' : ' '.repeat(Number(s.codeIndent))
  const code = `function melo(thought) {\n${unit}const note = capture(thought) // 本地优先\n${unit}return note.saveToDisk()\n}`
  return (
    <div className="ed-sample" data-font={s.editorFont}>
      <div className="ed-sample-heading">{t('prefs.previewHeading')}</div>
      <p className="ed-sample-body">{t('prefs.previewBody')}</p>
      <pre className="ed-sample-code">{code}</pre>
    </div>
  )
}

export function EditorPane() {
  const { t } = useTranslation()
  const [s] = useSet()
  return (
    <div className="pane">
      <Section title={t('prefs.secTypography')}>
        <Row
          label={t('prefs.editorFont')}
          desc={t('prefs.editorFontDesc')}
          control={
            <Segmented
              value={s.editorFont}
              onChange={(v) => setSetting('editorFont', v)}
              options={[
                { value: 'sans', label: t('prefs.fontSans') },
                { value: 'serif', label: t('prefs.fontSerif') },
              ]}
            />
          }
        />
        <Row
          label={t('prefs.codeIndent')}
          desc={t('prefs.codeIndentDesc')}
          control={
            <Segmented
              value={s.codeIndent}
              onChange={(v) => setSetting('codeIndent', v)}
              options={[
                { value: 'tab', label: t('prefs.indentTab') },
                { value: '2', label: t('prefs.indentTwo') },
                { value: '4', label: t('prefs.indentFour') },
              ]}
            />
          }
        />
      </Section>

      <Section title={t('prefs.previewLabel')}>
        <div className="s-row block">
          <EditorPreview s={s} />
        </div>
      </Section>
    </div>
  )
}

// ---------- Capture ----------

/** Folders of the current workspace (depth ≤ 2, path-labelled) — same
 *  shape the clip panel's folder menu shows. */
function useWorkspaceFolders(): { root: string | null; folders: { id: string; label: string }[] } {
  const [root, setRoot] = useState<string | null>(null)
  const [folders, setFolders] = useState<{ id: string; label: string }[]>([])
  useEffect(() => {
    let alive = true
    // Reloads overlap (mount + workspace-change bursts) — only the newest
    // may write, and each starts from a clean slate so a failed load
    // can't leave the previous workspace's folders on screen.
    let generation = 0
    const load = async () => {
      const gen = ++generation
      const dir = await window.api.invoke(IpcChannels.InvokeGetLastDirectory, undefined)
      const root = dir.success ? (dir.data?.directoryPath ?? null) : null
      if (!alive || gen !== generation) return
      setRoot(root)
      setFolders([])
      if (!root) return
      const tree = await loadTree(root).catch(() => null)
      if (!alive || gen !== generation || !tree) return
      const list: { id: string; label: string }[] = []
      const walk = (nodes: typeof tree, depth: number, prefix: string) =>
        nodes.forEach((n) => {
          if (n.kind === 'folder') {
            const label = prefix ? `${prefix} / ${n.name}` : n.name
            list.push({ id: n.id, label })
            if (depth < 2) walk(n.children ?? [], depth + 1, label)
          }
        })
      walk(tree, 0, '')
      setFolders(list)
    }
    void load()
    // Switching workspaces (or creating folders) in the main window must
    // refresh this list — a stale one offers folders from the old tree.
    const off = window.api.on(IpcChannels.OnWorkspaceChanged, () => void load())
    return () => {
      alive = false
      off()
    }
  }, [])
  return { root, folders }
}

export function CapturePane() {
  const { t } = useTranslation()
  const [s] = useSet()
  const { root, folders } = useWorkspaceFolders()
  const customDest = root ? s.clipCustomDest[root] : undefined
  return (
    <div className="pane">
      <Section title={t('prefs.secClipping')}>
        <Row
          label={t('prefs.clipLocation')}
          desc={t('prefs.clipLocationDesc')}
          control={
            <Select
              value={s.clipLocation}
              onChange={(v) => setSetting('clipLocation', v)}
              options={[
                { value: 'inbox', label: t('prefs.clipInbox') },
                { value: 'remember', label: t('prefs.clipRemember') },
                { value: 'custom', label: t('prefs.clipCustom') },
              ]}
            />
          }
        />
        {s.clipLocation === 'custom' && root && folders.length > 0 && (
          <Row
            label={t('prefs.clipPickFolder')}
            control={
              <Select
                value={
                  customDest && folders.some((f) => f.id === customDest)
                    ? customDest
                    : // Same fallback the clip panel uses at capture time —
                      // the sorted list puts Inbox first.
                      folders[0].id
                }
                onChange={(v) => setSetting('clipCustomDest', { ...s.clipCustomDest, [root]: v })}
                options={folders.map((f) => ({ value: f.id, label: f.label }))}
              />
            }
          />
        )}
        <Row
          label={t('prefs.clipDownloadImages')}
          desc={t('prefs.clipDownloadImagesDesc')}
          control={
            <Toggle
              on={s.clipDownloadImages}
              onChange={(v) => setSetting('clipDownloadImages', v)}
            />
          }
        />
      </Section>
    </div>
  )
}

// ---------- Shortcuts (read-only) ----------
interface ShortcutGroup {
  name: string
  items: { label: string; keys: string[] }[]
}

export function ShortcutsPane() {
  const { t } = useTranslation()
  const [q, setQ] = useState('')
  const groups: ShortcutGroup[] = useMemo(
    () => [
      {
        name: t('prefs.scGeneral'),
        items: [
          { label: t('prefs.scSearch'), keys: ['⌘', 'K'] },
          { label: t('prefs.scNewNote'), keys: ['⌘', 'N'] },
          { label: t('prefs.scSave'), keys: ['⌘', 'S'] },
          { label: t('prefs.scCloseTab'), keys: ['⌘', 'W'] },
          { label: t('prefs.scToggleSidebar'), keys: ['⌘', '\\'] },
          { label: t('prefs.scSettings'), keys: ['⌘', ','] },
        ],
      },
      {
        name: t('prefs.scEditor'),
        items: [
          { label: t('prefs.scSlash'), keys: ['/'] },
          { label: t('prefs.scBold'), keys: ['⌘', 'B'] },
          { label: t('prefs.scItalic'), keys: ['⌘', 'I'] },
          { label: t('prefs.scUnderline'), keys: ['⌘', 'U'] },
          { label: t('prefs.scLink'), keys: ['⌘', 'K'] },
          { label: t('prefs.scFind'), keys: ['⌘', 'F'] },
          { label: t('prefs.scReplace'), keys: ['⌥', '⌘', 'F'] },
          { label: t('prefs.scFindNext'), keys: ['⌘', 'G'] },
        ],
      },
    ],
    [t],
  )
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return groups
    return groups
      .map((g) => ({ ...g, items: g.items.filter((i) => i.label.toLowerCase().includes(needle)) }))
      .filter((g) => g.items.length > 0)
  }, [groups, q])
  return (
    <div className="pane">
      <div className="kbd-filter">
        <Icon name="search" size={14} />
        <input
          placeholder={t('prefs.filterShortcuts')}
          value={q}
          spellCheck={false}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {filtered.map((g) => (
        <Section key={g.name} title={g.name}>
          {g.items.map((it) => (
            <div className="kbd-row" key={it.label}>
              <span className="k-label">{it.label}</span>
              <span className="kbd-combo">
                {it.keys.map((k, i) => (
                  <kbd key={i}>{k}</kbd>
                ))}
              </span>
            </div>
          ))}
        </Section>
      ))}
      {filtered.length === 0 && (
        <div className="kbd-empty">{t('prefs.noShortcutsMatch', { q })}</div>
      )}
    </div>
  )
}

// ---------- About ----------
export function AboutPane() {
  const { t } = useTranslation()
  const [s] = useSet()
  const [version, setVersion] = useState('')
  useEffect(() => {
    window.api.invoke(IpcChannels.InvokeGetAppVersion, undefined).then((res) => {
      if (res.success && res.data) setVersion(res.data.version)
    })
  }, [])
  const links = [
    {
      icon: 'ext',
      label: t('prefs.reportIssue'),
      url: 'https://github.com/melo-libs/melo/issues',
    },
    { icon: 'about', label: t('prefs.learnMore'), url: 'https://www.melolib.com' },
  ]
  return (
    <div className="pane pane-about">
      <div className="about-hero">
        <div className="about-logo">
          <MeloLogo size={50} />
        </div>
        <div className="about-name">Melo</div>
        {version && <div className="about-ver">{t('prefs.version', { version })}</div>}
        <div className="about-copy">
          <div className="about-tagline">{t('prefs.aboutTagline')}</div>
          <div className="about-description">{t('prefs.aboutDescription')}</div>
        </div>
      </div>

      <div className="s-section">
        <div className="s-card">
          <div className="s-row update-card">
            <div className="update-status">
              <div className="us-main">
                <span className="up-dot" data-on={s.autoUpdate} />
                {t('prefs.upToDate', {
                  state: s.autoUpdate ? t('prefs.stateOn') : t('prefs.stateOff'),
                })}
              </div>
            </div>
            <button
              className="s-btn"
              onClick={() => void window.api.invoke(IpcChannels.InvokeCheckForUpdates, undefined)}
            >
              <SettingsIcon name="refresh" size={14} />
              {t('prefs.checkNow')}
            </button>
          </div>
        </div>
      </div>

      <div className="s-section">
        <div className="s-card">
          {links.map((l) => (
            <a className="link-row" key={l.label} href={l.url} target="_blank" rel="noreferrer">
              <span className="lr-text">
                <span className="lr-ico">
                  <SettingsIcon name={l.icon} size={16} />
                </span>
                <span className="lr-label">{l.label}</span>
              </span>
              <span className="lr-arrow">
                <SettingsIcon name="ext" size={14} />
              </span>
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}
