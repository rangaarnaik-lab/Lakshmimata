export const C = {
  bg: '#080c14', card: '#0f1623', border: '#1a2540',
  accent: '#00e5b0', text: '#dde6f0', muted: '#4a6080',
  green: '#1fd67a', red: '#f0455a', yellow: '#f5a623',
  purple: '#a78bfa', orange: '#fb923c', blue: '#38bdf8',
  pink: '#f472b6', lime: '#a3e635',
}

export const rsColor = r => r >= 90 ? C.green  : r >= 70 ? C.accent : r >= 50 ? C.yellow : C.red
export const rsLabel = r => r >= 90 ? 'Elite'  : r >= 80 ? 'Strong' : r >= 60 ? 'Avg+'   : r >= 40 ? 'Avg' : 'Weak'
export const trendIcon  = t => t === 'improving' ? '↑↑' : t === 'declining' ? '↓↓' : '→'
export const trendColor = t => t === 'improving' ? C.green : t === 'declining' ? C.red : C.muted
export const fmtVol = v => v >= 1e7 ? `${(v / 1e7).toFixed(1)}Cr` : v >= 1e5 ? `${(v / 1e5).toFixed(1)}L` : `${(v / 1e3).toFixed(0)}K`
export const fmtP = v => `₹${v >= 1000 ? v.toFixed(0) : v.toFixed(2)}`
export const fmtDateTime = d => d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'
export const fmtTime = d => d ? new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'

export function Badge({ color, children, glow }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
      background: color + '22', color, whiteSpace: 'nowrap',
      boxShadow: glow ? `0 0 6px ${color}66` : 'none',
    }}>{children}</span>
  )
}

export function Sparkline({ data, width = 70, height = 26, color }) {
  const valid = data.filter(v => v !== null)
  if (valid.length < 2) return null
  const min = Math.min(...valid), max = Math.max(...valid), range = max - min || 1
  const pts = valid.map((v, i) => `${(i / (valid.length - 1)) * width},${height - ((v - min) / range) * (height - 4) - 2}`).join(' ')
  const lx = width, ly = height - ((valid[valid.length - 1] - min) / range) * (height - 4) - 2
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lx} cy={ly} r="2.5" fill={color} />
    </svg>
  )
}

export function RSCells({ history, compact }) {
  return (
    <div style={{ display: 'flex', gap: compact ? 2 : 3, flexWrap: 'wrap' }}>
      {history.map((v, i) => {
        const daysAgo = history.length - 1 - i
        const label = daysAgo === 0 ? 'T' : `-${daysAgo}`
        const color = v === null ? C.border : v >= 90 ? C.green : v >= 70 ? C.accent : v >= 50 ? C.yellow : C.red
        const sz = compact ? 22 : 26
        return (
          <div key={i} title={`${daysAgo === 0 ? 'Today' : `${daysAgo}d ago`}: RS ${v ?? 'N/A'}`}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <div style={{
              width: sz, height: sz,
              background: v !== null ? color + '28' : C.border + '33',
              border: `1px solid ${v !== null ? color + '88' : C.border}`,
              borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 800, fontSize: compact ? 8 : 9, color: v !== null ? color : C.muted,
            }}>{v !== null ? v : '—'}</div>
            <div style={{ fontSize: 6, color: C.muted, fontWeight: 600 }}>{label}</div>
          </div>
        )
      })}
    </div>
  )
}

// PP 10-day history dots
export function PPHistory({ ppHistory }) {
  return (
    <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
      {ppHistory.map((isPP, i) => {
        const daysAgo = ppHistory.length - 1 - i
        return (
          <div key={i} title={`${daysAgo === 0 ? 'Today' : `${daysAgo}d ago`}: ${isPP ? 'PP ✅' : 'No PP'}`}
            style={{
              width: 10, height: 10, borderRadius: '50%',
              background: isPP ? C.orange : C.border,
              boxShadow: isPP ? `0 0 4px ${C.orange}` : 'none',
              flexShrink: 0,
            }} />
        )
      })}
    </div>
  )
}

// Global filter bar used on every scanner tab
export function PPFilterBar({ ppFilter, setPpFilter, ppCount, totalCount }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
      padding: '10px 14px', marginBottom: 12,
    }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: C.text }}>🔥 Pocket Pivot:</span>
      {[
        ['all',  'All',       C.muted],
        ['yes',  `Yes (${ppCount})`, C.orange],
        ['no',   'No PP',     C.muted],
      ].map(([v, label, color]) => (
        <button key={v} onClick={() => setPpFilter(v)}
          style={{
            padding: '5px 13px', borderRadius: 20, border: `1px solid ${ppFilter === v ? color : C.border}`,
            cursor: 'pointer', fontSize: 12, fontWeight: 600,
            background: ppFilter === v ? color + '22' : 'transparent',
            color: ppFilter === v ? color : C.muted,
          }}>{label}</button>
      ))}
      <span style={{ fontSize: 11, color: C.muted, marginLeft: 'auto' }}>
        Showing {totalCount} stocks
      </span>
    </div>
  )
}

// Auto-refresh status bar
export function RefreshBar({ lastRefresh, interval, loading, onRefresh }) {
  const [now, setNow] = useState_placeholder(Date.now())
  // Note: useState is imported in each component file — this is just the display logic
  const elapsed = now - lastRefresh
  const pct = Math.min(100, (elapsed / interval) * 100)
  const remaining = Math.max(0, Math.round((interval - elapsed) / 1000))
  const mm = String(Math.floor(remaining / 60)).padStart(2, '0')
  const ss = String(remaining % 60).padStart(2, '0')
  return { pct, remaining, mm, ss, elapsed }
}
