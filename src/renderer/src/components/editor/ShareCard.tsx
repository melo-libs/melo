import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from '../../i18n'
import * as Dialog from '@radix-ui/react-dialog'
import { Icon } from '../Icon'
import { cn } from '../../lib/cn'
import { toast } from '../Toaster'
import './share.scss'

/** What to render on the card. Built from a selection (bubble menu).
 *  `null` keeps the dialog closed. `source` is the note's external origin
 *  (web clips), absent for self-authored notes → shown as "(none)". */
export interface SharePayload {
  title: string
  body: string
  source?: string
  date?: string
  signature?: string
}

export interface ShareCardProps {
  payload: SharePayload | null
  onClose: () => void
}

/** Folder breadcrumb from a note path, e.g. "Melo Workspace › Second Brain". */
export function sourceLabelFromPath(path: string): string {
  return path.replace(/^~\//, '').split('/').slice(0, -1).join('  ›  ')
}

/* ---------- Presets ---------- */
// Literal colors (not CSS vars) so the card serializes self-contained for export.

interface Preset {
  name: string
  desc: string
  card: CSSProperties
  accent: string
  /** Soft tint for the decorative quote mark (lighter than `accent`). */
  quote: string
  eyebrow: string
  rule: string
  meta: string
}

type PresetId = 'manuscript' | 'minimal' | 'ink'

const SERIF = "'Source Serif 4 Variable', 'Source Serif Pro', Georgia, serif"
const SANS = "'Inter Variable', -apple-system, BlinkMacSystemFont, sans-serif"

const PRESETS: Record<PresetId, Preset> = {
  manuscript: {
    name: 'Manuscript',
    desc: 'Follows current Mood',
    card: {
      background: '#faf8f4',
      color: '#1f1c17',
      fontFamily: SERIF,
      border: '1px solid #e5dfd3',
    },
    accent: '#b27430',
    quote: '#e3ad7e',
    eyebrow: '#9a9183',
    rule: '#e5dfd3',
    meta: '#6b6355',
  },
  minimal: {
    name: 'Minimal',
    desc: 'White, serif, quiet',
    card: {
      background: '#ffffff',
      color: '#18181b',
      fontFamily: SANS,
      border: '1px solid #ececec',
    },
    accent: '#18181b',
    quote: '#d4d4d8',
    eyebrow: '#a1a1aa',
    rule: '#ececec',
    meta: '#71717a',
  },
  ink: {
    name: 'Ink',
    desc: 'Dark, dramatic',
    card: {
      background: '#1a1713',
      color: '#f0eade',
      fontFamily: SERIF,
      border: '1px solid #2f2c26',
    },
    accent: '#e0a96d',
    quote: '#9a6b3f',
    eyebrow: '#9a9183',
    rule: '#2f2c26',
    meta: '#9a9183',
  },
}

const PRESET_IDS: PresetId[] = ['manuscript', 'minimal', 'ink']

/* ---------- Signature persistence (a user preference; later from Settings) ---------- */

const SIG_KEY = 'melo.share.signature'
const SIG_ON_KEY = 'melo.share.signatureOn'

function readLS(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function writeLS(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* file:// may block storage — fall back to in-session state only */
  }
}

/* ---------- Export: DOM → PNG via SVG foreignObject ---------- */

async function rasterize(node: HTMLElement, bg: string, scale = 2): Promise<Blob | null> {
  // offsetWidth/Height is the layout size, unaffected by the preview's CSS
  // scale transform — inside the foreignObject the node renders at full size.
  const w = node.offsetWidth
  const h = node.offsetHeight
  const xml = new XMLSerializer().serializeToString(node)
  // Paint the card's own background behind it: the card's rounded corners are
  // transparent, which would otherwise show as a white fringe when the PNG is
  // pasted onto a light surface (very visible on the dark Ink preset).
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
    `<rect width="100%" height="100%" fill="${bg}"/>` +
    '<foreignObject width="100%" height="100%">' +
    `<div xmlns="http://www.w3.org/1999/xhtml">${xml}</div>` +
    '</foreignObject></svg>'

  const img = new Image()
  // A data: URL (not a blob:) keeps the canvas untainted, so toBlob() works.
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('rasterize failed'))
  })

  const canvas = document.createElement('canvas')
  canvas.width = w * scale
  canvas.height = h * scale
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.scale(scale, scale)
  ctx.drawImage(img, 0, 0)
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
}

/** "Share as image" — render a note/selection as a card, export to PNG. */
const cap = (s: string): string => s[0].toUpperCase() + s.slice(1)

export const ShareCard = ({ payload, onClose }: ShareCardProps) => {
  const { t } = useTranslation()
  const [preset, setPreset] = useState<PresetId>('manuscript')
  const [showTitle, setShowTitle] = useState(true)
  const [showSource, setShowSource] = useState(true)
  const [showDate, setShowDate] = useState(false)
  // Signature is a remembered preference: keep the user's name + on/off
  // across opens and restarts (later this comes from Settings).
  const [showSignature, setShowSignature] = useState(() => readLS(SIG_ON_KEY) === '1')
  const [signature, setSignature] = useState(() => readLS(SIG_KEY) ?? '')
  const [showWatermark, setShowWatermark] = useState(true)
  const [busy, setBusy] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)

  // On open: prefer the remembered signature; fall back to the payload default
  // (e.g. a Settings-provided name) only when nothing was ever saved.
  useEffect(() => {
    if (!payload) return
    const saved = readLS(SIG_KEY)
    setSignature(saved !== null ? saved : (payload.signature ?? ''))
  }, [payload])

  const updateSignature = (value: string) => {
    setSignature(value)
    writeLS(SIG_KEY, value)
  }
  const toggleSignature = (on: boolean) => {
    setShowSignature(on)
    writeLS(SIG_ON_KEY, on ? '1' : '0')
  }

  const p = PRESETS[preset]
  const hasSource = !!payload?.source
  const showTitleRow = showTitle && !!payload?.title
  const sigText = showSignature && signature.trim() ? signature.trim() : ''
  // Source + date share one small uppercase meta line under the signature.
  const metaLine = [showSource && payload?.source, showDate && payload?.date]
    .filter(Boolean)
    .join('   ·   ')
  const hasFooter = showTitleRow || !!sigText || !!metaLine

  const download = async () => {
    if (!cardRef.current) return
    setBusy(true)
    try {
      const blob = await rasterize(cardRef.current, p.card.background as string)
      if (!blob) throw new Error('no blob')
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${payload?.title ?? 'melo-card'}.png`
      a.click()
      URL.revokeObjectURL(url)
      toast(i18n.t('share.imageSaved'))
    } catch {
      toast(i18n.t('share.exportFailed'))
    } finally {
      setBusy(false)
    }
  }

  const copy = () => {
    if (!cardRef.current) return
    const Clip = (window as typeof window & { ClipboardItem?: typeof ClipboardItem }).ClipboardItem
    if (!(navigator.clipboard && 'write' in navigator.clipboard && Clip)) {
      toast(i18n.t('share.clipboardUnsupported'))
      return
    }
    // Hand the Clipboard API a Promise<Blob> and call write() synchronously, so
    // the write stays inside the click's user activation (rasterize resolves in
    // a later task — awaiting it first would forfeit the gesture → NotAllowedError).
    setBusy(true)
    const blob = rasterize(cardRef.current, p.card.background as string).then((b) => {
      if (!b) throw new Error('no blob')
      return b
    })
    navigator.clipboard
      .write([new Clip({ 'image/png': blob })])
      .then(() => toast(i18n.t('share.imageCopied')))
      .catch(() => toast(i18n.t('share.copyFailed')))
      .finally(() => setBusy(false))
  }

  return (
    <Dialog.Root open={payload != null} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="share-scrim" />
        <Dialog.Content
          className="share-card"
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="share-head">
            <div className="share-head-text">
              <Dialog.Title className="share-title">{t('share.title')}</Dialog.Title>
              <div className="share-sub">
                Card is copied to your clipboard — paste into any chat or app
              </div>
            </div>
            <Dialog.Close className="share-close" aria-label={t('misc.close')}>
              <Icon name="x" size={14} />
            </Dialog.Close>
          </div>

          <div className="share-body">
            {/* Live preview — also the node that gets rasterized. */}
            <div className="share-stage">
              <div
                ref={cardRef}
                className="share-art"
                style={{
                  ...p.card,
                  width: 540,
                  padding: '44px 50px 40px',
                  borderRadius: 18,
                  boxSizing: 'border-box',
                  position: 'relative',
                }}
              >
                {showWatermark && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 30,
                      right: 36,
                      fontFamily: SANS,
                      fontSize: 11,
                      fontWeight: 600,
                      letterSpacing: '0.22em',
                      color: p.eyebrow,
                    }}
                  >
                    MELO
                  </div>
                )}

                {/* Decorative opening quote */}
                <div
                  aria-hidden
                  style={{
                    fontFamily: 'Georgia, serif',
                    fontSize: 72,
                    lineHeight: 1,
                    height: 30,
                    color: p.quote,
                    marginBottom: 26,
                  }}
                >
                  &ldquo;
                </div>

                <div
                  style={{
                    fontSize: 29,
                    lineHeight: 1.48,
                    whiteSpace: 'pre-wrap',
                    color: p.card.color as string,
                  }}
                >
                  {payload?.body}
                </div>

                {hasFooter && (
                  <>
                    <div style={{ height: 1, background: p.rule, margin: '36px 0 0' }} />
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'flex-end',
                        justifyContent: 'space-between',
                        gap: 16,
                        marginTop: 18,
                      }}
                    >
                      {showTitleRow ? (
                        <span
                          style={{
                            fontFamily: SANS,
                            fontSize: 14,
                            fontWeight: 500,
                            color: p.card.color as string,
                          }}
                        >
                          {payload?.title}
                        </span>
                      ) : (
                        <span />
                      )}

                      {(sigText || metaLine) && (
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'flex-end',
                            gap: 5,
                            textAlign: 'right',
                          }}
                        >
                          {sigText && (
                            <span
                              style={{
                                fontFamily: SERIF,
                                fontStyle: 'italic',
                                fontSize: 21,
                                color: p.card.color as string,
                              }}
                            >
                              — {sigText}
                            </span>
                          )}
                          {metaLine && (
                            <span
                              style={{
                                fontFamily: SANS,
                                fontSize: 11,
                                letterSpacing: '0.12em',
                                textTransform: 'uppercase',
                                color: p.meta,
                              }}
                            >
                              {metaLine}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Controls */}
            <div className="share-panel">
              <div className="share-panel-label">{t('share.style')}</div>
              <div className="share-presets">
                {PRESET_IDS.map((id) => (
                  <button
                    key={id}
                    className={cn('share-preset', preset === id && 'active')}
                    onClick={() => setPreset(id)}
                  >
                    <span className="share-preset-name">{t(`share.preset${cap(id)}`)}</span>
                    <span className="share-preset-desc">{t(`share.preset${cap(id)}Desc`)}</span>
                  </button>
                ))}
              </div>

              <div className="share-panel-label">{t('share.show')}</div>
              <div className="share-checks">
                <CheckRow
                  label={t('share.noteTitle')}
                  checked={showTitle}
                  onChange={setShowTitle}
                />
                <CheckRow
                  label={hasSource ? t('share.source') : t('share.sourceNone')}
                  checked={showSource && hasSource}
                  disabled={!hasSource}
                  onChange={setShowSource}
                />
                <CheckRow
                  label={
                    payload?.date ? t('share.dateWith', { date: payload.date }) : t('share.date')
                  }
                  checked={showDate}
                  disabled={!payload?.date}
                  onChange={setShowDate}
                />
                <CheckRow
                  label={t('share.signature')}
                  checked={showSignature}
                  onChange={toggleSignature}
                />
                {showSignature && (
                  <input
                    className="share-sig-input"
                    value={signature}
                    onChange={(e) => updateSignature(e.target.value)}
                    placeholder={t('share.yourName')}
                    aria-label={t('share.signatureText')}
                  />
                )}
                <CheckRow
                  label={t('share.watermark')}
                  checked={showWatermark}
                  onChange={setShowWatermark}
                />
              </div>

              <div className="share-actions">
                <button className="share-btn primary" onClick={copy} disabled={busy}>
                  {t('share.copyToClipboard')}
                </button>
                <button className="share-btn ghost" onClick={download} disabled={busy}>
                  {busy ? t('share.rendering') : t('share.downloadPng')}
                </button>
              </div>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

const CheckRow = ({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string
  checked: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
}) => (
  <label className={cn('share-check', disabled && 'disabled')}>
    {/* Real checkbox, visually hidden but still focusable / announced. */}
    <input
      type="checkbox"
      className="share-check-input"
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
    />
    <span className={cn('share-check-box', checked && 'on')}>
      {checked && (
        <svg viewBox="0 0 14 14" width="11" height="11" fill="none" stroke="#fff" strokeWidth="2.2">
          <path d="M3 7.5l2.6 2.6L11 4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </span>
    <span className="share-check-label">{label}</span>
  </label>
)
