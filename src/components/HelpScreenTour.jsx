import React, { useState } from 'react'

const CALLOUTS = [
  {
    n: 1, x: 3, y: 2, title: 'RS Rating and account status',
    text: 'The page name is RS Rating. Under it, your email and the current stock scope show which account and universe you are viewing.',
    action: 'Change the universe from All stocks in the top-right controls.',
  },
  {
    n: 2, x: 18, y: 2, title: 'Live status and last update',
    text: 'The green Live label means the scanner is showing the current session. The nearby time, stock count, scan badge and countdown tell you when data refreshed and when the next scan is expected.',
    action: 'Click ↻ for an immediate reload. The 1/2/5/10-minute selector changes auto-poll frequency. A purple History banner means you are not live.',
  },
  {
    n: 3, x: 48, y: 6, title: 'Scrolling market ticker',
    text: 'The first moving row shows indices; the second shows active stocks. Green is positive and red is negative. Hover pauses it; clicking a name opens its chart.',
    action: 'Hide: click × at the ticker’s far right. Restore: click “Show ticker”, or Account → App Preferences → Scrolling ticker → ON.',
  },
  {
    n: 4, x: 83, y: 2, title: 'Stock universe',
    text: 'All stocks limits every scanner to the selected universe: All, Nifty 50, Midcap, Smallcap, Microcap, or one of your watchlists.',
    action: 'Choose an entry; the table filters immediately.',
  },
  {
    n: 5, x: 89, y: 2, title: 'Saved page layout',
    text: 'The first Layout control saves or restores your page/table setup. It is different from the chart’s internal Layout button.',
    action: 'Open it to apply, save, rename, or remove a saved layout.',
  },
  {
    n: 6, x: 93, y: 2, title: 'History, Auto refresh and alerts',
    text: 'Calendar replays a prior scanner date. Auto pauses/resumes refresh. The bell controls browser, sound, scanner and Telegram alert preferences.',
    action: 'Disable alerts: 🔔 Alerts → Settings → All off. Disable only sound: untick “Play sound on alert”. Re-enable with All on or selected checkboxes.',
  },
  {
    n: 7, x: 98, y: 2, title: 'Demo, workspace and Help',
    text: 'Demo loads learning data. The blue workspace Layout chooses Chart | Scanner or Scanner | Chart. ? opens Help and Ask Guide.',
    action: 'Use workspace Layout to keep the chart at 75% and the scanner at 25%, on either side.',
  },
  {
    n: 8, x: 21, y: 12, title: 'Chart window title and window icons',
    text: 'The chart title shows the selected symbol. ◀/▶ moves through the filtered stock list, TV ↗ opens TradingView, and the width icon cycles chart size. Our Chart / TradingView switches the chart source. Window icons dock/undock, minimize or close the panel.',
    action: 'If you close the chart, click a stock symbol again to reopen it.',
  },
  {
    n: 9, x: 8, y: 16, title: 'LIVE and time intervals',
    text: 'LIVE means today’s candle is updating. 1/3/5/15 are intraday minutes; 1H, 1D, 1W and 1M change candle duration. The ▾ menu manages favorite intervals.',
    action: 'Click an interval. Use ▾ and ★ to decide which intervals stay on the toolbar.',
  },
  {
    n: 10, x: 23, y: 16, title: 'Chart style and drawing tools',
    text: 'Candlestick and line icons change price display. Pan lets you move the chart; drawing tools add trend lines, horizontal levels, text and price alerts.',
    action: 'Select a tool, click the chart, then return to Pan. Select a drawing and use Delete/Clear to remove it.',
  },
  {
    n: 11, x: 31, y: 16, title: 'Indicators (fx)',
    text: 'Indicators opens every overlay, oscillator and signal: Lakshmi Mata, moving averages, Guppy, Squeeze Pro, RSI, MACD, Volume, Super Cycle and more.',
    action: 'Enable/disable: click Indicators, then click the checkbox beside an item. ⚙ changes Inputs, Style and Visibility. “Restore defaults” resets all.',
  },
  {
    n: 12, x: 42, y: 16, title: 'Clean/Pro and chart Layout',
    text: 'Clean keeps a simple toolbar and larger chart. Pro exposes more controls. Chart Layout changes pane order, pane height and price-scale width.',
    action: 'Drag separators to resize panes; double-click a separator to reset. Save your preferred chart layout by name.',
  },
  {
    n: 13, x: 76, y: 14, title: 'RS summary tiles',
    text: 'These tiles count the current RS list and key groups: HT, HY, IBV, Pocket Pivot, Bull Snort, volume-to-EMA setups, EMA5/9, R1 and RS Improving.',
    action: 'Click a tile to focus the corresponding stocks; use the All tile to return to the full list.',
  },
  {
    n: 14, x: 82, y: 21, title: 'Search, filters and Columns',
    text: 'Search accepts a symbol or company name. Filters opens detailed conditions; ↺ clears them. Columns decides which fields are visible. TV copies the current symbols for a TradingView watchlist.',
    action: 'To simplify the table, open Columns and untick fields you do not need. For Lakshmimata notifications use the top-header 🔔 Alerts menu.',
  },
  {
    n: 15, x: 79, y: 32, title: 'Stock rows and labels',
    text: 'Each row combines symbol, price, RS ranks, technical labels, Stage/Volume, fundamental rating and latest-result quality. Colored tags are clues, not orders.',
    action: 'Click a symbol for Our Chart. Hover it for a preview when Account → Chart on hover is ON. Click column headings to sort.',
  },
  {
    n: 16, x: 55, y: 75, title: 'Chart panes and indicator table',
    text: 'The large pane is price. Lower panes show enabled studies such as volume and Super Cycle. The dark table summarizes indicator values across recent sessions.',
    action: 'Turn a pane off from Indicators, or reorder/resize it from the chart Layout menu.',
  },
]

export default function HelpScreenTour({ theme: C }) {
  const [active, setActive] = useState(1)
  const selected = CALLOUTS.find((c) => c.n === active) || CALLOUTS[0]

  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: C.text, marginBottom: 4 }}>
        RS Rating screen tour
      </div>
      <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.55, marginBottom: 10 }}>
        Click a numbered marker or its explanation. Click the screenshot itself to open the full-size image.
      </div>

      <div style={{ position: 'relative', border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
        <a href="/docs/rs-rating-screen-tour.png" target="_blank" rel="noreferrer" title="Open full-size screenshot">
          <img
            src="/docs/rs-rating-screen-tour.png"
            alt="RS Rating page with Our Chart docked left and scanner right"
            loading="lazy"
            style={{ display: 'block', width: '100%', height: 'auto' }}
          />
        </a>
        {CALLOUTS.map((c) => (
          <button
            key={c.n}
            type="button"
            aria-label={`${c.n}. ${c.title}`}
            title={`${c.n}. ${c.title}`}
            onClick={(e) => {
              e.preventDefault()
              setActive(c.n)
            }}
            style={{
              position: 'absolute',
              left: `${c.x}%`,
              top: `${c.y}%`,
              transform: 'translate(-50%, -50%)',
              width: active === c.n ? 24 : 20,
              height: active === c.n ? 24 : 20,
              padding: 0,
              borderRadius: '50%',
              border: '2px solid #fff',
              background: active === c.n ? C.red : C.accent,
              color: '#fff',
              fontSize: active === c.n ? 10 : 9,
              fontWeight: 900,
              cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(0,0,0,.75)',
              zIndex: active === c.n ? 3 : 2,
            }}
          >
            {c.n}
          </button>
        ))}
      </div>

      <div
        aria-live="polite"
        style={{
          marginTop: 10,
          padding: '11px 13px',
          borderRadius: 9,
          border: `1px solid ${C.accent}55`,
          background: C.accent + '10',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            width: 22, height: 22, borderRadius: '50%', display: 'inline-flex',
            alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            background: C.accent, color: '#fff', fontSize: 10, fontWeight: 900,
          }}>
            {selected.n}
          </span>
          <span style={{ fontSize: 12.5, fontWeight: 800, color: C.text }}>{selected.title}</span>
        </div>
        <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.6, marginTop: 7 }}>{selected.text}</div>
        <div style={{ fontSize: 11.5, color: C.text, lineHeight: 1.6, marginTop: 5 }}>
          <strong style={{ color: C.accent }}>How:</strong> {selected.action}
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
          gap: 8,
          marginTop: 10,
        }}
      >
        {CALLOUTS.map((c) => (
          <button
            key={c.n}
            type="button"
            onClick={() => setActive(c.n)}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              padding: '9px 10px',
              textAlign: 'left',
              borderRadius: 8,
              border: `1px solid ${active === c.n ? C.accent : C.border}`,
              background: active === c.n ? C.accent + '10' : C.bg,
              color: C.text,
              cursor: 'pointer',
            }}
          >
            <span style={{
              width: 20, height: 20, borderRadius: '50%', display: 'inline-flex',
              alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              background: active === c.n ? C.accent : C.muted + '33',
              color: active === c.n ? '#fff' : C.muted,
              fontSize: 9, fontWeight: 900,
            }}>
              {c.n}
            </span>
            <span>
              <span style={{ display: 'block', fontSize: 11.5, fontWeight: 800 }}>{c.title}</span>
              <span style={{ display: 'block', fontSize: 10.5, color: C.muted, lineHeight: 1.45, marginTop: 2 }}>
                {c.action}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
