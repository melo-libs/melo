import katex from 'katex'
import { useTranslation } from 'react-i18next'
import { Icon } from '../Icon'
import 'katex/dist/katex.min.css'

// A fixed, local example: no user-supplied TeX or editor instance enters the onboarding demo.
const NORMAL_DENSITY = katex.renderToString(
  String.raw`f(x)=\frac{1}{\sigma\sqrt{2\pi}}\,e^{-\frac{(x-\mu)^2}{2\sigma^2}}`,
  { displayMode: true, throwOnError: true, trust: false },
)
const CURVE_POINTS = Array.from({ length: 81 }, (_, index) => {
  const x = 20 + index * 3
  const y = 106 - 78 * Math.exp(-(((x - 140) / 35) ** 2) / 2)
  return `${x},${y.toFixed(2)}`
}).join(' ')

export function EditorArtwork() {
  const { t } = useTranslation()
  return (
    <div className="ob-art-scene ob-editor-art">
      <div className="ob-editor-document ob-sheet">
        <div className="ob-editor-toolbar">
          <Icon name="fileMd" size={14} />
          <span>{t('onboarding.demo.editor.title')}.md</span>
          <span className="ob-editor-save" data-status="saved">
            {t('onboarding.demo.saved')}
          </span>
          <Icon name="moreH" size={16} />
        </div>
        <div className="ob-editor-content">
          <div className="ob-editor-main">
            <h2>{t('onboarding.demo.editor.title')}</h2>
            <p className="ob-editor-lead">
              {t('onboarding.demo.editor.lead')}
              <mark>{t('onboarding.demo.editor.highlight')}</mark>
              {t('onboarding.demo.editor.end')}
            </p>
            <div
              className="ob-editor-equation"
              dangerouslySetInnerHTML={{ __html: NORMAL_DENSITY }}
            />
            <table className="ob-editor-table">
              <thead>
                <tr>
                  <th>{t('onboarding.demo.editor.parameter')}</th>
                  <th>{t('onboarding.demo.editor.value')}</th>
                  <th>{t('onboarding.demo.editor.meaning')}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>μ</td>
                  <td>0</td>
                  <td>{t('onboarding.demo.editor.mean')}</td>
                </tr>
                <tr>
                  <td>σ</td>
                  <td>1</td>
                  <td>{t('onboarding.demo.editor.deviation')}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="ob-editor-supporting">
            <figure className="ob-editor-figure">
              <svg
                viewBox="0 0 280 132"
                role="img"
                aria-label={t('onboarding.demo.editor.imageAlt')}
              >
                <polygon
                  className="ob-editor-curve-area"
                  points={`20,106 ${CURVE_POINTS} 260,106`}
                />
                <path className="ob-editor-axis" d="M16 106H264M140 20V106" />
                <polyline className="ob-editor-curve" points={CURVE_POINTS} />
                <g className="ob-editor-axis-labels" textAnchor="middle">
                  <text x="70" y="124">
                    −2σ
                  </text>
                  <text x="140" y="124">
                    μ
                  </text>
                  <text x="210" y="124">
                    2σ
                  </text>
                </g>
              </svg>
              <figcaption>{t('onboarding.demo.editor.figureCaption')}</figcaption>
            </figure>
            <div className="ob-editor-code">
              <span className="ob-editor-code-language">Python</span>
              <pre>
                <code>
                  <span className="ob-editor-keyword">from</span>
                  {' math '}
                  <span className="ob-editor-keyword">import</span>
                  {' exp, pi, sqrt\nx = '}
                  <span className="ob-editor-number">0</span>
                  {'\nf = exp(-x**'}
                  <span className="ob-editor-number">2</span>
                  {' / '}
                  <span className="ob-editor-number">2</span>
                  {') / sqrt('}
                  <span className="ob-editor-number">2</span>
                  {'*pi)'}
                </code>
              </pre>
            </div>
            <ul className="ob-editor-checklist">
              <li>
                <span className="ob-editor-checkbox" />
                {t('onboarding.demo.editor.task')}
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
