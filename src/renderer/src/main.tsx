import '@fontsource-variable/source-serif-4/index.css'
import '@fontsource-variable/source-sans-3/index.css'
import '@fontsource-variable/inter/index.css'
import '@fontsource-variable/jetbrains-mono/index.css'
import 'katex/dist/katex.min.css'
import { syncLanguageFromPreference } from './i18n'
import './styles/index.scss'
import ReactDOM from 'react-dom/client'
import App from './App'
import { Provider } from 'jotai'
import { appStore } from './store/appStore'
import { resolveTheme, settingsAtom, syncSettings } from './store/settings'
import { SettingsRoot } from './components/settings/SettingsRoot'
import { UpdatesRoot } from './components/updates/UpdatesRoot'

const isSettingsWindow = window.location.hash === '#settings'
const isUpdateWindow = window.location.hash === '#updates'

// Settings must be present at first paint (theme, outline default) — one
// IPC roundtrip before render beats a light-to-dark flash after it.
void Promise.all([syncLanguageFromPreference(), syncSettings()]).then(() => {
  // Apply the theme before React mounts — effects run after first paint,
  // which reads as a light flash for dark-mode users.
  document.documentElement.setAttribute(
    'data-theme',
    resolveTheme(appStore.get(settingsAtom).theme),
  )
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <Provider store={appStore}>
      {isSettingsWindow ? <SettingsRoot /> : isUpdateWindow ? <UpdatesRoot /> : <App />}
    </Provider>,
  )
})
