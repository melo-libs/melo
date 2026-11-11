import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

export function AgentDateDivider({ at }: { at: number }) {
  const { t, i18n } = useTranslation()
  const [today, setToday] = useState(() => new Date())
  useEffect(() => {
    const midnight = new Date()
    midnight.setHours(24, 0, 0, 0)
    const timer = setTimeout(() => setToday(new Date()), midnight.getTime() - Date.now())
    return () => clearTimeout(timer)
  }, [today])
  const date = new Date(at)
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const day = date.toDateString()
  const label =
    day === today.toDateString()
      ? t('agent.historyToday')
      : day === yesterday.toDateString()
        ? t('agent.historyYesterday')
        : new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(date)
  return (
    <div className="agent-date-divider">
      <time dateTime={date.toISOString()} title={date.toLocaleString(i18n.language)}>
        {label}
      </time>
    </div>
  )
}
