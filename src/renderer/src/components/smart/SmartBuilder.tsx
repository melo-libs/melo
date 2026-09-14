import { useEffect, useRef, useState } from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/cn'
import { IpcChannels } from '@shared/types/ipc'
import type { SmartHit, SmartRule, SmartVocab } from '@shared/types/smart'
import {
  activeSmartIdAtom,
  deleteSmartViewAtom,
  persistSmartViewsAtom,
  smartBuilderAtom,
  smartFoldersAtom,
  smartVocabAtom,
} from '../../store/smart'
import { SIcon } from './SmartIcon'
import { toast } from '../Toaster'
import { AddRuleMenu, SelBtn } from './SmartControls'
import {
  RULE_META,
  RULE_KEY_LIST,
  SMART_GLYPHS,
  ruleValues,
  newRule,
  isTextRule,
} from './smartData'
import './smart.scss'

/* ============================================================
   SmartBuilder — the "New smart folder" modal: name, icon,
   rule builder, and a live preview against the real index.
   Create / Save persists the definitions to .melo/views.json;
   editing an existing folder also offers Delete.
   ============================================================ */

export const SmartBuilder = () => {
  const { t } = useTranslation()
  const [draft, setDraft] = useAtom(smartBuilderAtom)
  const folders = useAtomValue(smartFoldersAtom)
  const setActiveId = useSetAtom(activeSmartIdAtom)
  const persistViews = useSetAtom(persistSmartViewsAtom)
  const deleteView = useSetAtom(deleteSmartViewAtom)
  const vocab = useAtomValue(smartVocabAtom)

  if (!draft) return null
  return (
    <BuilderModal
      key={JSON.stringify(draft)}
      initial={draft}
      editing={!!draft.editId}
      vocab={vocab}
      onCancel={() => setDraft(null)}
      onDelete={
        draft.editId
          ? async () => {
              const name = folders.find((f) => f.id === draft.editId)?.name ?? 'smart folder'
              const ok = await deleteView(draft.editId!)
              if (!ok) {
                toast(t('sidebar.couldNotDeleteSmart'))
                return
              }
              toast(t('sidebar.deletedSmart', { name }))
              setDraft(null)
            }
          : undefined
      }
      onCreate={async ({ name, glyph, rules }) => {
        const id = draft.editId ?? 'sf' + Date.now()
        const next = draft.editId
          ? folders.map((f) => (f.id === draft.editId ? { ...f, name, glyph, rules } : f))
          : [...folders, { id, name, glyph: glyph || 'bookmark', rules }]
        const ok = await persistViews(next)
        if (!ok) {
          // Write failed (read-only disk, workspace switched) — keep the
          // modal open so nothing silently evaporates on restart.
          toast(t('smart.couldNotSave'))
          return
        }
        setActiveId(id)
        setDraft(null)
      }}
    />
  )
}

/** Compact relative time for preview rows — sanity-checks date rules at a glance. */
const ago = (d: number, t: (k: string, o?: Record<string, unknown>) => string): string => {
  if (d <= 0) return t('smart.today')
  if (d === 1) return t('smart.yesterday')
  if (d < 7) return t('smart.daysAgo', { count: d })
  if (d < 30) return t('smart.weeksAgo', { count: Math.round(d / 7) })
  if (d < 365) return t('smart.monthsAgo', { count: Math.round(d / 30) })
  return t('smart.yearsAgo', { count: Math.round(d / 365) })
}

function BuilderModal({
  initial,
  editing,
  vocab,
  onCancel,
  onDelete,
  onCreate,
}: {
  initial: { name: string; glyph: string; rules: SmartRule[] }
  editing: boolean
  vocab: SmartVocab
  onCancel: () => void
  onDelete?: () => void
  onCreate: (f: { name: string; glyph: string; rules: SmartRule[] }) => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(initial.name)
  const [glyph, setGlyph] = useState(initial.glyph || 'bookmark')
  const [rules, setRules] = useState(initial.rules)

  // Anything typed or changed makes a scrim click too risky to treat as
  // dismiss — Cancel and Esc stay the explicit ways out.
  const dirty =
    name !== initial.name ||
    glyph !== (initial.glyph || 'bookmark') ||
    JSON.stringify(rules) !== JSON.stringify(initial.rules)

  // Esc closes the modal; open popovers eat Esc in the capture phase first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  // Live preview against the real index, lightly debounced per edit and
  // refreshed when the index moves under the open modal.
  const [preview, setPreview] = useState<SmartHit[]>([])
  const seq = useRef(0)
  useEffect(() => {
    const valid = rules.filter((r) => r.op === 'is empty' || r.val)
    const run = () => {
      const mySeq = ++seq.current
      window.api
        .invoke(IpcChannels.InvokeQuerySmartView, { rules: valid })
        .then((res) => {
          if (seq.current === mySeq && res.success && res.data) setPreview(res.data.items)
        })
        .catch(() => {})
    }
    const t = setTimeout(run, 200)
    const off = window.api.on(IpcChannels.OnWorkspaceChanged, run)
    return () => {
      clearTimeout(t)
      off()
    }
  }, [rules])

  const setRule = (i: number, nr: SmartRule) => setRules(rules.map((r, j) => (j === i ? nr : r)))

  return (
    <div className="smart-modal-scrim" onClick={() => !dirty && onCancel()}>
      <div className="smart-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{editing ? t('smart.editSmartFolder') : t('smart.newSmartFolder')}</h2>
          <button className="modal-close" onClick={onCancel} title={t('smart.close')}>
            <SIcon n="x" s={16} />
          </button>
        </div>
        <div className="modal-body">
          <div className="name-row">
            <input
              className="name-input"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              placeholder={t('smart.folderName')}
            />
          </div>
          <div className="glyph-row">
            {SMART_GLYPHS.map((g) => (
              <button
                key={g}
                className={cn('glyph-pick', g === glyph && 'sel')}
                onClick={() => setGlyph(g)}
                title={g}
              >
                <SIcon n={g} s={17} />
              </button>
            ))}
          </div>

          <p className="field-label" style={{ marginTop: 20 }}>
            {t('smart.allTrue')}
          </p>
          <div className="builder-rules">
            {rules.map((r, i) => {
              const meta = RULE_META[r.key]
              const values = ruleValues(r.key, vocab)
              return (
                <div className="brule" key={i}>
                  <SelBtn
                    cls="key"
                    value={r.key}
                    options={RULE_KEY_LIST}
                    onPick={(k) => setRule(i, newRule(k as SmartRule['key'], vocab))}
                  />
                  <SelBtn
                    cls="op"
                    value={r.op}
                    options={meta.ops}
                    onPick={(op) => {
                      const wasText = isTextRule(r.key, r.op)
                      const nowText = isTextRule(r.key, op)
                      const val =
                        op === 'is empty' ? '' : wasText !== nowText ? '' : r.val || values[0] || ''
                      setRule(i, { ...r, op, val })
                    }}
                  />
                  {r.op === 'is empty' ? (
                    <span
                      className="sel-btn val"
                      style={{ color: 'var(--ink-4)', pointerEvents: 'none' }}
                    >
                      {t('smart.noValue')}
                    </span>
                  ) : isTextRule(r.key, r.op) ? (
                    <input
                      className="rule-text-input val"
                      type={r.op === 'before' || r.op === 'after' ? 'date' : 'text'}
                      value={r.val}
                      placeholder={r.key === 'Title' ? t('smart.enterText') : ''}
                      onChange={(e) => setRule(i, { ...r, val: e.target.value })}
                    />
                  ) : (
                    <SelBtn
                      cls="val"
                      value={r.val || values[0] || '—'}
                      options={values}
                      onPick={(v) => setRule(i, { ...r, val: v })}
                    />
                  )}
                  <button
                    className="rc-x"
                    onClick={() => setRules(rules.filter((_, j) => j !== i))}
                    title={t('smart.remove')}
                  >
                    <SIcon n="trash" s={14} />
                  </button>
                </div>
              )
            })}
          </div>
          <div className="builder-add">
            <AddRuleMenu vocab={vocab} onAdd={(r) => setRules([...rules, r])} />
          </div>

          <div className="preview-box">
            <div className="preview-head">
              {t('smart.livePreview')} · <b style={{ margin: '0 4px' }}>{preview.length}</b>{' '}
              {preview.length === 1 ? t('smart.match') : t('smart.matches')}
            </div>
            <div className="preview-list">
              {preview.length === 0 ? (
                <div className="preview-empty">{t('smart.previewEmpty')}</div>
              ) : (
                <>
                  {preview.slice(0, 6).map((it) => (
                    <div className="preview-item" key={it.path}>
                      <span className="pi-name">{it.title}</span>
                      <span className="pi-meta">{it.sourceHost || it.folderTop}</span>
                      <span className="pi-time">{ago(it.days, t)}</span>
                    </div>
                  ))}
                  {preview.length > 6 && (
                    <div className="preview-more">
                      {t('smart.more', { count: preview.length - 6 })}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
        <div className="modal-foot">
          {onDelete && (
            <button className="btn ghost danger" onClick={onDelete}>
              <SIcon n="trash" s={14} />
              {t('smart.del')}
            </button>
          )}
          <span className="spacer" />
          <button className="btn quiet" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button
            className="btn"
            disabled={!name.trim() || rules.length === 0}
            onClick={() => onCreate({ name: name.trim(), glyph, rules })}
          >
            {editing ? t('smart.saveChanges') : t('smart.create')}
          </button>
        </div>
      </div>
    </div>
  )
}
