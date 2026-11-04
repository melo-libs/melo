import { useEffect, useState } from 'react'
import { useAtomValue } from 'jotai'
import type { AgentAttachment } from '@shared/types/agent'
import { filePreview } from '@shared/filePreview'
import { IpcChannels } from '@shared/types/ipc'
import { workspacePathAtom } from '../../store/workspace'
import { FileThumbnail } from '../ui/FileThumbnail'

export function AgentAttachmentVisual({
  file,
  workspaceRoot,
}: {
  file: AgentAttachment
  workspaceRoot?: string
}) {
  const currentRoot = useAtomValue(workspacePathAtom)
  const root = workspaceRoot ?? currentRoot
  const canPreview = filePreview(file.name).kind !== 'file'
  const [preview, setPreview] = useState<{ id: string; url?: string; error?: string }>()
  useEffect(() => {
    if (!root || !canPreview) return
    let active = true
    void window.api
      .invoke(IpcChannels.AgentCommand, {
        action: 'attachment-preview',
        workspaceRoot: root,
        attachmentId: file.id,
      })
      .then((response) => {
        if (active)
          setPreview({ id: file.id, url: response.data?.attachmentPreview, error: response.error })
      })
      .catch((error: Error) => {
        if (active) setPreview({ id: file.id, error: error.message })
      })
    return () => {
      active = false
    }
  }, [file.id, root, canPreview])
  const url = preview?.id === file.id ? preview.url : undefined
  return (
    <FileThumbnail
      name={file.name}
      preview={url}
      loading={canPreview && !!root && preview?.id !== file.id}
      error={preview?.error}
    />
  )
}
