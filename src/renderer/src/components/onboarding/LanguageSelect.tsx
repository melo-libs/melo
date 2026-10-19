import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { IpcChannels, type ResolvedLanguage } from '@shared/types/ipc'
import { Icon } from '../Icon'

export function LanguageSelect({ disabled }: { disabled: boolean }) {
  const { i18n } = useTranslation()
  const language = (i18n.resolvedLanguage ?? i18n.language).startsWith('zh') ? 'zh-CN' : 'en'
  const [pending, setPending] = useState<ResolvedLanguage | null>(null)
  const [failed, setFailed] = useState(false)

  const changeLanguage = async (next: ResolvedLanguage) => {
    if (pending || disabled || next === language) return
    setPending(next)
    setFailed(false)
    try {
      const response = await window.api.invoke(IpcChannels.InvokeSetLanguage, { language: next })
      if (!response.success || !response.data) {
        setFailed(true)
        return
      }
      await i18n.changeLanguage(response.data.resolved)
    } catch (error) {
      console.error('Could not change onboarding language', error)
      setFailed(true)
    } finally {
      setPending(null)
    }
  }

  // Disabling a focused select would expose the tour's arrow shortcuts while IPC is pending.
  return (
    <div className="ob-language-control">
      <label className="ob-language-picker">
        <Icon name="globe" size={16} aria-hidden="true" />
        <select
          aria-label="语言 / Language"
          aria-describedby={failed ? 'ob-language-error' : undefined}
          aria-invalid={failed || undefined}
          aria-busy={pending !== null || undefined}
          value={pending ?? language}
          disabled={disabled}
          onChange={(event) => void changeLanguage(event.target.value as ResolvedLanguage)}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <option value="en" lang="en" disabled={pending !== null && pending !== 'en'}>
            English
          </option>
          <option value="zh-CN" lang="zh-CN" disabled={pending !== null && pending !== 'zh-CN'}>
            简体中文
          </option>
        </select>
        <Icon name="chev" size={12} aria-hidden="true" />
      </label>
      {failed && (
        <div id="ob-language-error" className="ob-language-error" role="alert">
          <span lang="zh-CN">无法切换语言，请重试。</span>
          <span lang="en">Couldn’t change your language. Please try again.</span>
        </div>
      )}
    </div>
  )
}
