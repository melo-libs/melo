import { useEffect, useState } from 'react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { IpcChannels } from '@shared/types/ipc'
import { useUpdateState } from '../../hooks/useUpdateState'
import { cn } from '../../lib/cn'
import { resolveTheme, settingsAtom } from '../../store/settings'
import { MeloLogo } from '../MeloLogo'
import { Button } from '../ui/Button'
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
  const canRetryCheck = !release && !checkBusy && (failure !== null || state.check !== 'up-to-date')

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
  const status = progress
    ? t('updates.downloading', { version: progress.version })
    : ready
      ? t(state.installation === 'opened' ? 'updates.installerOpened' : 'updates.downloaded', {
          version: ready.release.version,
        })
      : checkBusy
        ? t('updates.checking')
        : null
  const resultTitle = checkBusy
    ? t('updates.checking')
    : installFailed
      ? t('updates.installFailedTitle')
      : checkFailed
        ? t('updates.checkFailedTitle')
        : state.check === 'up-to-date' && !failure
          ? t('updates.upToDate')
          : 'Melo'
  const resultDetail = checkBusy
    ? null
    : installFailed
      ? t('updates.invalidInstaller')
      : checkFailed
        ? t('updates.checkFailedDetail')
        : (error ?? (state.check === 'disabled' ? t('updates.disabled') : null))

  return (
    <div className={cn('updates-window', !release && 'updates-window-compact')}>
      <div className="updates-titlebar">{t('updates.title')}</div>
      <header className="updates-heading">
        <MeloLogo size={40} />
        <div className="updates-heading-text">
          <h1 role={!release ? (failure && !checkBusy ? 'alert' : 'status') : undefined}>
            {release ? t('updates.available') : resultTitle}
          </h1>
          <p>
            {release && (
              <span className="updates-release-meta">
                <strong>{release.version}</strong>
                {date && (
                  <>
                    <span aria-hidden="true">·</span>
                    <time
                      dateTime={release.date ?? undefined}
                      aria-label={t('updates.releaseDate', { date })}
                    >
                      {date}
                    </time>
                  </>
                )}
              </span>
            )}
            {currentVersion && (
              <span>{t('updates.currentVersion', { version: currentVersion })}</span>
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
          <section className="updates-notes" aria-labelledby="release-notes-heading">
            <h2 id="release-notes-heading" className="updates-notes-heading">
              {t('updates.releaseNotes')}
            </h2>
            <div className="updates-notes-text">{release.notes || t('updates.noReleaseNotes')}</div>
            <a
              href={`https://github.com/melo-libs/melo/releases/tag/v${release.version}`}
              onClick={(event) => {
                event.preventDefault()
                void window.api.invoke(IpcChannels.InvokeOpenExternal, {
                  url: event.currentTarget.href,
                })
              }}
            >
              {t('updates.fullReleaseNotes')}
            </a>
          </section>
        )}
        {!release && resultDetail && <p className="updates-result-detail">{resultDetail}</p>}
      </main>

      <footer className="updates-footer">
        {release && error && (
          <p className="updates-error" role="alert">
            {error}
          </p>
        )}
        {release && status && (
          <p className="updates-status" role="status">
            {status}
            {progress && ` ${progress.percent}%`}
          </p>
        )}
        {state.download.status === 'downloading' && (
          <progress
            max={100}
            value={state.download.percent}
            aria-label={t('updates.downloading', { version: state.download.version })}
          />
        )}
        <div className={cn('updates-actions', !release && 'updates-result-actions')}>
          {release && (
            <Button
              className="updates-text-action updates-ignore"
              disabled={opening || checkBusy || ignoring}
              onClick={() => void ignore(release.version)}
            >
              {t('updates.ignoreVersion')}
            </Button>
          )}
          <div className="updates-primary-actions">
            <Button
              variant={!release && !canRetryCheck ? 'primary' : 'secondary'}
              className={
                !release && !canRetryCheck
                  ? 'updates-confirm updates-result-close'
                  : 'updates-dismiss'
              }
              onClick={close}
            >
              {t(
                release
                  ? 'updates.later'
                  : state.check === 'up-to-date' && !failure
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
            ) : (
              release && (
                <Button
                  variant="primary"
                  className="updates-confirm"
                  disabled={downloading || checkBusy || ignoring}
                  onClick={() => void download()}
                >
                  {t(
                    downloading
                      ? 'prefs.downloadingUpdate'
                      : state.download.status === 'error'
                        ? 'updates.retry'
                        : 'updates.download',
                  )}
                </Button>
              )
            )}
          </div>
        </div>
        {ready?.install === 'manual' && (
          <Button
            className="updates-text-action"
            disabled={opening}
            onClick={() => void install(ready.release.version, true)}
          >
            {t('updates.showInstaller')}
          </Button>
        )}
        {!ready && state.ready && (
          <Button
            className="updates-text-action"
            disabled={opening || downloading}
            onClick={() => void install(state.ready!.release.version)}
          >
            {t('updates.installCached', { version: state.ready.release.version })}
          </Button>
        )}
      </footer>
    </div>
  )
}
