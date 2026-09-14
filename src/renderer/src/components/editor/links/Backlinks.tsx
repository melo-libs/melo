import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAtomValue, useSetAtom } from 'jotai'
import { Icon } from '../../Icon'
import { FileTypeIcon } from '../../FileTypeIcon'
import { IpcChannels } from '@shared/types/ipc'
import { toast } from '../../Toaster'
import { openFileAtom } from '../../../store/editor'
import { workspacePathAtom } from '../../../store/workspace'
import { useNoteLinks } from './useNoteLinks'
import { wikilinkSnippetHtml, mentionSnippetHtml } from './snippets'
import { workspaceDisplayPath } from './resolve'

/* ============================================================
   Backlinks panel — "Linked references" + "Unlinked mentions",
   rendered at the bottom of the note. Port of design DualLinks,
   fed by the links table (InvokeGetNoteLinks).
   ============================================================ */

export const Backlinks = () => {
  const { t } = useTranslation()
  // Collapsed by default: a quiet one-line summary at the end of the note;
  // the context only unfolds when asked for.
  const [open, setOpen] = useState(false)
  const { links, notePath, refresh } = useNoteLinks()
  const openFile = useSetAtom(openFileAtom)
  const workspacePath = useAtomValue(workspacePathAtom)
  // Paths just promoted via "Link" — highlighted after the refresh.
  const [justLinked, setJustLinked] = useState<string[]>([])

  // The note's stem also resolves to it — highlight both spellings.
  const stem = (notePath?.split('/').pop() ?? '').replace(/\.(md|markdown)$/i, '')
  const highlights = [links.selfTitle, stem]

  const totalRefs = links.backlinks.reduce((n, g) => n + g.refs.length, 0)
  const backlinkSources = links.backlinks.length

  // Most notes have no references at all — render nothing rather than an
  // empty "Linked references 0" shell on every note.
  if (!notePath || (links.backlinks.length === 0 && links.mentions.length === 0)) return null

  const linkIt = async (mention: { path: string; title: string }) => {
    const res = await window.api.invoke(IpcChannels.InvokeLinkMention, {
      sourcePath: mention.path,
      targetTitle: links.selfTitle,
    })
    if (!res.success || !res.data?.linked) {
      toast(res.error || t('links.couldNotLink'))
      return
    }
    setJustLinked((p) => [...p, mention.path])
    refresh()
  }

  return (
    <section className="bl">
      <div className="bl-rule" />
      <button className="bl-head" onClick={() => setOpen((o) => !o)}>
        <span className={'bl-head-chev' + (open ? ' open' : '')}>
          <Icon name="chev" size={13} />
        </span>
        <span className="bl-head-icon">
          <Icon name="backlink" size={16} />
        </span>
        <span className="bl-head-title">{t('links.linkedReferences')}</span>
        <span className="bl-count">{totalRefs}</span>
        <span className="bl-head-spacer" />
        <span className="bl-head-from">
          {backlinkSources
            ? t('links.notesLinkHere', { count: backlinkSources })
            : t('links.noNotesLinkHere')}
        </span>
      </button>

      {open && (
        <div className="bl-body">
          {links.backlinks.map((g) => (
            <article
              className={'bl-group' + (justLinked.includes(g.path) ? ' just-linked' : '')}
              key={g.path}
            >
              <header className="bl-group-head" onClick={() => openFile(g.path)}>
                <span className="bl-group-ft">
                  <FileTypeIcon kind="md" size={17} />
                </span>
                <span className="bl-group-title">{g.title}</span>
                <span className="bl-group-path">{workspaceDisplayPath(g.path, workspacePath)}</span>
                <span className="bl-group-n">{g.refs.length}</span>
              </header>
              <div className="bl-refs">
                {g.refs.map((r, ri) => (
                  <div className="bl-ref" key={ri}>
                    {r.heading && (
                      <div className="bl-ref-anchor">
                        <Icon name="h2" size={11} /> {r.heading}
                      </div>
                    )}
                    <div
                      className="bl-snippet"
                      dangerouslySetInnerHTML={{
                        __html: wikilinkSnippetHtml(r.context, highlights),
                      }}
                    />
                  </div>
                ))}
              </div>
            </article>
          ))}

          {links.mentions.length > 0 && (
            <div className="bl-unlinked">
              <div className="bl-sub">
                <span className="bl-sub-icon">
                  <Icon name="search" size={13} />
                </span>
                {t('links.unlinkedMentions')}
                <span className="bl-count subtle">{links.mentions.length}</span>
              </div>
              {links.mentions.map((u) => (
                <article className="bl-group unlinked" key={u.path}>
                  <header className="bl-group-head" onClick={() => openFile(u.path)}>
                    <span className="bl-group-ft">
                      <FileTypeIcon kind="md" size={17} />
                    </span>
                    <span className="bl-group-title">{u.title}</span>
                    <span className="bl-group-path">
                      {workspaceDisplayPath(u.path, workspacePath)}
                    </span>
                    <button
                      className="bl-link-btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        void linkIt(u)
                      }}
                    >
                      <Icon name="bracketLink" size={12} /> {t('links.link')}
                    </button>
                  </header>
                  <div className="bl-refs">
                    <div className="bl-ref">
                      <div
                        className="bl-snippet"
                        dangerouslySetInnerHTML={{
                          __html: mentionSnippetHtml(u.context, links.selfTitle),
                        }}
                      />
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
