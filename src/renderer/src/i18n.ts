import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { IpcChannels } from '@shared/types/ipc'
import { en } from '@shared/locales/en'
import { zhCN } from '@shared/locales/zh-CN'

/* ============================================================
   i18n bootstrap. Starts synchronously on the system locale
   (navigator.language mirrors it in Electron) so first paint is
   already in the right language for the default "system" setting;
   the persisted preference is reconciled right after via IPC.
   Untranslated keys fall back to English.
   ============================================================ */

export const resolveSystemLanguage = (): 'en' | 'zh-CN' =>
  navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    'zh-CN': { translation: zhCN },
  },
  lng: resolveSystemLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

/** Align with the persisted preference (called once at app boot), and
 *  follow live switches initiated from the main process (menu / future
 *  Settings). */
export async function syncLanguageFromPreference(): Promise<void> {
  window.api.on(IpcChannels.OnLanguageChanged, ({ resolved }) => {
    void i18n.changeLanguage(resolved)
  })
  try {
    const res = await window.api.invoke(IpcChannels.InvokeGetLanguage, undefined)
    if (res.success && res.data && res.data.resolved !== i18n.language) {
      await i18n.changeLanguage(res.data.resolved)
    }
  } catch {
    /* preference unavailable — system language already active */
  }
}

export default i18n

// Keep the document language in sync — screen readers rely on it, and
// CSS uses it to disable italics for CJK (synthetic obliques smear hanzi).
// Guarded: this module is also imported by node-side unit tests.
if (typeof document !== 'undefined') {
  i18n.on('languageChanged', (lng) => {
    document.documentElement.lang = lng
  })
  document.documentElement.lang = i18n.language
}
