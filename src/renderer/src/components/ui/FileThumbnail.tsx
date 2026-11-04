import { filePreview } from '@shared/filePreview'
import './file-thumbnail.scss'

/** One visual cell at every size; labels remain aligned regardless of file type. */
export function FileThumbnail({
  name,
  preview,
  loading,
  error,
}: {
  name: string
  preview?: string
  loading?: boolean
  error?: string
}) {
  const presentation = filePreview(name)
  const label =
    presentation.label || (name.includes('.') ? name.split('.').pop()!.toUpperCase() : 'FILE')
  return (
    <span
      className="file-thumbnail"
      data-kind={presentation.kind}
      data-tone={presentation.tone}
      data-preview={!!preview || undefined}
      aria-busy={loading || undefined}
      title={error}
      aria-hidden="true"
    >
      {preview ? (
        <img src={preview} alt="" />
      ) : (
        <span className="file-thumbnail-paper">
          {presentation.tone === 'note' && <span className="file-thumbnail-mark">M↓</span>}
          {presentation.tone === 'audio' && <span className="file-thumbnail-mark">♪</span>}
        </span>
      )}
      {presentation.kind === 'video' && preview && (
        <span className="file-thumbnail-play">
          <span />
        </span>
      )}
      {((presentation.kind !== 'image' && presentation.kind !== 'video') ||
        (!preview && !loading)) && <span className="file-thumbnail-label">{label}</span>}
    </span>
  )
}
