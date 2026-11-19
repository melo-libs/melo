import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { agentImageSource } from '@shared/agentImages'
import { IpcChannels } from '@shared/types/ipc'
import { openImageView } from '../editor/ImageLightbox'
import { Icon } from '../Icon'

export function AgentImage({
  source,
  alt,
  workspaceRoot,
  attachmentId,
}: {
  source?: string
  alt: string
  workspaceRoot?: string
  attachmentId?: string
}) {
  const { t } = useTranslation()
  const image = useMemo(() => agentImageSource(source ?? ''), [source])
  const local = !!attachmentId || image?.kind === 'workspace'
  const key = `${workspaceRoot ?? ''}\0${attachmentId ?? source}`
  const [preview, setPreview] = useState<{ key: string; url?: string }>()
  const [failed, setFailed] = useState<string>()
  useEffect(() => {
    if (!local || !workspaceRoot) return
    let active = true
    void window.api
      .invoke(
        IpcChannels.AgentCommand,
        attachmentId
          ? { action: 'attachment-image-preview', workspaceRoot, attachmentId }
          : { action: 'image-preview', workspaceRoot, source: source! },
      )
      .then((response) => {
        if (active) setPreview({ key, url: response.data?.imagePreview })
      })
      .catch(() => {
        if (active) setPreview({ key })
      })
    return () => {
      active = false
    }
  }, [local, workspaceRoot, source, attachmentId, key])
  const url = local
    ? preview?.key === key
      ? preview.url
      : undefined
    : image?.kind === 'remote' || image?.kind === 'data'
      ? image.url
      : undefined
  const unavailable =
    (!image && !attachmentId) ||
    failed === key ||
    (local && (!workspaceRoot || (preview?.key === key && !url)))
  return (
    <span className="agent-image">
      {unavailable ? (
        <span className="agent-image-fallback" role="status">
          <Icon name="image" size={18} />
          <span>
            {alt ? `${alt} · ${t('agent.imageUnavailable')}` : t('agent.imageUnavailable')}
          </span>
          {image?.kind === 'remote' && (
            <a
              href={image.url}
              onClick={(event) => {
                event.preventDefault()
                void window.api.invoke(IpcChannels.InvokeOpenExternal, { url: image.url })
              }}
            >
              {t('agent.openImage')}
            </a>
          )}
        </span>
      ) : url ? (
        <button
          type="button"
          className="agent-image-open"
          aria-label={alt ? `${t('agent.viewImage')}: ${alt}` : t('agent.viewImage')}
          onClick={() => openImageView(url)}
        >
          <img
            src={url}
            alt={alt}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setFailed(key)}
          />
        </button>
      ) : (
        <span className="agent-image-loading" role="status">
          {t('agent.loadingImage')}
        </span>
      )}
    </span>
  )
}
