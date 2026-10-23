import { Trans, useTranslation } from 'react-i18next'
import { Icon } from '../Icon'
import {
  COLLECT_ARTICLE_URL,
  COLLECT_SOURCES,
  type CollectSource,
  type CollectSourceId,
} from './collectSources'
import type { TourFeature } from './tour'
import { OrganizeArtwork } from './OrganizeArtwork'
import { EditorArtwork } from './EditorArtwork'
import { FilesArtwork } from './FilesArtwork'
// Original figure from the article, bundled so the demo stays offline:
// https://www-cdn.anthropic.com/images/4zrzovbb/website/5c0c0e9fe4def0b584c04d37849941da55e5e71c-2401x1000.png
import routingDiagram from '../../assets/onboarding/anthropic-routing.png'

function SourceMark({ source }: { source: CollectSourceId }) {
  if (source === 'anthropic')
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
        <path d="M1 20 8 4h3l7 16h-3L9.5 7.5 4 20Zm5-6h7v2H6ZM20 4h3v16h-3Z" />
      </svg>
    )
  if (source === 'wechat')
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M10 3C4.8 3 1 6.2 1 10.1c0 2.2 1.3 4.2 3.4 5.5l-.8 2.6 3-1.5c1 .3 2 .5 3.1.5-.3-.8-.5-1.6-.5-2.5 0-3.9 3.8-7 8.5-7h.1C16.5 4.9 13.5 3 10 3Z"
          fill="currentColor"
        />
        <path
          d="M17.7 9.1c-4 0-7.1 2.5-7.1 5.6s3.1 5.6 7.1 5.6c.8 0 1.6-.1 2.4-.3l2.4 1.2-.6-2.1c1.8-1 2.8-2.6 2.8-4.4 0-3.1-3.1-5.6-7-5.6Z"
          fill="currentColor"
        />
        <circle cx="6.7" cy="8.7" r="1" fill="var(--paper)" />
        <circle cx="12.7" cy="8.7" r="1" fill="var(--paper)" />
        <circle cx="15.2" cy="13.8" r=".8" fill="var(--paper)" />
        <circle cx="20.2" cy="13.8" r=".8" fill="var(--paper)" />
      </svg>
    )
  if (source === 'substack')
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
        <path d="M3 2h18v2H3zm0 5h18v2H3zm0 5h18v11l-9-5-9 5Z" />
      </svg>
    )
  return <span className="ob-source-monogram">{source === 'zhihu' ? '知' : 'M'}</span>
}

function SourceHint({ source }: { source: CollectSource }) {
  return (
    <span className={`ob-source-hint ob-source-${source.id}`} data-source={source.id}>
      <span className="ob-source-mark">
        <SourceMark source={source.id} />
      </span>
      <span>{source.name}</span>
    </span>
  )
}

function CapturePalette({
  sources,
  modifier,
}: {
  sources: readonly CollectSource[]
  modifier: string
}) {
  const { t } = useTranslation()
  const source = sources[0]
  // A condensed illustration of SearchPalette's URL mode, not a live input:
  // onboarding has no workspace and must never invoke capture or steal focus.
  return (
    <div className="ob-clip-palette ob-sheet">
      <div className="ob-clip-field">
        <Icon name="search" size={18} />
        <div className="ob-clip-query">
          <span className="ob-clip-url">{COLLECT_ARTICLE_URL}</span>
        </div>
        <kbd>{modifier}K</kbd>
      </div>
      <div className="ob-clip-body">
        <div className="ob-clip-link">
          <span className="ob-clip-publisher">
            <SourceMark source={source.id} />
          </span>
          <div>
            <span className="ob-clip-domain">{source.host}</span>
            <strong>{t('onboarding.demo.articleTitle')}</strong>
          </div>
        </div>
        <div className="ob-clip-actions">
          <div className="ob-clip-save">
            <span>
              <Trans
                i18nKey="clip.saveTo"
                values={{ dest: t('smartVals.Inbox') }}
                components={{ b: <b /> }}
              />
            </span>
            <Icon name="enter" size={14} />
          </div>
        </div>
      </div>
      <div className="ob-source-hints">
        {/* These are recognizable examples, not an exhaustive platform list. */}
        <span className="ob-source-label">{t('onboarding.demo.sourceExamples')}</span>
        {sources.map((item) => (
          <SourceHint source={item} key={item.id} />
        ))}
        <span className="ob-source-more">…</span>
      </div>
    </div>
  )
}

function ArticlePreview() {
  const { t } = useTranslation()
  return (
    <div className="ob-sheet ob-article ob-captured">
      <div className="ob-article-heading">
        <span className="ob-md-label">.md</span>
        <span className="ob-capture-status">
          <Icon name="tick" size={12} />
          {t('onboarding.features.collect.result')}
        </span>
      </div>
      <h2>{t('onboarding.demo.articleTitle')}</h2>
      <p className="ob-article-byline">{t('onboarding.demo.articleByline')}</p>
      <div className="ob-article-reading">
        <p className="ob-article-excerpt">{t('onboarding.demo.articleExcerpt')}</p>
        <figure className="ob-article-figure">
          <img
            src={routingDiagram}
            alt={t('onboarding.demo.articleImageAlt')}
            width={2401}
            height={1000}
            draggable={false}
          />
          <figcaption>{t('onboarding.demo.articleSection')}</figcaption>
        </figure>
      </div>
    </div>
  )
}

export function TourArtwork({ feature, modifier }: { feature: TourFeature; modifier: string }) {
  const { t, i18n } = useTranslation()
  const sources =
    COLLECT_SOURCES[(i18n.resolvedLanguage ?? i18n.language).startsWith('zh') ? 'zh-CN' : 'en']
  if (feature === 'collect')
    return (
      <div className="ob-art-scene ob-collect-art">
        <div className="ob-collect-input">
          <CapturePalette sources={sources} modifier={modifier} />
        </div>
        <Icon className="ob-collect-arrow" name="arrowRight" size={24} />
        <ArticlePreview />
      </div>
    )
  if (feature === 'organize') return <OrganizeArtwork modifier={modifier} />
  if (feature === 'distill') return <EditorArtwork />
  if (feature === 'files') return <FilesArtwork />
  return (
    <div className="ob-art-scene ob-express-art">
      <div className="ob-share-paper ob-sheet">
        <span>“</span>
        <p>{t('onboarding.demo.shortThought')}</p>
        <small>{t('onboarding.demo.noteTitle')}</small>
      </div>
      <div className="ob-share-ink">
        <span>“</span>
        <small className="ob-share-watermark">MELO</small>
        <p>{t('onboarding.demo.shareThought')}</p>
        <footer>{t('onboarding.demo.noteTitle')}</footer>
      </div>
      <div className="ob-chat-preview">
        <div>
          <span>“</span>
          <p>{t('onboarding.demo.shareThought')}</p>
        </div>
        <small>{t('onboarding.features.express.result')}</small>
      </div>
    </div>
  )
}
