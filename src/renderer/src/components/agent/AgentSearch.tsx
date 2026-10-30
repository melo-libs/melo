import { useEffect, useRef, useState, Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentHistorySearch } from '@shared/types/agent'
import { agentCommand } from '../../store/agent'
import { Icon } from '../Icon'
import { MeloLogo } from '../MeloLogo'
import { agentErrorText } from './agentError'
import { stripMarkdownExtension } from '@shared/fileKinds'

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>
  const parts: React.ReactNode[] = []
  const lower = text.toLowerCase(),
    word = query.trim().toLowerCase()
  let start = 0,
    index = lower.indexOf(word)
  while (index >= 0) {
    parts.push(
      <Fragment key={start}>
        {text.slice(start, index)}
        <mark>{text.slice(index, index + word.length)}</mark>
      </Fragment>,
    )
    start = index + word.length
    index = lower.indexOf(word, start)
  }
  parts.push(text.slice(start))
  return <>{parts}</>
}

export function AgentSearch({
  onClose,
  onJump,
  onAsk,
  canAsk,
}: {
  onClose(): void
  onJump(id: string): void
  onAsk(query: string): void
  canAsk: boolean
}) {
  const { t, i18n } = useTranslation()
  const input = useRef<HTMLInputElement>(null)
  const results = useRef<HTMLDivElement>(null)
  const queryRef = useRef('')
  const [query, setQuery] = useState(''),
    [result, setResult] = useState<AgentHistorySearch | null>(null),
    [error, setError] = useState(''),
    [selected, setSelected] = useState(0),
    [loading, setLoading] = useState(false)
  useEffect(() => {
    input.current?.focus()
  }, [])
  queryRef.current = query
  useEffect(() => {
    results.current?.querySelector('[data-selected]')?.scrollIntoView({ block: 'nearest' })
  }, [selected])
  useEffect(() => {
    let live = true
    setResult(null)
    setError('')
    setSelected(0)
    setLoading(!!query.trim())
    if (!query.trim()) return
    const timer = setTimeout(() => {
      void agentCommand({ action: 'search-history', query })
        .then((response) => {
          if (live) setResult(response.search!)
        })
        .catch((error) => {
          if (live) setError(agentErrorText(error.message))
        })
        .finally(() => {
          if (live) setLoading(false)
        })
    }, 150)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [query])
  return (
    <div
      className="agent-search"
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          onClose()
        } else if (event.key === 'ArrowDown') {
          event.preventDefault()
          setSelected((index) =>
            Math.max(0, Math.min((result?.messages.length ?? 1) - 1, index + 1)),
          )
        } else if (event.key === 'ArrowUp') {
          event.preventDefault()
          setSelected((index) => Math.max(0, index - 1))
        } else if (event.key === 'Enter') {
          event.preventDefault()
          if ((event.metaKey || event.ctrlKey) && query.trim() && canAsk) onAsk(query.trim())
          else if (result?.messages[selected]) onJump(result.messages[selected].id)
        }
      }}
    >
      <div className="agent-head agent-search-head">
        <div className="agent-search-field">
          <Icon name="search" size={16} />
          <input
            ref={input}
            value={query}
            placeholder={t('agent.searchPlaceholder')}
            aria-label={t('agent.searchPlaceholder')}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button
              className="agent-quiet"
              aria-label={t('agent.clearSearch')}
              onClick={() => {
                setQuery('')
                input.current?.focus()
              }}
            >
              <Icon name="x" size={12} />
            </button>
          )}
        </div>
        <button className="agent-quiet" onClick={onClose}>
          {t('common.cancel')}
        </button>
      </div>
      <div className="agent-search-results" ref={results}>
        {query.trim() && (
          <>
            <button
              className="agent-search-ask"
              disabled={!canAsk}
              onClick={() => onAsk(query.trim())}
            >
              <MeloLogo size={20} />
              <span>{t('agent.askHistory', { query: query.trim() })}</span>
              <kbd>⌘↵</kbd>
            </button>
            <div className="agent-search-separator" />
          </>
        )}
        {loading && (
          <p className="agent-search-hint" role="status">
            {t('agent.searching')}
          </p>
        )}
        {error && (
          <p className="agent-error" role="alert">
            {error}
          </p>
        )}
        {result && (
          <p className="agent-search-count">
            {t('agent.historyMatchCount', { count: result.total })}
          </p>
        )}
        {!query.trim() && <p className="agent-search-hint">{t('agent.searchHint')}</p>}
        {result?.messages.map((message, index) => (
          <button
            key={message.id}
            className="agent-search-result"
            data-selected={selected === index || undefined}
            onMouseEnter={() => setSelected(index)}
            onFocus={() => setSelected(index)}
            onClick={() => onJump(message.id)}
          >
            <span className="agent-search-excerpt">
              <Highlight text={message.content} query={query} />
            </span>
            <span className="agent-search-meta">
              <Icon name="file" size={14} />
              <span>
                {message.context?.filePath
                  ? stripMarkdownExtension(message.context.filePath.split('/').pop()!)
                  : t('agent.workspaceExchange')}
              </span>
              <time>
                {new Intl.DateTimeFormat(i18n.language, { month: 'short', day: 'numeric' }).format(
                  message.createdAt,
                )}
              </time>
              <span>
                {t(message.role === 'user' ? 'agent.historyUser' : 'agent.historyAssistant')}
              </span>
            </span>
          </button>
        ))}
        {result && result.messages.length < result.total && (
          <button
            className="agent-quiet"
            disabled={loading}
            onClick={() => {
              const before = result.messages.at(-1)?.sequence
              setLoading(true)
              void agentCommand({ action: 'search-history', query, before })
                .then((response) => {
                  if (queryRef.current === query)
                    setResult(
                      (current) =>
                        current && {
                          total: response.search!.total,
                          messages: [...current.messages, ...response.search!.messages],
                        },
                    )
                })
                .catch((error) => {
                  if (queryRef.current === query) setError(agentErrorText(error.message))
                })
                .finally(() => {
                  if (queryRef.current === query) setLoading(false)
                })
            }}
          >
            {t('agent.moreHistory')}
          </button>
        )}
        {result?.total === 0 && <p className="agent-search-hint">{t('agent.noHistoryMatches')}</p>}
      </div>
    </div>
  )
}
