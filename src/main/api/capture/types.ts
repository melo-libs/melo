/**
 * SiteAdapter — the extension point for platform-specific capture.
 *
 * Each adapter describes how to fetch and extract content from a class of
 * URLs (a host, a pattern, etc.). The pipeline walks the adapter registry
 * in order and uses the first match; the default adapter always matches.
 *
 * All methods are optional except `match`. Omitted methods fall through to
 * the default behavior (standard fetch, Readability extraction, etc.).
 */
export interface SiteAdapter {
  /** Human-readable name shown in debug / future plugin UI. */
  name: string

  /** Return true if this adapter should handle the URL. */
  match(url: URL): boolean

  /** Extra headers to send with the initial HTML fetch. */
  fetchHeaders?(url: URL): Record<string, string>

  /** Extra headers to send when downloading images from this source. */
  imageHeaders?(pageUrl: URL): Record<string, string>

  /**
   * Rewrite raw HTML before Readability runs.
   * Use cases: un-hiding JS-gated content, promoting data-src to src,
   * stripping cookie banners, etc.
   */
  preprocessHtml?(html: string, url: URL): string

  /** Clean up the Readability-extracted title for this site. */
  cleanTitle?(title: string, url: URL): string
}
