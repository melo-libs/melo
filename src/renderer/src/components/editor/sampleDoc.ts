/**
 * Sample document for visual restoration: metadata, open tabs, and the
 * editor's initial HTML content. Mirrors the data model in
 * architecture.md (note with frontmatter-style meta).
 */
export interface DocMeta {
  path: string
  created: string
  updated: string
  words: number
  reading: string
  tags: string[]
}

/** Block / node types the editor can produce (used by the overlay
 *  "turn into" / insert logic). Callout / toggle intentionally absent. */
export type BlockType =
  | 'h1'
  | 'h2'
  | 'h3'
  | 'p'
  | 'quote'
  | 'bullet'
  | 'num'
  | 'task'
  | 'code'
  | 'image'
  | 'divider'

export interface SampleDoc {
  title: string
  subtitle: string
  meta: DocMeta
  html: string
}

// Decorative gradient placeholder for the sample image (no remote assets).
const SAMPLE_IMG =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 360 200'>" +
  "<defs><linearGradient id='g' x1='0' x2='1' y1='0' y2='1'>" +
  "<stop offset='0' stop-color='%23F4D88A'/><stop offset='1' stop-color='%23E8B560'/>" +
  "</linearGradient></defs><rect width='360' height='200' fill='url(%23g)'/>" +
  "<path d='M 0 140 Q 90 110 180 130 T 360 120 L 360 200 L 0 200 Z' fill='rgba(255,255,255,0.18)'/>" +
  "<path d='M 0 165 Q 90 145 180 158 T 360 152 L 360 200 L 0 200 Z' fill='rgba(255,255,255,0.22)'/></svg>"

export const SAMPLE_DOC: SampleDoc = {
  title: 'The CODE Method',
  subtitle: 'Notes from Tiago Forte — a workflow for turning scattered information into leverage.',
  meta: {
    path: '~/Melo Workspace/Second Brain/The CODE Method.md',
    created: 'Apr 18, 2026',
    updated: 'Apr 22, 2026 · 14:32',
    words: 842,
    reading: '4 min',
    tags: ['second-brain', 'method', 'knowledge'],
  },
  // Title = first H1, subtitle = the lede paragraph after it; both are
  // editable document content. Callout (b2) degraded to a paragraph;
  // toggle (b13) degraded to a heading + paragraph.
  html: `
<h1>The CODE Method</h1>
<p>Notes from Tiago Forte — a workflow for turning scattered information into leverage.</p>
<p>A <strong>second brain</strong> is not an app. It is the practice of outsourcing memory so that attention can be spent on thinking, not remembering. CODE names the four motions that make this possible.</p>
<p><strong>CODE</strong> stands for <strong>Collect</strong>, <strong>Organize</strong>, <strong>Distill</strong>, <strong>Express</strong> — four verbs, practiced in a loop, not in sequence.</p>
<h2>Collect</h2>
<p>Capture what resonates, not what seems important. Importance is a judgement the future will make; resonance is a signal only the present can give.</p>
<blockquote><p>If you notice yourself writing the same idea twice, it is already worth keeping.</p></blockquote>
<h2>Organize</h2>
<p>Organize for <em>action</em>, not for taxonomy. A perfect classification that nobody opens is a museum. Sort by the project you will use it in — or do not sort at all. How this composes with PARA lives in <a class="wikilink" data-note="PARA vs CODE" data-label="PARA vs CODE"></a>.</p>
<ul>
<li>One workspace, many folders — mirror the filesystem you already use.</li>
<li>Keep a <code>00 Inbox</code> folder for anything undecided.</li>
<li>Move, do not refile. Items migrate toward where they are needed.</li>
</ul>
<h2>Distill</h2>
<p>Highlight the 10% of each note that would rescue the other 90% if it were lost. Then highlight 10% of that. Notes become denser; reading becomes faster.</p>
<h3>Progressive summarization — the four layers</h3>
<p>Layer 1 is the full note. Layer 2 is <strong>bolded sentences</strong>. Layer 3 is <mark>highlighted phrases inside the bold</mark>. Layer 4 is an executive summary at the top. Most notes never need all four — only the ones you return to. The full technique lives in <a class="wikilink" data-note="Progressive Summarization" data-label="Progressive Summarization"></a>.</p>
<h2>Express</h2>
<p>The final motion closes the loop: ship something small, publicly if possible. Expression turns a private archive into feedback, and feedback is what teaches the archive to grow usefully.</p>
<ul data-type="taskList">
<li data-type="taskItem" data-checked="true">Pick one note from this week and turn it into a 200-word post.</li>
<li data-type="taskItem" data-checked="true">Share it with two people who asked about the topic.</li>
<li data-type="taskItem" data-checked="false">Log what they said in the same note.</li>
<li data-type="taskItem" data-checked="false">Revisit in 30 days. Re-distill if needed.</li>
</ul>
<h2>A practical rhythm</h2>
<p>CODE is not a weekly ritual. It runs at different speeds: Collect happens every day, Organize happens in the margins, Distill happens on re-read, Express happens when a project demands it. The only rule is to keep the loop moving — the <a class="wikilink wikilink-new" data-note="Weekly Review" data-label="Weekly Review"></a> note will hold the checklist once it exists.</p>
<pre><code class="language-bash"># a minimal folder layout
~/Melo Workspace/
├── 00 Inbox/
├── Second Brain/
│   ├── Captures/        # raw highlights
│   └── Distilled/       # progressive summaries
├── Projects/
└── Journal/</code></pre>
<hr>
<img src="${SAMPLE_IMG}" alt="The CODE loop, shown as a cycle rather than a pipeline.">
<h3>Further reading</h3>
<ul>
<li>Tiago Forte — <a class="wikilink" data-note="Building a Second Brain" data-label="Building a Second Brain"></a> (2022)</li>
<li>Sönke Ahrens — <a class="wikilink" data-note="How to Take Smart Notes" data-label="How to Take Smart Notes"></a> (2017)</li>
</ul>
`,
}

export interface EditorTab {
  id: string
  title: string
  path: string
  dirty: boolean
}

export const SAMPLE_TABS: EditorTab[] = [
  {
    id: 'doc-code',
    title: 'The CODE Method',
    path: 'Second Brain/The CODE Method.md',
    dirty: false,
  },
  { id: 'p2', title: 'Editor redesign', path: 'Projects/Editor redesign.md', dirty: true },
  { id: 'doc-para', title: 'PARA vs CODE', path: 'Second Brain/PARA vs CODE.md', dirty: false },
  { id: 'ideas', title: 'Ideas', path: 'Ideas.md', dirty: false },
]
