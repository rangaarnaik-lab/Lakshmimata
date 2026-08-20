import React from 'react'

/**
 * Inline diagrams for the Guide. Drawn as SVG (not screenshots) so they
 * follow the active theme and never go stale when the UI moves.
 */

const VB_W = 340
const VB_H = 150

function Frame({ C, children, title }) {
  return (
    <svg viewBox={`0 0 ${VB_W} ${VB_H}`} width="100%" role="img" aria-label={title}
      style={{ display: 'block', borderRadius: 8, background: C.bg }}>
      <rect x="0.5" y="0.5" width={VB_W - 1} height={VB_H - 1} rx="7.5"
        fill="none" stroke={C.border} />
      {children}
    </svg>
  )
}

function Pane({ C, x, y, w, h, fill, label, sub, dim }) {
  return (
    <g opacity={dim ? 0.55 : 1}>
      <rect x={x} y={y} width={w} height={h} rx="5" fill={fill + '22'} stroke={fill + '99'} />
      <text x={x + w / 2} y={y + h / 2 - (sub ? 3 : 0)} textAnchor="middle" dominantBaseline="middle"
        fontSize="11" fontWeight="800" fill={fill}>{label}</text>
      {sub && (
        <text x={x + w / 2} y={y + h / 2 + 12} textAnchor="middle" dominantBaseline="middle"
          fontSize="8" fill={C.muted}>{sub}</text>
      )}
    </g>
  )
}

function Caption({ C, x, y, children, anchor = 'start', bold }) {
  return (
    <text x={x} y={y} textAnchor={anchor} fontSize="8.5" fontWeight={bold ? 800 : 600} fill={C.muted}>
      {children}
    </text>
  )
}

/** Smooth-ish polyline from y values across the width. */
function series(values, x0, x1, yTop, yBottom) {
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const step = (x1 - x0) / (values.length - 1)
  return values
    .map((v, i) => `${(x0 + i * step).toFixed(1)},${(yBottom - ((v - min) / range) * (yBottom - yTop)).toFixed(1)}`)
    .join(' ')
}

const PRICE = [18, 22, 20, 26, 31, 28, 34, 40, 37, 44, 49, 46, 53, 58, 55, 62]

function LayoutChartLeft({ C }) {
  return (
    <Frame C={C} title="Chart 75% left, scanner 25% right">
      <Pane C={C} x={10} y={12} w={230} h={126} fill={C.teal} label="Chart" sub="75%" />
      <Pane C={C} x={248} y={12} w={82} h={126} fill={C.accent} label="Scanner" sub="25%" />
    </Frame>
  )
}

function LayoutChartRight({ C }) {
  return (
    <Frame C={C} title="Scanner 25% left, chart 75% right">
      <Pane C={C} x={10} y={12} w={82} h={126} fill={C.accent} label="Scanner" sub="25%" />
      <Pane C={C} x={100} y={12} w={230} h={126} fill={C.teal} label="Chart" sub="75%" />
    </Frame>
  )
}

function HoverChart({ C }) {
  const rows = [0, 1, 2, 3, 4]
  return (
    <Frame C={C} title="Hover chart docks beside the table">
      <rect x={10} y={12} width={120} height={126} rx="5" fill={C.accent + '14'} stroke={C.accent + '77'} />
      {rows.map((r) => (
        <g key={r}>
          <rect x={16} y={22 + r * 22} width={60} height={9} rx="2"
            fill={r === 2 ? C.accent : C.muted + '66'} />
          <rect x={84} y={22 + r * 22} width={38} height={9} rx="2" fill={C.muted + '33'} />
        </g>
      ))}
      <g>
        <path d={`M 78 71 L 128 71`} stroke={C.accent} strokeWidth="1.2" strokeDasharray="3 2" />
        <circle cx={128} cy={71} r="2.4" fill={C.accent} />
      </g>
      <rect x={140} y={12} width={190} height={126} rx="5" fill={C.teal + '18'} stroke={C.teal + '99'} />
      <polyline points={series(PRICE, 150, 320, 40, 118)} fill="none" stroke={C.teal} strokeWidth="1.8" />
      <Caption C={C} x={150} y={28} bold>Our Chart · hover to switch</Caption>
      <Caption C={C} x={16} y={136}>Rows stay clickable</Caption>
    </Frame>
  )
}

function SqueezeBands({ C }) {
  const mid = 78
  return (
    <Frame C={C} title="Bollinger Bands inside three Keltner widths">
      {[
        { w: 46, c: C.muted, label: 'Low · 2.0' },
        { w: 30, c: C.red, label: 'Mid · 1.5' },
        { w: 16, c: C.orange, label: 'High · 1.0' },
      ].map((k, i) => (
        <g key={k.label}>
          <rect x={16} y={mid - k.w} width={250} height={k.w * 2} rx="4"
            fill="none" stroke={k.c + 'aa'} strokeDasharray="4 3" />
          <Caption C={C} x={272} y={mid - k.w + 8 + i * 0} bold>{k.label}</Caption>
        </g>
      ))}
      <polyline points={series(PRICE.map((v, i) => 40 + Math.sin(i) * 3), 20, 262, mid - 10, mid + 10)}
        fill="none" stroke={C.text} strokeWidth="1.6" />
      <Caption C={C} x={16} y={140}>Tighter box = harder coil</Caption>
    </Frame>
  )
}

function SqueezeTiles({ C }) {
  const tiles = [
    { l: 'BB In Squeeze', v: '1069', c: C.blue },
    { l: 'BB Fired', v: '78', c: C.green },
    { l: 'VCP Forming', v: '87', c: C.purple },
    { l: 'VCP Fired', v: '1', c: C.accent },
  ]
  return (
    <Frame C={C} title="Squeeze tiles filter the table">
      {tiles.map((t, i) => (
        <g key={t.l}>
          <rect x={12 + i * 80} y={14} width={72} height={42} rx="5"
            fill={i === 0 ? t.c + '26' : C.card} stroke={i === 0 ? t.c : C.border} />
          <text x={48 + i * 80} y={33} textAnchor="middle" fontSize="13" fontWeight="900" fill={t.c}>{t.v}</text>
          <text x={48 + i * 80} y={47} textAnchor="middle" fontSize="6.5" fill={C.muted}>{t.l}</text>
        </g>
      ))}
      <path d="M 48 60 L 48 72" stroke={C.blue} strokeWidth="1.4" markerEnd="" />
      <path d="M 44 68 L 48 74 L 52 68" fill="none" stroke={C.blue} strokeWidth="1.4" />
      <rect x={12} y={78} width={316} height={58} rx="5" fill={C.blue + '10'} stroke={C.blue + '77'} />
      {[0, 1, 2].map((r) => (
        <g key={r}>
          <rect x={20} y={86 + r * 16} width={70} height={8} rx="2" fill={C.blue + '99'} />
          <rect x={98} y={86 + r * 16} width={210} height={8} rx="2" fill={C.muted + '2e'} />
        </g>
      ))}
      <Caption C={C} x={20} y={72} bold>Click a tile → only those stocks</Caption>
    </Frame>
  )
}

function Rrg({ C }) {
  const cx = 170
  const cy = 75
  return (
    <Frame C={C} title="RRG quadrants">
      <line x1={20} y1={cy} x2={320} y2={cy} stroke={C.border} />
      <line x1={cx} y1={14} x2={cx} y2={138} stroke={C.border} />
      <Caption C={C} x={cx + 8} y={26} bold>Leading</Caption>
      <Caption C={C} x={cx + 8} y={132} bold>Weakening</Caption>
      <Caption C={C} x={26} y={26} bold>Improving</Caption>
      <Caption C={C} x={26} y={132} bold>Lagging</Caption>
      <path d={`M 70 110 Q 120 60 ${cx + 30} 40 Q ${cx + 90} 55 ${cx + 100} 105`}
        fill="none" stroke={C.accent} strokeWidth="1.5" strokeDasharray="4 3" />
      <circle cx={cx + 100} cy={105} r="3.4" fill={C.accent} />
      <Caption C={C} x={cx - 6} y={cy + 12} anchor="end">100 / 100</Caption>
      <Caption C={C} x={320} y={cy - 6} anchor="end">RS-Ratio →</Caption>
    </Frame>
  )
}

function EmaGuppy({ C }) {
  return (
    <Frame C={C} title="EMA ribbon">
      {[0, 6, 12, 18, 24].map((off, i) => (
        <polyline key={off}
          points={series(PRICE.map((v) => v - off * 0.35), 16, 250, 30 + i * 3, 120 + i * 3)}
          fill="none" stroke={[C.accent, C.teal, C.green, C.yellow, C.red][i]} strokeWidth="1.3" opacity="0.9" />
      ))}
      <Caption C={C} x={258} y={44} bold>9 / 21</Caption>
      <Caption C={C} x={258} y={60}>50</Caption>
      <Caption C={C} x={258} y={76}>150 / 200</Caption>
      <Caption C={C} x={16} y={140}>Fanning out = trend asserting</Caption>
    </Frame>
  )
}

function BollingerViz({ C }) {
  const upper = PRICE.map((v, i) => v + 14 - Math.abs(8 - i) * 0.8)
  const lower = PRICE.map((v, i) => v - 14 + Math.abs(8 - i) * 0.8)
  return (
    <Frame C={C} title="Bollinger Bands">
      <polyline points={series(upper, 16, 320, 24, 124)} fill="none" stroke={C.accent + 'cc'} strokeWidth="1.3" />
      <polyline points={series(PRICE, 16, 320, 30, 118)} fill="none" stroke={C.muted} strokeWidth="1.1" strokeDasharray="3 2" />
      <polyline points={series(lower, 16, 320, 36, 132)} fill="none" stroke={C.accent + 'cc'} strokeWidth="1.3" />
      <Caption C={C} x={16} y={18} bold>SMA 20 ± 2σ</Caption>
      <Caption C={C} x={16} y={142}>Narrow = quiet, wide = volatile</Caption>
    </Frame>
  )
}

function SupportResistance({ C }) {
  return (
    <Frame C={C} title="Support and resistance">
      <line x1={16} y1={38} x2={324} y2={38} stroke={C.red} strokeWidth="1.4" strokeDasharray="5 3" />
      <line x1={16} y1={112} x2={324} y2={112} stroke={C.green} strokeWidth="1.4" strokeDasharray="5 3" />
      <Caption C={C} x={20} y={32} bold>Resistance</Caption>
      <Caption C={C} x={20} y={124} bold>Support</Caption>
      <polyline points="24,100 60,44 96,96 140,42 186,104 232,46 280,86 320,54"
        fill="none" stroke={C.text} strokeWidth="1.6" />
      {[[60, 44], [140, 42], [232, 46]].map(([x, y]) => <circle key={x} cx={x} cy={y} r="2.6" fill={C.red} />)}
      {[[96, 96], [186, 104]].map(([x, y]) => <circle key={x} cx={x} cy={y} r="2.6" fill={C.green} />)}
    </Frame>
  )
}

function CircuitBands({ C }) {
  return (
    <Frame C={C} title="Upper and lower circuit bands">
      <rect x={16} y={30} width={308} height={18} fill={C.teal + '18'} />
      <rect x={16} y={102} width={308} height={18} fill={C.red + '18'} />
      <line x1={16} y1={39} x2={324} y2={39} stroke={C.teal} strokeWidth="1.4" />
      <line x1={16} y1={111} x2={324} y2={111} stroke={C.red} strokeWidth="1.4" />
      <Caption C={C} x={20} y={26} bold>UC</Caption>
      <Caption C={C} x={20} y={132} bold>LC</Caption>
      <polyline points={series(PRICE, 16, 300, 48, 100)} fill="none" stroke={C.text} strokeWidth="1.6" />
      <Caption C={C} x={324} y={26} anchor="end">Auto-detected %</Caption>
    </Frame>
  )
}

function VolumeViz({ C }) {
  const bars = [22, 30, 18, 26, 20, 34, 24, 58, 40, 26, 20, 30, 16, 22, 46, 28]
  return (
    <Frame C={C} title="Volume study">
      <line x1={16} y1={124} x2={324} y2={124} stroke={C.border} />
      {bars.map((b, i) => (
        <rect key={i} x={20 + i * 19} width={12} y={124 - b * 1.5} height={b * 1.5} rx="1.5"
          fill={b > 44 ? C.orange : b < 20 ? C.muted + '55' : C.green + 'aa'} />
      ))}
      <Caption C={C} x={16} y={20} bold>Spike = participation</Caption>
      <Caption C={C} x={324} y={20} anchor="end">Dry-up = quiet</Caption>
      <Caption C={C} x={16} y={140}>HY · HT · IBV · Bull Snort use this idea</Caption>
    </Frame>
  )
}

function SuperCycle({ C }) {
  const osc = [-20, -12, -4, 6, 16, 24, 18, 8, -2, -12, -18, -8, 4, 14, 22, 12]
  return (
    <Frame C={C} title="Super Cycle oscillator">
      <line x1={16} y1={75} x2={324} y2={75} stroke={C.border} strokeDasharray="3 3" />
      {osc.map((v, i) => (
        <rect key={i} x={20 + i * 19} width={12} rx="1.5"
          y={v >= 0 ? 75 - v * 1.9 : 75} height={Math.abs(v) * 1.9}
          fill={v >= 0 ? C.green + 'bb' : C.red + 'bb'} />
      ))}
      <Caption C={C} x={16} y={20} bold>RS cycle vs index</Caption>
      <Caption C={C} x={16} y={140}>Above zero = leadership warming</Caption>
    </Frame>
  )
}

function StageCycle({ C }) {
  return (
    <Frame C={C} title="Weinstein stages">
      <path d="M 20 108 C 60 110, 80 106, 110 104 C 150 100, 180 50, 220 38 C 250 30, 268 34, 286 46 C 306 60, 316 90, 324 108"
        fill="none" stroke={C.text} strokeWidth="1.8" />
      {[
        ['S1 Base', 58, C.muted],
        ['S2 Up', 150, C.green],
        ['S3 Top', 248, C.yellow],
        ['S4 Down', 312, C.red],
      ].map(([l, x, c]) => (
        <text key={l} x={x} y={132} textAnchor="middle" fontSize="8.5" fontWeight="800" fill={c}>{l}</text>
      ))}
      <Caption C={C} x={16} y={20} bold>Most long setups prefer Stage 2</Caption>
    </Frame>
  )
}

function VcpViz({ C }) {
  return (
    <Frame C={C} title="Volatility contraction">
      <polyline points="20,110 54,40 88,96 124,50 158,86 194,58 226,78 258,64 290,72 320,50"
        fill="none" stroke={C.text} strokeWidth="1.6" />
      {[[54, 40, 96], [124, 50, 86], [194, 58, 78]].map(([x, hi, lo], i) => (
        <g key={x}>
          <line x1={x} y1={hi} x2={x} y2={lo} stroke={C.purple} strokeWidth="1.2" />
          <text x={x + 4} y={(hi + lo) / 2} fontSize="8" fontWeight="800" fill={C.purple}>{`T${i + 1}`}</text>
        </g>
      ))}
      <Caption C={C} x={16} y={20} bold>Each pullback shallower</Caption>
      <Caption C={C} x={16} y={140}>Volume dries up into the apex</Caption>
    </Frame>
  )
}

function ChartAnatomy({ C }) {
  const tabs = ['Results', 'Concall', 'PPT', 'About']
  return (
    <Frame C={C} title="Chart with filings below">
      <rect x={12} y={12} width={316} height={78} rx="5" fill={C.teal + '14'} stroke={C.teal + '88'} />
      <polyline points={series(PRICE, 24, 316, 26, 82)} fill="none" stroke={C.teal} strokeWidth="1.8" />
      <Caption C={C} x={22} y={26} bold>Our Chart · fx Indicators</Caption>
      {tabs.map((t, i) => (
        <g key={t}>
          <rect x={12 + i * 80} y={98} width={72} height={18} rx="4"
            fill={i === 0 ? C.accent + '22' : C.card} stroke={i === 0 ? C.accent : C.border} />
          <text x={48 + i * 80} y={110} textAnchor="middle" fontSize="8" fontWeight="800"
            fill={i === 0 ? C.accent : C.muted}>{t}</text>
        </g>
      ))}
      <rect x={12} y={122} width={316} height={16} rx="4" fill={C.muted + '18'} />
      <Caption C={C} x={20} y={134}>Green badge = summary on file</Caption>
    </Frame>
  )
}

function NavMap({ C }) {
  const items = ['RS', 'Market', 'Rotate', 'Leaders', 'Patterns', 'Squeeze', 'Guide']
  return (
    <Frame C={C} title="Navigation">
      <rect x={10} y={12} width={40} height={126} rx="5" fill={C.sidebar || C.card} stroke={C.border} />
      {items.map((t, i) => (
        <g key={t}>
          <rect x={16} y={20 + i * 17} width={28} height={12} rx="3"
            fill={i === 0 ? C.accent + '33' : C.muted + '22'} />
          <text x={30} y={29 + i * 17} textAnchor="middle" fontSize="6"
            fontWeight="800" fill={i === 0 ? C.accent : C.muted}>{t}</text>
        </g>
      ))}
      <rect x={58} y={12} width={272} height={26} rx="5" fill={C.card} stroke={C.border} />
      <Caption C={C} x={66} y={28} bold>Header · index / watchlist · 🔔 alerts · ?</Caption>
      <rect x={58} y={46} width={272} height={92} rx="5" fill={C.accent + '10'} stroke={C.accent + '55'} />
      <Caption C={C} x={66} y={62} bold>Active page</Caption>
      <Caption C={C} x={66} y={130}>Mobile: bottom tabs + More → Guide</Caption>
    </Frame>
  )
}

function TelegramFlow({ C }) {
  const steps = [
    ['1', 'BotFather', 'create bot'],
    ['2', 'Connect', 'in Account'],
    ['3', 'Start', 'in Telegram'],
  ]
  return (
    <Frame C={C} title="Telegram linking flow">
      {steps.map(([n, t, s], i) => (
        <g key={n}>
          <rect x={12 + i * 74} y={16} width={64} height={40} rx="5" fill={C.card} stroke={C.border} />
          <text x={44 + i * 74} y={32} textAnchor="middle" fontSize="9" fontWeight="800" fill={C.accent}>{t}</text>
          <text x={44 + i * 74} y={45} textAnchor="middle" fontSize="7" fill={C.muted}>{s}</text>
          {i < 2 && <path d={`M ${78 + i * 74} 36 L ${84 + i * 74} 36`} stroke={C.muted} strokeWidth="1.2" />}
        </g>
      ))}
      <rect x={238} y={16} width={90} height={40} rx="5" fill={C.green + '1e'} stroke={C.green + '88'} />
      <text x={283} y={40} textAnchor="middle" fontSize="9" fontWeight="800" fill={C.green}>Linked ✓</text>
      <rect x={12} y={68} width={316} height={68} rx="6" fill={C.card} stroke={C.accent + '66'} />
      <text x={24} y={86} fontSize="9" fontWeight="800" fill={C.accent}>Lakshmimata · BB Squeeze ↑ Long</text>
      <text x={24} y={102} fontSize="10" fontWeight="800" fill={C.text}>RELIANCE</text>
      <text x={104} y={102} fontSize="8.5" fill={C.muted}>RS 87 · +1.4% · IT</text>
      <text x={24} y={122} fontSize="7.5" fill={C.muted}>Research alert — not advice</text>
    </Frame>
  )
}

function BreadthViz({ C }) {
  return (
    <Frame C={C} title="Market breadth">
      <rect x={16} y={26} width={200} height={16} rx="4" fill={C.green + 'aa'} />
      <rect x={16} y={50} width={96} height={16} rx="4" fill={C.red + 'aa'} />
      <Caption C={C} x={222} y={38} bold>Advances</Caption>
      <Caption C={C} x={118} y={62} bold>Declines</Caption>
      <line x1={16} y1={124} x2={324} y2={124} stroke={C.border} />
      <polyline points={series([10, 14, 12, 20, 26, 22, 30, 36, 32, 40], 16, 320, 82, 120)}
        fill="none" stroke={C.accent} strokeWidth="1.6" />
      <Caption C={C} x={16} y={80} bold>A/D history</Caption>
      <Caption C={C} x={16} y={138}>Broad participation is healthier</Caption>
    </Frame>
  )
}

function SignalChips({ C }) {
  const chips = [
    ['🚀 HT', C.purple], ['📊 HY', C.blue], ['🏛️ IBV', C.teal],
    ['🔥 PP', C.orange], ['🐂 Bull Snort', C.green], ['🌀 VCP', C.accent],
  ]
  return (
    <Frame C={C} title="Signal chips">
      {chips.map((c, i) => {
        const col = i % 3
        const row = Math.floor(i / 3)
        return (
          <g key={c[0]}>
            <rect x={16 + col * 104} y={24 + row * 34} width={94} height={24} rx="12"
              fill={c[1] + '1e'} stroke={c[1] + '88'} />
            <text x={63 + col * 104} y={39 + row * 34} textAnchor="middle" fontSize="8.5"
              fontWeight="800" fill={c[1]}>{c[0]}</text>
          </g>
        )
      })}
      <Caption C={C} x={16} y={112} bold>Tap ℹ on RS filters for the full glossary</Caption>
      <Caption C={C} x={16} y={130}>Chips narrow the table to that event</Caption>
    </Frame>
  )
}

const VISUALS = {
  'layout-chart-left': LayoutChartLeft,
  'layout-chart-right': LayoutChartRight,
  'hover-chart': HoverChart,
  'squeeze-bands': SqueezeBands,
  'squeeze-tiles': SqueezeTiles,
  rrg: Rrg,
  'ema-guppy': EmaGuppy,
  bollinger: BollingerViz,
  sr: SupportResistance,
  circuit: CircuitBands,
  volume: VolumeViz,
  supercycle: SuperCycle,
  stage: StageCycle,
  vcp: VcpViz,
  'chart-anatomy': ChartAnatomy,
  nav: NavMap,
  telegram: TelegramFlow,
  breadth: BreadthViz,
  'signal-chips': SignalChips,
}

export function hasVisual(id) {
  return !!VISUALS[id]
}

/** One labeled diagram. `id` must exist in VISUALS. */
export default function HelpVisual({ id, caption, theme: C }) {
  const Cmp = VISUALS[id]
  if (!Cmp) return null
  return (
    <figure style={{ margin: '14px 0 0' }}>
      <Cmp C={C} />
      {caption && (
        <figcaption style={{ fontSize: 10.5, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>
          {caption}
        </figcaption>
      )}
    </figure>
  )
}
