import { useEffect, useState } from 'react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { settingsAtom } from '../../store/settings'
import { MeloLogo } from '../MeloLogo'
import { SettingsIcon } from './SettingsIcon'
import {
  AboutPane,
  AppearancePane,
  CapturePane,
  EditorPane,
  GeneralPane,
  ShortcutsPane,
} from './panes'
import './settings.scss'

/* ============================================================
   SettingsRoot — the standalone settings window (macOS prefs
   layout): category rail on the left, one pane at a time on
   the right. Ported from the design's settings/App.jsx; only
   the categories that actually exist in the product are here.
   ============================================================ */

interface Category {
  id: string
  labelKey: string
  subKey: string
  icon: string
  Pane: () => React.JSX.Element
}

const GROUPS: { groupKey: string; items: Category[] }[] = [
  {
    groupKey: 'prefs.groupApp',
    items: [
      {
        id: 'general',
        labelKey: 'prefs.general',
        subKey: 'prefs.generalSub',
        icon: 'general',
        Pane: GeneralPane,
      },
      {
        id: 'appearance',
        labelKey: 'prefs.appearance',
        subKey: 'prefs.appearanceSub',
        icon: 'appearance',
        Pane: AppearancePane,
      },
      {
        id: 'editor',
        labelKey: 'prefs.editor',
        subKey: 'prefs.editorSub',
        icon: 'editor',
        Pane: EditorPane,
      },
    ],
  },
  {
    groupKey: 'prefs.groupWorkspace',
    items: [
      {
        id: 'capture',
        labelKey: 'prefs.capture',
        subKey: 'prefs.captureSub',
        icon: 'capture',
        Pane: CapturePane,
      },
    ],
  },
  {
    groupKey: 'prefs.groupYou',
    items: [
      {
        id: 'shortcuts',
        labelKey: 'prefs.shortcuts',
        subKey: 'prefs.shortcutsSub',
        icon: 'shortcuts',
        Pane: ShortcutsPane,
      },
      {
        id: 'about',
        labelKey: 'prefs.about',
        subKey: 'prefs.aboutSub',
        icon: 'about',
        Pane: AboutPane,
      },
    ],
  },
]
const ALL = GROUPS.flatMap((g) => g.items)

const NAV_KEY = 'melo.settings.nav'

export const SettingsRoot = () => {
  const { t } = useTranslation()
  const settings = useAtomValue(settingsAtom)
  const [active, setActive] = useState(() => localStorage.getItem(NAV_KEY) ?? 'general')
  useEffect(() => localStorage.setItem(NAV_KEY, active), [active])

  // This window paints its own theme — it has no App shell above it.
  const [sysDark, setSysDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const fn = (e: MediaQueryListEvent) => setSysDark(e.matches)
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [])
  useEffect(() => {
    const resolved = settings.theme === 'system' ? (sysDark ? 'dark' : 'light') : settings.theme
    document.documentElement.setAttribute('data-theme', resolved)
  }, [settings.theme, sysDark])
  const cat = ALL.find((c) => c.id === active) ?? ALL[0]
  const Pane = cat.Pane

  return (
    <div className="prefs">
      <nav className="rail">
        <div className="rail-top" />
        <div className="rail-list">
          {GROUPS.map((g) => (
            <div key={g.groupKey}>
              <div className="rail-group-label">{t(g.groupKey)}</div>
              {g.items.map((it) => (
                <button
                  key={it.id}
                  className={active === it.id ? 'rail-item active' : 'rail-item'}
                  onClick={() => setActive(it.id)}
                >
                  <span className="rail-ico">
                    <SettingsIcon name={it.icon} size={16} />
                  </span>
                  <span className="rail-label">{t(it.labelKey)}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className="rail-foot">
          <span className="melo-mark">
            <MeloLogo size={18} />
          </span>
          <b>Melo</b>
        </div>
      </nav>

      <main className="content">
        <header className="pane-head">
          <div>
            <h1>{t(cat.labelKey)}</h1>
            <p>{t(cat.subKey)}</p>
          </div>
        </header>
        <div className="pane-body" key={cat.id}>
          <Pane />
        </div>
      </main>
    </div>
  )
}
