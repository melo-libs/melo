import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Icon } from './Icon'
import { Button } from './ui/Button'
import { MeloLogo } from './MeloLogo'
import { cn } from '../lib/cn'
import { TourArtwork } from './onboarding/TourArtwork'
import { LanguageSelect } from './onboarding/LanguageSelect'
import {
  nextTourStep,
  previousTourStep,
  TOUR_COMPLETED_KEY,
  TOUR_FEATURES,
  type TourStep,
} from './onboarding/tour'
import './onboarding/opener.scss'

type EntryAction = 'folder' | 'create' | 'file'

export const WorkspaceOpener = ({
  onOpenWorkspace,
  onCreateWorkspace,
  onOpenFile,
}: {
  onOpenWorkspace: () => Promise<void>
  onCreateWorkspace: () => Promise<void>
  onOpenFile: () => Promise<void>
}) => {
  const { t } = useTranslation()
  const [step, setStep] = useState<TourStep>(() =>
    localStorage.getItem(TOUR_COMPLETED_KEY) === '1' ? 'start' : 'welcome',
  )
  const [replay, setReplay] = useState(0)
  const [visible, setVisible] = useState(!document.hidden)
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  const [pending, setPending] = useState<EntryAction | null>(null)
  const busy = pending !== null
  const mainRef = useRef<HTMLElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const focusHeadingRef = useRef(true)
  const feature = TOUR_FEATURES.find((item) => item.id === step)
  const hasAnimation = !!feature && feature.id !== 'organize'
  const playing = hasAnimation && visible && !reducedMotion
  const modifier = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'

  const showStep = useCallback(
    (next: TourStep) => {
      if (next === 'start') localStorage.setItem(TOUR_COMPLETED_KEY, '1')
      if (next === step) {
        headingRef.current?.focus({ preventScroll: true })
        return
      }
      focusHeadingRef.current = true
      setStep(next)
    },
    [step],
  )

  useEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = 0
    if (!focusHeadingRef.current) return
    headingRef.current?.focus({ preventScroll: true })
    focusHeadingRef.current = false
  }, [step])

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onMotion = () => setReducedMotion(media.matches)
    const onVisibility = () => setVisible(!document.hidden)
    media.addEventListener('change', onMotion)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      media.removeEventListener('change', onMotion)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.altKey || event.metaKey || event.ctrlKey || busy) return
      if (step !== 'start' && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
        event.preventDefault()
        showStep(event.key === 'ArrowRight' ? nextTourStep(step) : previousTourStep(step))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [step, busy, showStep])

  const runEntry = async (action: EntryAction) => {
    setPending(action)
    try {
      await { folder: onOpenWorkspace, create: onCreateWorkspace, file: onOpenFile }[action]()
    } finally {
      setPending(null)
    }
  }

  return (
    <div
      className="ws-opener"
      data-step={step}
      data-playing={playing}
      data-reduced-motion={reducedMotion}
    >
      <header className="ob-top">
        <div className="ob-tour-heading">
          {(feature || step === 'start') && (
            <div className="ob-tour-brand">
              <MeloLogo size={28} aria-hidden="true" />
              <span>Melo</span>
            </div>
          )}
          {feature && <span className="ob-demo-label">{t('onboarding.sampleOnly')}</span>}
        </div>
        <div className="ob-top-actions">
          {hasAnimation && !reducedMotion && (
            <Button
              className="ob-text-button ob-replay-scene"
              onClick={() => setReplay((value) => value + 1)}
            >
              {t('onboarding.replayScene')}
            </Button>
          )}
          {step === 'start' && (
            <Button
              className="ob-text-button ob-replay"
              disabled={busy}
              onClick={() => showStep('welcome')}
            >
              {t('onboarding.replay')}
            </Button>
          )}
          <LanguageSelect disabled={busy} />
        </div>
      </header>
      <div className="ob-content">
        <main className="ob-main" ref={mainRef} aria-labelledby="ws-opener-title">
          {step === 'welcome' && (
            <section className="ob-welcome">
              <MeloLogo className="ob-mascot" size={112} aria-hidden="true" />
              <ul className="ob-code">
                {TOUR_FEATURES.map(({ id, letter, english }) => {
                  const label = t(`onboarding.features.${id}.label`)
                  return (
                    <li className={`ob-code-item ob-tone-${id}`} key={id}>
                      <div className="ob-code-tile">{letter}</div>
                      <strong>{label}</strong>
                      {label !== english && <span>{english}</span>}
                    </li>
                  )
                })}
              </ul>
              <h1 id="ws-opener-title" ref={headingRef} tabIndex={-1}>
                {t('onboarding.welcomeTitle')}
              </h1>
              <p className="ob-description">{t('onboarding.welcomeDescription')}</p>
            </section>
          )}
          {feature && (
            <section className={`ob-feature ob-tone-${feature.id}`}>
              <div
                className={cn(
                  'ob-art',
                  feature.id === 'organize' && 'ob-art-organize',
                  feature.id === 'distill' && 'ob-art-editor',
                )}
                key={`${feature.id}-${replay}`}
                aria-hidden="true"
              >
                <TourArtwork feature={feature.id} modifier={modifier} />
              </div>
              <div className="ob-feature-copy">
                <h1 id="ws-opener-title" ref={headingRef} tabIndex={-1}>
                  {t(`onboarding.features.${feature.id}.title`, { shortcut: `${modifier}K` })}
                </h1>
                <p className="ob-description">
                  {t(`onboarding.features.${feature.id}.description`, { shortcut: `${modifier}K` })}
                </p>
                {feature.id === 'organize' && (
                  <p
                    className="ob-organize-upcoming"
                    data-capability="ai"
                    data-availability="planned"
                  >
                    {t('onboarding.features.organize.upcoming')}
                  </p>
                )}
              </div>
            </section>
          )}
          {step === 'start' && (
            <section className="ob-entry-screen">
              <Icon className="ob-entry-folder" name="folderOpen" size={64} aria-hidden="true" />
              <h1 id="ws-opener-title" ref={headingRef} tabIndex={-1}>
                {t('onboarding.startTitle')}
              </h1>
              <p className="ob-description">{t('onboarding.startDescription')}</p>
              <Button
                className="ob-choose-folder"
                disabled={busy}
                aria-busy={pending === 'folder'}
                onClick={() => void runEntry('folder')}
              >
                {t(pending === 'folder' ? 'onboarding.opening' : 'onboarding.chooseFolder')}
              </Button>
              <div className="ob-secondary-actions">
                <Button
                  className="ob-entry-link ob-create-folder"
                  disabled={busy}
                  aria-busy={pending === 'create'}
                  onClick={() => void runEntry('create')}
                >
                  {t('onboarding.newFolder')}
                </Button>
                <Button
                  className="ob-entry-link ob-open-file"
                  disabled={busy}
                  aria-busy={pending === 'file'}
                  onClick={() => void runEntry('file')}
                >
                  {t('onboarding.openFile')}
                </Button>
              </div>
            </section>
          )}
        </main>
        {step !== 'start' && (
          <footer className="ob-navigation">
            {/* Reserve the same pagination space on the welcome so the next click never moves. */}
            <div className="ob-pagination-slot">
              {feature && (
                <nav className="ob-pagination" aria-label={t('onboarding.navigation')}>
                  {TOUR_FEATURES.map(({ id }) => (
                    <Button
                      key={id}
                      className="ob-page-dot"
                      aria-label={t('onboarding.goToFeature', {
                        feature: t(`onboarding.features.${id}.label`),
                      })}
                      aria-current={step === id ? 'step' : undefined}
                      onClick={() => showStep(id)}
                    />
                  ))}
                </nav>
              )}
            </div>
            <Button className="ob-continue" onClick={() => showStep(nextTourStep(step))}>
              {t(step === 'express' ? 'onboarding.startUsing' : 'onboarding.continue')}
            </Button>
          </footer>
        )}
      </div>
    </div>
  )
}
