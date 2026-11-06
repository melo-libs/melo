import { useEffect, useState } from 'react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { IpcChannels } from '@shared/types/ipc'
import { useUpdateState } from '../../hooks/useUpdateState'
import { cn } from '../../lib/cn'
import { resolveTheme, setSetting, settingsAtom } from '../../store/settings'
import { MeloLogo } from '../MeloLogo'
import { Button } from '../ui/Button'
import { ReleaseNotes } from './ReleaseNotes'
import './updates.scss'

export function UpdatesRoot() {
  const { t, i18n } = useTranslation()
  const state = useUpdateState()
  const settings = useAtomValue(settingsAtom)
  const [currentVersion, setCurrentVersion] = useState('')
  const [actionError, setActionError] = useState<{
    kind: 'check' | 'download' | 'install' | 'ignore'
    revision: number
  } | null>(null)
  const [ignoring, setIgnoring] = useState(false)
  const release = state.release ?? state.ready?.release
  const ready = state.ready?.release.version === release?.version ? state.ready : null
  const progress = state.download.status === 'downloading' ? state.download : null
  const downloading = progress !== null
  const opening = state.installation === 'opening'
  const checkBusy = state.check === 'checking' || (state.check === 'idle' && state.revision === 0)
  // Main owns operation results; an IPC fallback must not outlive a newer state or recovery.
  const failure =
    (actionError?.revision === state.revision ? actionError.kind : null) ??
    (state.installation === 'error'
      ? 'install'
      : state.check === 'error'
        ? 'check'
        : state.download.status === 'error'
          ? 'download'
          : null)
  const checkFailed = !release && failure === 'check'
  const installFailed = !release && failure === 'install'
  const canRetryCheck =
    !release &&
    !checkBusy &&
    state.check !== 'disabled' &&
    (failure !== null || state.check !== 'up-to-date')
  const upToDate = !release && state.check === 'up-to-date' && !failure
  const disabled = !release && state.check === 'disabled'

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () =>
      document.documentElement.setAttribute('data-theme', resolveTheme(settings.theme))
    apply()
    query.addEventListener('change', apply)
    return () => query.removeEventListener('change', apply)
  }, [settings.theme])
  useEffect(() => {
    void window.api.invoke(IpcChannels.InvokeGetAppVersion, undefined).then((result) => {
      if (result.success && result.data) setCurrentVersion(result.data.version)
    })
  }, [])

  const check = async () => {
    const revision = state.revision
    setActionError(null)
    try {
      const result = await window.api.invoke(IpcChannels.InvokeCheckForUpdates, undefined)
      if (!result.success) setActionError({ kind: 'check', revision })
    } catch {
      setActionError({ kind: 'check', revision })
    }
  }
  const download = async () => {
    const revision = state.revision
    setActionError(null)
    try {
      const result = await window.api.invoke(IpcChannels.InvokeDownloadUpdate, undefined)
      if (!result.success) setActionError({ kind: 'download', revision })
    } catch {
      setActionError({ kind: 'download', revision })
    }
  }
  const install = async (version: string, reveal = false) => {
    const revision = state.revision
    setActionError(null)
    try {
      const result = await window.api.invoke(
        reveal ? IpcChannels.InvokeShowUpdateInstaller : IpcChannels.InvokeOpenUpdateInstaller,
        { version },
      )
      if (!result.success) setActionError({ kind: 'install', revision })
    } catch {
      setActionError({ kind: 'install', revision })
    }
  }
  const close = () => void window.api.invoke(IpcChannels.InvokeCloseUpdateWindow, undefined)
  const ignore = async (version: string) => {
    const revision = state.revision
    setActionError(null)
    setIgnoring(true)
    try {
      const result = await window.api.invoke(IpcChannels.InvokeIgnoreUpdate, { version })
      if (!result.success) {
        setActionError({ kind: 'ignore', revision })
        return
      }
      close()
    } catch {
      setActionError({ kind: 'ignore', revision })
    } finally {
      setIgnoring(false)
    }
  }
  const date = release?.date
    ? new Intl.DateTimeFormat(i18n.language, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }).format(new Date(release.date))
    : null
  const error = failure ? t(`updates.${failure}Failed`) : null
  const status = ready
    ? t(
        state.installation === 'opened'
          ? 'updates.installerOpened'
          : ready.install === 'manual'
            ? 'updates.downloaded'
            : 'updates.readyToRestart',
        { version: ready.release.version },
      )
    : null
  const resultTitle = checkBusy
    ? 'Melo'
    : installFailed
      ? t('updates.installFailedTitle')
      : checkFailed
        ? t('updates.checkFailedTitle')
        : upToDate
          ? t('updates.upToDate')
          : 'Melo'
  const resultDetail = checkBusy
    ? t('updates.checking')
    : installFailed
      ? t('updates.invalidInstaller')
      : checkFailed
        ? t('updates.checkFailedDetail')
        : (error ?? (disabled ? t('updates.disabled') : upToDate ? t('updates.justChecked') : null))
  const notesUrl = (version: string) =>
    `https://github.com/melo-libs/melo/releases/tag/v${encodeURIComponent(version)}`
  const openNotes = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    void window.api.invoke(IpcChannels.InvokeOpenExternal, { url: event.currentTarget.href })
  }
  const downloadAmount =
    progress && progress.total && progress.transferred !== undefined
      ? `${Math.floor(progress.transferred / 1048576)} / ${Math.ceil(progress.total / 1048576)} MB`
      : progress
        ? `${progress.percent}%`
        : ''

  return (
    <div className={cn('updates-window', !release && 'updates-window-compact')}>
      <div className="updates-titlebar" aria-hidden="true" />
      <header className="updates-heading">
        <MeloLogo size={48} />
        <div className="updates-heading-text">
          <h1 role={!release ? (failure && !checkBusy ? 'alert' : 'status') : undefined}>
            {release ? t('updates.available') : resultTitle}
          </h1>
          <p>
            {release && (
              <span className="updates-release-meta">
                {currentVersion && (
                  <>
                    <span>{currentVersion}</span>
                    <span aria-hidden="true">→</span>
                  </>
                )}
                <strong>{release.version}</strong>
                {date && (
                  <>
                    <span aria-hidden="true">·</span>
                    <time
                      dateTime={release.date ?? undefined}
                      aria-label={t('updates.releaseDate', { date })}
                    >
                      {t('updates.releaseDate', { date })}
                    </time>
                  </>
                )}
              </span>
            )}
            {!release && currentVersion && (
              <span>
                {upToDate
                  ? `Melo ${currentVersion}`
                  : t(disabled ? 'updates.devVersion' : 'updates.currentVersion', {
                      version: currentVersion,
                    })}
              </span>
            )}
          </p>
        </div>
      </header>

      <main
        className="updates-content"
        tabIndex={release ? 0 : undefined}
        aria-label={t(release ? 'updates.releaseNotes' : 'updates.title')}
      >
        {ready?.install === 'manual' && (
          <section className="updates-guide" aria-labelledby="install-guide-heading">
            <h2 id="install-guide-heading">{t('updates.installGuide')}</h2>
            <ol>
              <li>{t('updates.installStepOpen')}</li>
              <li>{t('updates.installStepReplace')}</li>
              <li>{t('updates.installStepReopen')}</li>
            </ol>
            <p>{t('updates.filesSafe')}</p>
          </section>
        )}
        {release && (
          <section className="updates-notes" aria-label={t('updates.releaseNotes')}>
            <div className="updates-notes-text">
              <ReleaseNotes notes={release.notes || t('updates.noReleaseNotes')} />
            </div>
          </section>
        )}
        {!release && resultDetail && (
          <div className="updates-result" role={failure && !checkBusy ? 'alert' : 'status'}>
            <span
              aria-hidden="true"
              className={cn(
                'updates-indicator',
                checkBusy && 'is-checking',
                upToDate && 'is-success',
                failure && !checkBusy && 'is-error',
              )}
            />
            <div>
              <p className="updates-result-detail">{resultDetail}</p>
              {upToDate && currentVersion && (
                <a href={notesUrl(currentVersion)} onClick={openNotes}>
                  {t('updates.currentReleaseNotes')}
                </a>
              )}
            </div>
          </div>
        )}
      </main>
      {release && (
        <a className="updates-notes-link" href={notesUrl(release.version)} onClick={openNotes}>
          {t('updates.fullReleaseNotes')} ↗
        </a>
      )}

      <footer className="updates-footer">
        {release && error && (
          <p className="updates-error" role="alert">
            {error}
          </p>
        )}
        <div className={cn('updates-actions', !release && 'updates-result-actions')}>
          {progress ? (
            <div className="updates-download">
              <p className="updates-status" role="status">
                <span>{t('updates.downloading', { version: progress.version })}</span>
                <span>{downloadAmount}</span>
              </p>
              <progress
                max={100}
                value={progress.percent}
                aria-label={t('updates.downloading', { version: progress.version })}
              />
            </div>
          ) : ready ? (
            <p className="updates-status updates-ready" role="status">
              <span className="updates-indicator is-success" aria-hidden="true" />
              {status}
            </p>
          ) : release ? (
            <Button
              className="updates-text-action updates-ignore"
              disabled={opening || checkBusy || ignoring}
              onClick={() => void ignore(release.version)}
            >
              {t('updates.ignoreVersion')}
            </Button>
          ) : upToDate ? (
            <label className="updates-auto">
              <input
                type="checkbox"
                checked={settings.autoUpdate}
                onChange={(event) => setSetting('autoUpdate', event.target.checked)}
              />
              {t('prefs.autoUpdate')}
            </label>
          ) : null}
          <div className="updates-primary-actions">
            <Button
              variant={!release && !canRetryCheck && !checkBusy ? 'primary' : 'secondary'}
              className={
                !release && !canRetryCheck && !checkBusy
                  ? 'updates-confirm updates-result-close'
                  : 'updates-dismiss'
              }
              disabled={opening || ignoring}
              onClick={close}
            >
              {t(
                progress
                  ? 'updates.backgroundDownload'
                  : release
                    ? 'updates.later'
                    : upToDate || disabled
                      ? 'updates.done'
                      : 'updates.close',
              )}
            </Button>
            {canRetryCheck && (
              <Button
                variant={failure ? 'primary' : 'secondary'}
                className={cn(failure !== null && 'updates-confirm')}
                onClick={() => void check()}
              >
                {t('updates.checkAgain')}
              </Button>
            )}
            {ready ? (
              <Button
                variant="primary"
                className="updates-confirm"
                disabled={opening || ignoring}
                onClick={() => void install(ready.release.version)}
              >
                {t(
                  opening
                    ? 'updates.opening'
                    : ready.install === 'manual'
                      ? 'updates.openInstaller'
                      : 'updates.restart',
                )}
              </Button>
            ) : release && !downloading ? (
              <Button
                variant="primary"
                className="updates-confirm"
                disabled={checkBusy || ignoring}
                onClick={() => void download()}
              >
                {t(state.download.status === 'error' ? 'updates.retry' : 'updates.download')}
              </Button>
            ) : null}
          </div>
        </div>
        {(ready?.install === 'manual' || (!ready && state.ready)) && (
          <div className="updates-secondary-actions">
            {ready?.install === 'manual' && (
              <Button
                className="updates-text-action"
                disabled={opening || ignoring}
                onClick={() => void install(ready.release.version, true)}
              >
                {t('updates.showInstaller')}
              </Button>
            )}
            {!ready && state.ready && (
              <Button
                className="updates-text-action"
                disabled={opening || downloading || ignoring}
                onClick={() => void install(state.ready!.release.version)}
              >
                {t('updates.installCached', { version: state.ready.release.version })}
              </Button>
            )}
          </div>
        )}
      </footer>
    </div>
  )
}
