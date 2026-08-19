/**
 * Lakshmimata Help & Guide — single source for the Help modal (short)
 * and the full Docs page (detailed, newcomer-friendly).
 */

export const DOCS_CATEGORIES = [
  { id: 'start', label: 'Getting started', emoji: '👋' },
  { id: 'scanners', label: 'Scanners', emoji: '📡' },
  { id: 'market', label: 'Market & rotation', emoji: '🌐' },
  { id: 'research', label: 'Research & filings', emoji: '📰' },
  { id: 'chart', label: 'Chart & indicators', emoji: '📈' },
  { id: 'workspace', label: 'Your workspace', emoji: '🧰' },
]

/** @typedef {{ heading: string, body?: string, bullets?: string[] }} DocSection */
/** @typedef {{
 *   id: string,
 *   title: string,
 *   category: string,
 *   tabId?: string,
 *   summary: string,
 *   forNewcomers: string,
 *   sections: DocSection[],
 * }} DocArticle */

/** @type {DocArticle[]} */
export const DOCS_ARTICLES = [
  // ── Getting started ───────────────────────────────────────────────
  {
    id: 'start-overview',
    title: 'What is Lakshmimata?',
    category: 'start',
    summary:
      'A research scanner for Indian equities: Relative Strength, patterns, Squeeze Pro, market breadth, and filings — not a broker and not buy/sell advice.',
    forNewcomers:
      'Think of Lakshmimata as a map of the NSE market. It ranks stocks by Relative Strength (who is leading), highlights setups (squeezes, breakouts, stages), and pulls Results / Concall / PPT under each chart so you can research faster. Nothing here is a buy or sell order — you decide.',
    sections: [
      {
        heading: 'The five things you will use most',
        bullets: [
          'RS Rating — every stock ranked 1–99 vs the market (higher = stronger tape).',
          'Our Chart — open any row to see price, Lakshmi Mata indicators, Volume, Super Cycle.',
          'Squeeze Pro — find stocks coiled tightly before a possible expansion move.',
          'Market / Rotation — see if the market and sectors are healthy or rolling over.',
          'Announcements — Results, Concall, and PPT summaries under the chart.',
        ],
      },
      {
        heading: 'How a typical first session looks',
        bullets: [
          '1. Open RS Rating and sort or filter (index, sector, signal chips).',
          '2. Tap a stock name → Our Chart opens (or hover the name if chart-on-hover is on).',
          '3. Under the chart, check Results quality, then Concall / PPT if badges are green.',
          '4. Save interesting names to a Watchlist; revisit Squeeze / Patterns for setups.',
          '5. Use Ask Guide (?) anytime — free, no AI cost — or open this full Guide page.',
        ],
      },
      {
        heading: 'Important mindset',
        bullets: [
          'Scanners find candidates; they do not replace your plan, risk rules, or judgment.',
          'Combine price/RS strength with fundamentals and filings — RS alone is not a buy call.',
          'Demo mode shows real historical-style data for learning; live account unlocks sync prefs and alerts.',
        ],
      },
    ],
  },
  {
    id: 'start-navigation',
    title: 'Finding your way around',
    category: 'start',
    summary:
      'Left icon sidebar (desktop) or bottom tabs + More (mobile). Header ? opens Help; this Guide is the deep version.',
    forNewcomers:
      'Every major tool is a tab. On desktop, icons sit on the left. On phones, the main five tabs are at the bottom and the rest live under More. The ? button in the header always opens Help + Ask Guide for the page you are on.',
    sections: [
      {
        heading: 'Desktop',
        bullets: [
          'Left rail: RS, Market, Rotate, Leaders, Patterns, Squeeze, 52WL, Weak, then Portfolio / Compare / Watchlist / News / Earnings / Themes / AI Picks / Feedback.',
          'Account (AC) sits at the bottom of the rail — plans, preferences, sign-out.',
          '🎨 floating button — theme and zoom only; feature toggles live under Account.',
        ],
      },
      {
        heading: 'Mobile',
        bullets: [
          'Bottom bar: RS, Market, Earnings, Rotate, Patterns, plus More.',
          'More sheet: Themes, AI Picks, News, Watchlist, Portfolio, Compare, 52WL, Leaders, Squeeze, Weak, Feedback, Account, and Guide.',
        ],
      },
      {
        heading: 'Header helpers',
        bullets: [
          '? — Help Center (Ask Guide + short page blurbs) and a link into this full Guide.',
          'Index / Watchlist dropdown — narrow any scanner to Nifty 50, Midcap, Smallcap, or a saved list.',
          'Layout menu (RS) — save column / chart dock layouts.',
        ],
      },
    ],
  },
  {
    id: 'start-glossary',
    title: 'Beginner glossary',
    category: 'start',
    summary: 'Plain meanings for RS, Stage, Squeeze, Pocket Pivot, Result quality, and more.',
    forNewcomers:
      'You do not need every jargon word on day one. Start with RS, Stage, and Result quality; add Squeeze and Pocket Pivot when you open those tabs.',
    sections: [
      {
        heading: 'Core terms',
        bullets: [
          'RS (Relative Strength) — rank 1–99 of how a stock’s price action compares to the whole market. 90+ is leadership territory; under 50 is lagging.',
          'Weinstein Stage — S1 base, S2 uptrend, S3 top, S4 downtrend. Many long setups prefer Stage 2.',
          'Squeeze — Bollinger Bands inside Keltner Channels = compressed volatility; often precedes a larger move.',
          'Pocket Pivot (PP) — strong up-day volume that beats recent down days; early accumulation clue.',
          'Result quality — Excellent / Good / Neutral / Weak for the latest reported quarter only (Sales & PAT YoY with margin checks). Not the same as the overall fundamental Rating.',
          'IBV — institutional-style buying volume: heavy volume with a strong close in the day’s range.',
          'RRG — Relative Rotation Graph: sectors/indices plotted by RS-Ratio vs RS-Momentum.',
        ],
      },
    ],
  },

  // ── Scanners ──────────────────────────────────────────────────────
  {
    id: 'rs',
    title: 'RS Rating',
    category: 'scanners',
    tabId: 'rs',
    summary:
      'The core scanner — every NSE stock ranked by Relative Strength (RS), 1–99, against the whole market. Filter by index, sector, RS trend, or signal chips. Tap a row for its chart and full signal breakdown.',
    forNewcomers:
      'This is home base. Each row is a stock; the RS number tells you who is outperforming the market. High RS does not mean “buy now” — it means the stock has been relatively strong. Use filters and signal chips to shrink the list, then open the chart.',
    sections: [
      {
        heading: 'How RS works',
        bullets: [
          'Price history is compared across the universe; each name gets a percentile rank from 1 (weakest) to 99 (strongest).',
          'RS can rise even if the market falls — it is relative, not absolute return.',
          'Combine RS with Stage, volume signals, and Results so you are not chasing empty strength.',
        ],
      },
      {
        heading: 'How to use the page',
        bullets: [
          'Filter by index (Nifty 50 / Midcap / Smallcap) or an active Watchlist from the header.',
          'Use signal chips (HT, HY, PP, VCP, etc.) — tap ℹ on filters for the signal glossary.',
          'Tap a symbol for Our Chart; hover the name (if enabled) to preview the full chart.',
          'Optional columns (Stage/Vol, Rating, Result) can be shown/hidden from the RS layout tools.',
        ],
      },
      {
        heading: 'Reading the row',
        bullets: [
          'Stage/Vol — Weinstein stage plus today’s volume vs a recent peak day (not a price).',
          'Rating — overall fundamental quality score (ROE, growth, debt, ownership) — not a price target.',
          'Result — latest-quarter quality only; can disagree with Rating.',
        ],
      },
    ],
  },
  {
    id: 'squeeze',
    title: 'Squeeze Pro',
    category: 'scanners',
    tabId: 'squeeze',
    summary:
      "John Carter's Squeeze Pro. High / Mid / Low compression tiers, days in coil, and ▲/▼ TTM momentum for long vs short bias. Sort longest, hardest coils to the top.",
    forNewcomers:
      'A “squeeze” means price has been quiet and coiled. Squeeze Pro grades how tight that coil is (High / Mid / Low), how many days it has lasted, and whether momentum currently leans long (▲) or short (▼). Long, High-compression coils with rising momentum are the setups most people watch first.',
    sections: [
      {
        heading: 'How it works (Carter / TTM idea)',
        bullets: [
          'Bollinger Bands (volatility envelope) are compared to three Keltner Channel widths (1.0, 1.5, 2.0 × ATR).',
          'High compression — BB inside the tightest (1.0) Keltner: hardest coil.',
          'Mid — classic TTM-style squeeze (inside 1.5).',
          'Low — mild compression (inside 2.0 only).',
          'Days — consecutive bars still in a squeeze; longer often means more stored energy.',
          'Momentum arrow — TTM histogram above zero → long bias; below → short bias. Direction of the break is not guaranteed.',
        ],
      },
      {
        heading: 'How to use the scanner',
        bullets: [
          'Filter by tier, momentum direction, and minimum days.',
          'Sort the Squeeze / VCP column to surface the longest High coils.',
          'Open the chart and enable Squeeze Pro dots under Indicators to see the same tiers on price.',
          'Confirm with RS, Stage, and volume — a squeeze in a Stage 4 downtrend is a different risk than Stage 2.',
        ],
      },
      {
        heading: 'On the chart',
        body: 'Squeeze Pro Dots paint under the candles by compression tier. They match the scanner logic so you can visually check duration and when the coil releases.',
      },
    ],
  },
  {
    id: 'patterns',
    title: 'Patterns',
    category: 'scanners',
    tabId: 'patterns',
    summary:
      'Breakouts, coiling (VCP / squeeze / cup), classic patterns, MA crossovers, and volume signals — each as its own list under section chips.',
    forNewcomers:
      'This tab groups chart patterns the scanner already detected. Start with Breakouts and Coiling. Classic H&S / triangles are heuristics — useful as a shortlist, not gospel.',
    sections: [
      {
        heading: 'Sections',
        bullets: [
          'Breakouts — HY/HT, resistance, 52W high, cup & handle, new Stage 2.',
          'Coiling — cup forming, Guppy compression, volatility squeeze, VCP contractions.',
          'Classic — Head & Shoulders, Double Top/Bottom, Triangles, Wedges, Flags (more false positives).',
          'MA Crossovers — Guppy-style bullish/bearish crosses.',
          'Volume — Pocket Pivot, RS line new high.',
        ],
      },
      {
        heading: 'How to use',
        bullets: [
          'Pick one chip at a time; export to TradingView or set alerts where available.',
          'Always open Our Chart to verify the shape with your own eyes.',
          'Pair volume-backed breakouts with RS ≥ ~60 when possible.',
        ],
      },
    ],
  },
  {
    id: 'leaders',
    title: 'Leaders',
    category: 'scanners',
    tabId: 'leaders',
    summary:
      'Leadership signals: RS Line New Highs, New Stage 2 Entries Today, and 52 Week High Stocks — each section exportable with alerts.',
    forNewcomers:
      'Leaders answers “who is in charge today?” Early leaders often show RS-line highs before everyone notices the price high. Stage 2 entries mark fresh confirmed uptrends.',
    sections: [
      {
        heading: 'Chips under the header',
        bullets: [
          'RS Line New Highs — relative-strength line (not just price) made a new high.',
          'New Stage 2 Entries Today — flipped into a confirmed Weinstein uptrend today.',
          '52 Week High Stocks — price leadership at fresh 52-week highs.',
        ],
      },
    ],
  },
  {
    id: '52wl',
    title: '52WL Crossover',
    category: 'scanners',
    tabId: '52wl',
    summary:
      'Stocks making new 52-week highs (potential breakouts) or sitting near 52-week lows (value or falling knives — check the trend).',
    forNewcomers:
      'Fresh 52-week highs can signal strength; near 52-week lows can be value or a trap. Always check Stage and RS before assuming either story.',
    sections: [
      {
        heading: 'How to use',
        bullets: [
          'Scan highs for momentum leadership; scan lows only with a clear mean-reversion or short plan.',
          'Open the chart — a high in Stage 2 with volume differs from a high into Stage 3 exhaustion.',
        ],
      },
    ],
  },
  {
    id: 'weak',
    title: 'Weak RS',
    category: 'scanners',
    tabId: 'weak',
    summary:
      'The inverse scanner — stocks with deteriorating relative strength, useful for avoiding laggards or for short-side / hedge ideas.',
    forNewcomers:
      'Use this to stay away from names that look “cheap” but keep underperforming, or to study risk in your portfolio. It is not a recommendation to short.',
    sections: [
      {
        heading: 'How to use',
        bullets: [
          'Filter big 1-day moves with weak RS — often distribution or forced selling.',
          'Cross-check holdings: if something you own appears here repeatedly, reassess.',
        ],
      },
    ],
  },

  // ── Market ────────────────────────────────────────────────────────
  {
    id: 'market',
    title: 'Market',
    category: 'market',
    tabId: 'market',
    summary:
      'Market-wide health: Overview, Indices, Sectors, Industries, Gaps, Smart Money — one chip at a time under the header.',
    forNewcomers:
      'Before hunting stocks, glance at Market. Breadth tells you if advances are healthy. Smart Money shows FII/DII flows. Gaps flag ≥2% open gaps.',
    sections: [
      {
        heading: 'Sub-pages',
        bullets: [
          'Overview — verdict, today’s breadth stats, A/D and EMA breadth history.',
          'Indices / Sectors / Industries — tables you can drill into.',
          'Gaps — opens of about 2% or more.',
          'Smart Money — daily FII/DII cash + quarterly sector holdings + PP/IBV momentum context.',
        ],
      },
      {
        heading: 'How it works',
        body: 'Breadth measures how many names participate in a move. A rising index on thin breadth is more fragile than one with broad advances. Tile “i” icons explain each metric.',
      },
    ],
  },
  {
    id: 'rotation',
    title: 'Sector Rotation',
    category: 'market',
    tabId: 'rotation',
    summary:
      'StockCharts-style RRG: Leading / Weakening / Lagging / Improving quadrants from JdK RS-Ratio and RS-Momentum (centered at 100).',
    forNewcomers:
      'The rotation chart shows where sectors or indices sit in the leadership cycle. Idealized path is clockwise: Improving → Leading → Weakening → Lagging → Improving.',
    sections: [
      {
        heading: 'How to read the axes',
        bullets: [
          'X = JdK RS-Ratio — trend of relative strength vs the market (100 = neutral).',
          'Y = JdK RS-Momentum — how fast that relative-strength trend is changing.',
          'Leading (+/+) strong and improving · Weakening (+/−) strong but fading · Lagging (−/−) weak · Improving (−/+) weak but turning up.',
        ],
      },
      {
        heading: 'How to use',
        bullets: [
          'Prefer hunting longs in Leading / Improving groups when your style is momentum.',
          'Trail length follows your Window chip; date slider rewinds history.',
          'Tap a node to drill into constituents.',
        ],
      },
    ],
  },

  // ── Research ──────────────────────────────────────────────────────
  {
    id: 'announcements',
    title: 'Announcements',
    category: 'research',
    tabId: 'announcements',
    summary:
      'Corporate filings feed — results, concalls, PPTs and other NSE announcements. Green badges under the chart mean reports are on file.',
    forNewcomers:
      'News here is filing-centric. Open a stock → Results / Concall / PPT tabs under Our Chart. Green badge = a summary already exists. Use History chips for older filings.',
    sections: [
      {
        heading: 'How to use',
        bullets: [
          'Filter the feed, then open symbols that matter to you.',
          'Results rating is latest-quarter quality — read the numbers before trusting the badge.',
          'Concall / PPT text is AI-assisted on the server; Ask Guide in Help does not call paid AI.',
        ],
      },
    ],
  },
  {
    id: 'themes',
    title: 'Emerging Themes',
    category: 'research',
    tabId: 'themes',
    summary:
      'Themes tagged from recent PPT/concall text (defence, data center, AI, etc.). Useful for thematic scans — not a buy signal alone.',
    forNewcomers:
      'Pick a theme to see which stocks mentioned it in filings. Treat it as an idea generator, then verify with RS and Results.',
    sections: [
      {
        heading: 'How it works',
        body: 'Server-side tagging of filing text into theme buckets. Mentions ≠ endorsement; companies name many topics.',
      },
    ],
  },
  {
    id: 'bestpicks',
    title: 'AI Picks',
    category: 'research',
    tabId: 'bestpicks',
    summary:
      'Curated shortlist from the server scan. Research further with RS, Results, and Concall/PPT — not automated advice.',
    forNewcomers:
      'A starting shortlist, not a portfolio. Open each name and apply the same checklist you use on RS Rating.',
    sections: [
      {
        heading: 'How to use',
        bullets: [
          'Review the list after market scans refresh.',
          'Reject names that fail your Stage / RS / Result rules.',
        ],
      },
    ],
  },
  {
    id: 'earnings',
    title: 'Earnings',
    category: 'research',
    tabId: 'earnings',
    summary:
      'Earnings-focused tracker for upcoming and recent results so you can prepare around result dates.',
    forNewcomers:
      'Use Earnings to see what is reporting soon. Pair with Announcements and the Results tab under the chart after numbers print.',
    sections: [
      {
        heading: 'How to use',
        bullets: [
          'Note dates for holdings and watchlist names.',
          'After results, open the stock → Results for quality badge and peers.',
        ],
      },
    ],
  },
  {
    id: 'chart',
    title: 'Stock chart & Results',
    category: 'chart',
    tabId: 'rs',
    summary:
      'Open any stock for Our Chart plus Results / Concall / PPT. Result quality is the latest quarter only. Peer pills under Results are clickable.',
    forNewcomers:
      'Our Chart is the main workspace for a single name. Indicators live under the fx / Indicators control. Below the chart: Results, Concall, PPT, and About for company context.',
    sections: [
      {
        heading: 'Opening a chart',
        bullets: [
          'Tap a symbol on any scanner, or search.',
          'Hover chart (Account preference) opens the real Our Chart on symbol hover — pin with a click; Esc or ✕ closes.',
          'Drawings, alerts, interval favorites, and indicator prefs sync when you are signed in.',
        ],
      },
      {
        heading: 'Under the chart',
        bullets: [
          'Results — quarter quality + peers in the same industry.',
          'Concall / PPT — summaries when available (green tab badge).',
          'About — company research panel for that symbol.',
        ],
      },
    ],
  },

  // ── Chart indicators (deep) ───────────────────────────────────────
  {
    id: 'ind-lakshmimata',
    title: 'Lakshmi Mata (parent study)',
    category: 'chart',
    summary:
      'Complete Pine-aligned study: EMA 9/21/50/150/200, GMMA, Squeeze Pro dots, S/R, Bollinger, Buy/Sell, UC/LC, volume signals — one parent toggle.',
    forNewcomers:
      'Lakshmi Mata is the main overlay pack. Turn it on once and you get the moving averages and signal layers that match the Pine study. Child pieces (Buy/Sell, Circuit, S/R, BB, Squeeze dots) can still be toggled inside the Indicators menu.',
    sections: [
      {
        heading: 'What turns on with the parent',
        bullets: [
          'EMAs 9, 21, 50, 150, 200 (Pine periods).',
          'Guppy / GMMA ribbon for trend compression/expansion.',
          'Squeeze Pro dots, Support/Resistance pivots, Bollinger Bands (BB default off in Pine).',
          'Buy/Sell markers, Circuit UC/LC bands, pattern / bar-color / Bull Snort helpers.',
        ],
      },
      {
        heading: 'How to use',
        bullets: [
          'Open Indicators → enable Lakshmi Mata.',
          'Use the gear on each child for parameters (lengths, visibility).',
          'Prefs sync to your account when signed in (versioned migration keeps older saves compatible).',
        ],
      },
    ],
  },
  {
    id: 'ind-ema-guppy',
    title: 'EMAs & Guppy (GMMA)',
    category: 'chart',
    summary: 'Fast and slow EMA groups show trend direction and whether the ribbon is expanding or compressing.',
    forNewcomers:
      'Short EMAs (9, 21) react quickly; long EMAs (50, 150, 200) show the bigger trend. When the Guppy ribbon compresses, volatility often contracts; when it fans out, trend is asserting.',
    sections: [
      {
        heading: 'How it works',
        bullets: [
          'Each EMA is an exponential moving average of close over N days.',
          'Price above rising longer EMAs generally supports Stage 2-style trends.',
          'Guppy compression often appears near squeezes and VCPs.',
        ],
      },
      {
        heading: 'How to use',
        bullets: [
          'Pullbacks toward 9/21 in an uptrend are common “dip” zones for momentum styles.',
          'Do not treat a single EMA touch as a signal without volume and RS context.',
        ],
      },
    ],
  },
  {
    id: 'ind-bb',
    title: 'Bollinger Bands',
    category: 'chart',
    summary: 'SMA 20 ± 2 standard deviations — volatility envelope used with Keltner for Squeeze Pro.',
    forNewcomers:
      'Bands widen when the stock is volatile and tighten when it is quiet. A quiet, tight band is often the calm before a larger move — that is why squeezes matter.',
    sections: [
      {
        heading: 'How it works',
        bullets: [
          'Middle = 20-day simple moving average of close.',
          'Upper / lower = middle ± 2 × standard deviation of close.',
          'Default in the Pine pack is often off until you enable it under Lakshmi Mata children.',
        ],
      },
    ],
  },
  {
    id: 'ind-sr',
    title: 'Support & Resistance',
    category: 'chart',
    summary: 'Pivot-based support and resistance levels from left/right bar pivots (Pine-aligned).',
    forNewcomers:
      'Horizontal lines mark areas where price previously stalled. Breaks with volume matter more than lines alone.',
    sections: [
      {
        heading: 'How it works',
        bullets: [
          'Pivots need enough bars left and right to confirm a swing high/low.',
          'Levels can be retested; failed breaks often reverse back into the range.',
        ],
      },
    ],
  },
  {
    id: 'ind-buysell',
    title: 'Buy / Sell markers',
    category: 'chart',
    summary: 'Rule-based markers from the Lakshmi Mata Pine logic — visual cues, not auto-orders.',
    forNewcomers:
      'Markers highlight where the study’s conditions fired. Treat them as prompts to look closer, not as automatic trade instructions.',
    sections: [
      {
        heading: 'How to use',
        bullets: [
          'Enable under Lakshmi Mata / Signals.',
          'Confirm with RS, Stage, Squeeze state, and your risk plan before acting.',
        ],
      },
    ],
  },
  {
    id: 'ind-circuit',
    title: 'Circuit bands (UC / LC)',
    category: 'chart',
    summary:
      'Upper/Lower circuit style bands. Auto-detects likely circuit % from genuine lock days when possible; default on in the Pine pack.',
    forNewcomers:
      'Indian stocks can hit upper or lower circuit limits. These bands sketch where a lock might sit based on detected or configured percentages so you see proximity to a freeze.',
    sections: [
      {
        heading: 'How it works',
        bullets: [
          'Looks at historical lock-style sessions to infer a common circuit percentage when possible.',
          'Bands are approximate research overlays — exchange rules and series types can differ.',
        ],
      },
    ],
  },
  {
    id: 'ind-volume',
    title: 'Lakshmi Volume',
    category: 'chart',
    summary:
      'Volume study highlighting unusual activity, climax / dry-up context, and related Lakshmi volume metrics under the chart.',
    forNewcomers:
      'Price without volume is half the story. Lakshmi Volume flags heavy or drying volume so breakouts and squeezes can be judged for participation.',
    sections: [
      {
        heading: 'How to use',
        bullets: [
          'Enable Lakshmi Volume as its own study (separate from the parent when listed alone).',
          'Compare today’s bar to recent average — HY/HT/IBV/Bull Snort on scanners use related ideas.',
          'Rising price on falling volume into resistance is a caution; expansion on rising volume is healthier for momentum.',
        ],
      },
    ],
  },
  {
    id: 'ind-supercycle',
    title: 'Lakshmi Super Cycle',
    category: 'chart',
    summary:
      'Oscillator-style RS cycle vs the index — needs a stock (not an index). Helps see relative-strength swings over time.',
    forNewcomers:
      'Super Cycle looks at how the stock’s relative strength is cycling against its benchmark. Use it to see whether RS leadership is warming up or cooling off — not as a standalone timer.',
    sections: [
      {
        heading: 'How it works',
        bullets: [
          'Built from relative strength vs the index, so it will not run on pure index charts.',
          'Turns in the oscillator often align with RS line behaviour on Leaders / RS history.',
        ],
      },
      {
        heading: 'How to use',
        bullets: [
          'Enable under Oscillators on a stock chart.',
          'Combine with Stage and Squeeze — a Super Cycle upturn inside High compression can be more interesting than either alone.',
        ],
      },
    ],
  },
  {
    id: 'ind-signals-glossary',
    title: 'Scanner signal chips (HT, HY, PP…)',
    category: 'chart',
    summary: 'Meanings of HT, HY, IBV, Pocket Pivot, VCP, EMA dip chips, and related RS filter badges.',
    forNewcomers:
      'On RS Rating filters, chips mark volume and pattern events. Open the ℹ glossary on that page anytime — this article mirrors the same ideas in Guide form.',
    sections: [
      {
        heading: 'Volume & accumulation',
        bullets: [
          'HT — High Turnover: volume near all-time highs on an up day.',
          'HY — High Yield volume: volume near 52-week highs on an up day.',
          'IBV — Institutional-style Buying Volume: heavy volume + strong close in the day’s range.',
          'PP — Pocket Pivot: up day volume beats every down day in ~10 days while price stays constructive.',
          'Bull Snort — up close, volume ≥ 2× 20-day average, close in upper ~30% of the range.',
        ],
      },
      {
        heading: 'Setups & structure',
        bullets: [
          'VCP 2T/3T/4T — Volatility Contraction Pattern with 2–4 contractions.',
          'EMA5/9/21/50 chips — pullback within ~3% of that average for high-RS names.',
          'Power — Pocket Pivot plus RS ≥ 80.',
          'R1 / Cup breakouts — price clearing defined resistance or cup pattern (algorithmic).',
        ],
      },
    ],
  },

  // ── Workspace ─────────────────────────────────────────────────────
  {
    id: 'watchlist',
    title: 'Watchlist',
    category: 'workspace',
    tabId: 'watchlist',
    summary:
      'Saved stock lists. Set one as active from the header dropdown on any scanner to filter that tab to just your list.',
    forNewcomers:
      'Build lists (swing candidates, results week, etc.). Activate a list from the header on RS / Squeeze / Patterns so those pages only show your names.',
    sections: [
      {
        heading: 'How to use',
        bullets: [
          'Create and edit lists on the Watchlist tab.',
          'Header select → Watchlists group → pick wl:… to filter.',
          'Clear by choosing an index or All stocks again.',
        ],
      },
    ],
  },
  {
    id: 'portfolio',
    title: 'Portfolio',
    category: 'workspace',
    tabId: 'portfolio',
    summary:
      'Track up to 5 family portfolios against RS and stage, with a trade journal per position.',
    forNewcomers:
      'Log holdings so you can see if something you own is quietly weakening on RS or Stage — not just whether today’s P&L is green.',
    sections: [
      {
        heading: 'How to use',
        bullets: [
          'Create a portfolio, add symbols and notes.',
          'Use the journal when you enter or exit so later reviews are honest.',
        ],
      },
    ],
  },
  {
    id: 'compare',
    title: 'Compare',
    category: 'workspace',
    tabId: 'compare',
    summary: 'Side-by-side metrics across RS, fundamentals, stage, and signals for a few candidates.',
    forNewcomers:
      'When two or three names look similar, Compare lines them up so differences in RS, Stage, and Results are obvious.',
    sections: [
      {
        heading: 'How to use',
        bullets: [
          'Add symbols (URL can also carry ?compare=A,B,C).',
          'Prefer the one that wins on your written checklist, not on a single column.',
        ],
      },
    ],
  },
  {
    id: 'feedback',
    title: 'User Feedback',
    category: 'workspace',
    tabId: 'feedback',
    summary: 'Rate Lakshmimata 1–5 stars and leave a short review. Home shows averages and public quotes.',
    forNewcomers: 'Tell us what helps or confuses you — especially as a newcomer. Short, specific notes are gold.',
    sections: [
      {
        heading: 'How to use',
        body: 'Open User Feedback, pick stars, write a few lines. First name only appears on public quotes.',
      },
    ],
  },
  {
    id: 'settings',
    title: 'Account / Settings',
    category: 'workspace',
    tabId: 'settings',
    summary:
      'App Preferences (ticker, chart-on-hover, Overview, ambient), account, plans, sign-out. Theme & zoom also on the 🎨 button.',
    forNewcomers:
      'Turn on chart-on-hover if you want the full Our Chart when you hover a symbol. Theme and zoom are under 🎨; everything else lives here.',
    sections: [
      {
        heading: 'Useful preferences',
        bullets: [
          'Hover chart / Our Chart — preview without leaving the scanner.',
          'Ticker — market strip on/off.',
          'Plans & billing — upgrade when your trial ends.',
        ],
      },
    ],
  },
]

/** Short accordion entries for the Help modal (and Ask Guide fallbacks). */
export const HELP_CONTENT = DOCS_ARTICLES.filter(
  (a) =>
    a.tabId ||
    ['chart', 'settings', 'feedback', 'watchlist', 'portfolio', 'compare', 'announcements', 'themes', 'bestpicks'].includes(
      a.id,
    ),
)
  .filter((a, i, arr) => arr.findIndex((x) => x.id === a.id) === i)
  .map(({ id, title, summary }) => ({ id, title, body: summary }))

/** Ensure every mainTab that previously had help still has a row. */
const HELP_ORDER = [
  'rs',
  'market',
  'rotation',
  'leaders',
  'patterns',
  'squeeze',
  '52wl',
  'weak',
  'portfolio',
  'compare',
  'watchlist',
  'announcements',
  'themes',
  'bestpicks',
  'feedback',
  'settings',
  'chart',
]
export const HELP_CONTENT_ORDERED = HELP_ORDER.map((id) => HELP_CONTENT.find((h) => h.id === id)).filter(Boolean)

export const GUIDE_SUGGESTIONS = {
  _default: [
    'How do I use this page?',
    'What is RS rating?',
    'How do I open a stock chart?',
    'Where are Concall and PPT?',
    'What is Squeeze Pro?',
    'What is Lakshmi Mata?',
  ],
  rs: ['How do I use RS Rating?', 'What do the signal chips mean?', 'How do I filter by sector?'],
  market: ['How do I read Market verdict?', 'What is Smart Money?'],
  rotation: ['How do I read the rotation chart?', 'What is Leading vs Improving?'],
  announcements: ['Where are Results / Concall / PPT?', 'What does the green badge mean?'],
  themes: ['What are Emerging Themes?'],
  squeeze: ['What is Squeeze Pro?', 'What is High compression?', 'What does the momentum arrow mean?'],
  patterns: ['What patterns are detected?', 'What is VCP?'],
  chart: [
    'How do I read Results rating?',
    'What is Concall Report?',
    'What is PPT summary?',
    'What is Lakshmi Mata?',
    'What is Super Cycle?',
  ],
  docs: ['What is RS rating?', 'What is Squeeze Pro?', 'How do I open a stock chart?'],
}

export const GUIDE_QA = [
  {
    keys: ['rs rating', 'relative strength', 'what is rs', 'how do i use rs'],
    answer:
      'RS (Relative Strength) ranks a stock 1–99 vs the whole market. Higher = stronger tape vs peers. Use the RS Rating tab, tap a row for the chart, and combine with Results/Concall — RS alone is not a buy call.',
  },
  {
    keys: ['this page', 'how do i use', 'how to use', 'what is this tab', 'explain this page'],
    answer: null,
  },
  {
    keys: ['open chart', 'stock chart', 'tap a row', 'click a stock', 'hover chart'],
    answer:
      'Tap a symbol on any scanner to open Our Chart. If chart-on-hover is enabled in Account, hovering a name opens the real chart (click to pin; Esc or ✕ to close). Under the chart: Results / Concall / PPT.',
  },
  {
    keys: ['concall', 'transcript', 'earnings call'],
    answer:
      'Open a stock → Concall Report tab. Green badge means a report exists. Use History date chips for older calls. Tone + Watch Next appear when extracted.',
  },
  {
    keys: ['ppt', 'presentation', 'slide'],
    answer:
      'Open a stock → PPT tab. Same History chips as Concall when multiple decks exist. Shows slide story, highlights, strategy, risks, and Watch Next when available.',
  },
  {
    keys: ['excellent', 'result rating', 'weak result', 'good result', 'neutral result'],
    answer:
      'Result quality (Excellent/Good/Neutral/Weak) comes from Sales & PAT YoY, with OPM and other-income checks. Margin compression or an other-income spike caps the badge. This is latest-quarter only — not the same as overall fundamental Rating.',
  },
  {
    keys: ['rrg', 'rotation', 'rs-ratio', 'rs-momentum', 'leading', 'improving', 'weakening', 'lagging', 'jdk'],
    answer:
      'Rotate uses a StockCharts-style Relative Rotation Graph. X = JdK RS-Ratio, Y = JdK RS-Momentum, both centered at 100. Leading = both > 100; Weakening = Ratio > 100, Momentum < 100; Lagging = both < 100; Improving = Momentum > 100 while Ratio < 100. Idealized path is clockwise.',
  },
  {
    keys: ['squeeze', 'squeeze pro', 'compression', 'keltner', 'ttm'],
    answer:
      'Squeeze Pro grades how tightly Bollinger Bands sit inside three Keltner widths: High (tightest), Mid (classic), Low (mild). Days = length of the coil. ▲ / ▼ = TTM momentum bias (long/short) — not a guaranteed breakout direction. Open the Squeeze tab or Guide → Squeeze Pro for the full walkthrough.',
  },
  {
    keys: ['lakshmi mata', 'lakshmimata indicator', 'parent study'],
    answer:
      'Lakshmi Mata is the main chart pack: EMA 9/21/50/150/200, Guppy, Squeeze dots, S/R, Bollinger, Buy/Sell, UC/LC and related signals. Enable it under Indicators. Full Guide → Chart & indicators explains each child.',
  },
  {
    keys: ['super cycle', 'supercycle'],
    answer:
      'Lakshmi Super Cycle is an RS-vs-index oscillator on stock charts (not indices). Use it to see whether relative strength is warming or cooling, together with Stage and Squeeze — not as a standalone timer.',
  },
  {
    keys: ['lakshmi volume', 'volume study', 'bull snort'],
    answer:
      'Lakshmi Volume highlights unusual volume, climax, and dry-up context. Scanner chips like HY, HT, IBV, Bull Snort use related volume ideas. Enable the Volume study on Our Chart for the full picture.',
  },
  {
    keys: ['circuit', 'uc/lc', 'upper circuit', 'lower circuit'],
    answer:
      'Circuit bands sketch likely upper/lower circuit zones from detected lock percentages. They are research overlays — confirm exchange rules for the series you trade.',
  },
  {
    keys: ['bollinger', 'bbands', 'bollinger bands'],
    answer:
      'Bollinger Bands = SMA 20 ± 2σ. Tight bands = quiet volatility; Squeeze Pro compares those bands to Keltner Channels to grade compression.',
  },
  {
    keys: ['support', 'resistance', 's/r', 'pivot'],
    answer:
      'Support & Resistance lines come from confirmed swing pivots (bars left and right). Breaks with volume matter more than the lines alone.',
  },
  {
    keys: ['buy sell', 'buy/sell', 'markers'],
    answer:
      'Buy/Sell markers are rule-based cues from the Lakshmi Mata study — prompts to inspect, not automatic orders or advice.',
  },
  {
    keys: ['peer', 'ranking', 'jewellery', 'industry'],
    answer:
      'Under Results, peers are ranked in the same industry when available. Click another peer pill to open that stock’s Results tab.',
  },
  {
    keys: ['theme', 'emerging'],
    answer:
      'Emerging Themes lists themes tagged from PPT/concall text. Open a theme to see stocks that mentioned it — for scanning ideas, not as a standalone signal.',
  },
  {
    keys: ['watchlist'],
    answer:
      'Watchlist tab saves lists. In the header dropdown on scanner pages, pick a watchlist (wl:…) to filter that page to your list only.',
  },
  {
    keys: ['guide', 'docs', 'help page', 'documentation', 'newcomer', 'beginner'],
    answer:
      'Open Guide from the sidebar (book icon / More → Guide) or from Help (?) → “Open full Guide”. It has Getting started plus how each scanner and chart component works.',
  },
  {
    keys: ['cost', 'ai agent', 'gemini', 'chatgpt'],
    answer:
      'Ask Guide is free and runs in your browser from built-in help text and on-screen data. It does not call paid AI. Live Gemini is only used on the server for Concall/PPT summaries in the background.',
  },
  {
    keys: ['buy', 'sell', 'advice', 'should i'],
    answer:
      'Lakshmimata is a scanner and research aid, not investment advice. Use RS, Results, Concall/PPT, and your own judgment — nothing here is a buy/sell recommendation.',
  },
]

export function getArticle(id) {
  return DOCS_ARTICLES.find((a) => a.id === id) || null
}

export function articlesForCategory(categoryId) {
  return DOCS_ARTICLES.filter((a) => a.category === categoryId)
}

export function searchArticles(query) {
  const q = (query || '').trim().toLowerCase()
  if (!q) return DOCS_ARTICLES
  return DOCS_ARTICLES.filter((a) => {
    const blob = [
      a.title,
      a.summary,
      a.forNewcomers,
      ...(a.sections || []).flatMap((s) => [s.heading, s.body, ...(s.bullets || [])]),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return q.split(/\s+/).every((w) => blob.includes(w))
  })
}
