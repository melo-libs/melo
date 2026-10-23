import { useTranslation } from 'react-i18next'

export function FilesArtwork() {
  const { t } = useTranslation()
  return (
    <div className="ob-art-scene ob-files-art">
      <div className="ob-files-stack">
        <div className="ob-files-item ob-file-photo" data-extension="jpg">
          <svg
            className="ob-file-landscape"
            viewBox="0 0 260 400"
            preserveAspectRatio="xMidYMid slice"
            aria-hidden="true"
          >
            <circle className="ob-file-sun" cx="194" cy="44" r="18" />
            <path className="ob-file-hill-back" d="M0 92Q86 44 174 110T280 94V400H0Z" />
            <path className="ob-file-hill-front" d="M0 198Q120 46 260 96V400H0Z" />
          </svg>
          <span className="ob-file-tag">JPG</span>
        </div>
        <div className="ob-files-item ob-file-slides" data-extension="pptx">
          <span className="ob-file-tag">PPT</span>
          <svg className="ob-file-donut" viewBox="0 0 64 64" aria-hidden="true">
            <circle className="ob-file-donut-track" cx="32" cy="32" r="24" />
            <circle
              className="ob-file-donut-value"
              cx="32"
              cy="32"
              r="24"
              strokeDasharray="112 151"
              transform="rotate(-90 32 32)"
            />
          </svg>
          <strong>{t('onboarding.demo.files.slides')}</strong>
          <div className="ob-file-lines">
            <span />
            <span />
          </div>
        </div>
        <div className="ob-files-item ob-file-video" data-extension="mp4">
          <span className="ob-file-tag">MP4</span>
          <span className="ob-file-duration">12:48</span>
          <span className="ob-file-play">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m8 4 13 8-13 8Z" />
            </svg>
          </span>
        </div>
        <div className="ob-files-item ob-file-pdf" data-extension="pdf">
          <span className="ob-file-tag">PDF</span>
          <strong>{t('onboarding.demo.files.pdf')}</strong>
          <div className="ob-file-bars">
            <span />
            <span />
            <span />
            <span />
          </div>
        </div>
        <div className="ob-files-item ob-file-note" data-extension="md">
          <span className="ob-file-tag">MD</span>
          <strong># {t('onboarding.demo.files.note')}</strong>
          <div className="ob-file-lines">
            <span />
            <span />
            <span />
          </div>
        </div>
        <div className="ob-files-item ob-file-word" data-extension="docx">
          <span className="ob-file-tag">Word</span>
          <strong>{t('onboarding.demo.files.word')}</strong>
          <div className="ob-file-lines">
            <span />
            <span />
            <span />
          </div>
        </div>
      </div>
    </div>
  )
}
