/* KaTeX woff2 fonts as data URIs (vite `?inline`), loaded lazily —
   only an export of a document that actually contains math pays for
   this chunk. Used to make exported HTML/PDF fully self-contained:
   the raw katex.min.css references url(fonts/…) that would 404 in a
   standalone file. */

import AMS_Regular from 'katex/dist/fonts/KaTeX_AMS-Regular.woff2?inline'
import Caligraphic_Bold from 'katex/dist/fonts/KaTeX_Caligraphic-Bold.woff2?inline'
import Caligraphic_Regular from 'katex/dist/fonts/KaTeX_Caligraphic-Regular.woff2?inline'
import Fraktur_Bold from 'katex/dist/fonts/KaTeX_Fraktur-Bold.woff2?inline'
import Fraktur_Regular from 'katex/dist/fonts/KaTeX_Fraktur-Regular.woff2?inline'
import Main_Bold from 'katex/dist/fonts/KaTeX_Main-Bold.woff2?inline'
import Main_BoldItalic from 'katex/dist/fonts/KaTeX_Main-BoldItalic.woff2?inline'
import Main_Italic from 'katex/dist/fonts/KaTeX_Main-Italic.woff2?inline'
import Main_Regular from 'katex/dist/fonts/KaTeX_Main-Regular.woff2?inline'
import Math_BoldItalic from 'katex/dist/fonts/KaTeX_Math-BoldItalic.woff2?inline'
import Math_Italic from 'katex/dist/fonts/KaTeX_Math-Italic.woff2?inline'
import SansSerif_Bold from 'katex/dist/fonts/KaTeX_SansSerif-Bold.woff2?inline'
import SansSerif_Italic from 'katex/dist/fonts/KaTeX_SansSerif-Italic.woff2?inline'
import SansSerif_Regular from 'katex/dist/fonts/KaTeX_SansSerif-Regular.woff2?inline'
import Script_Regular from 'katex/dist/fonts/KaTeX_Script-Regular.woff2?inline'
import Size1_Regular from 'katex/dist/fonts/KaTeX_Size1-Regular.woff2?inline'
import Size2_Regular from 'katex/dist/fonts/KaTeX_Size2-Regular.woff2?inline'
import Size3_Regular from 'katex/dist/fonts/KaTeX_Size3-Regular.woff2?inline'
import Size4_Regular from 'katex/dist/fonts/KaTeX_Size4-Regular.woff2?inline'
import Typewriter_Regular from 'katex/dist/fonts/KaTeX_Typewriter-Regular.woff2?inline'

const FONTS: Record<string, string> = {
  'KaTeX_AMS-Regular': AMS_Regular,
  'KaTeX_Caligraphic-Bold': Caligraphic_Bold,
  'KaTeX_Caligraphic-Regular': Caligraphic_Regular,
  'KaTeX_Fraktur-Bold': Fraktur_Bold,
  'KaTeX_Fraktur-Regular': Fraktur_Regular,
  'KaTeX_Main-Bold': Main_Bold,
  'KaTeX_Main-BoldItalic': Main_BoldItalic,
  'KaTeX_Main-Italic': Main_Italic,
  'KaTeX_Main-Regular': Main_Regular,
  'KaTeX_Math-BoldItalic': Math_BoldItalic,
  'KaTeX_Math-Italic': Math_Italic,
  'KaTeX_SansSerif-Bold': SansSerif_Bold,
  'KaTeX_SansSerif-Italic': SansSerif_Italic,
  'KaTeX_SansSerif-Regular': SansSerif_Regular,
  'KaTeX_Script-Regular': Script_Regular,
  'KaTeX_Size1-Regular': Size1_Regular,
  'KaTeX_Size2-Regular': Size2_Regular,
  'KaTeX_Size3-Regular': Size3_Regular,
  'KaTeX_Size4-Regular': Size4_Regular,
  'KaTeX_Typewriter-Regular': Typewriter_Regular,
}

/** Rewrite the woff2 sources in katex.min.css to embedded data URIs.
 *  Chromium picks the first supported source, so the remaining woff/ttf
 *  references are never fetched. */
export function embedKatexFonts(css: string): string {
  return css.replace(/url\(fonts\/(KaTeX_[A-Za-z0-9-]+)\.woff2\)/g, (full, name: string) =>
    FONTS[name] ? `url(${FONTS[name]})` : full,
  )
}
