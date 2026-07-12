import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { supabase, fetchOwnerToken } from './lib/supabase'
import { fetchStocksFromDB, fetchSectorsFromDB, fetchScanMeta, fetchAvailableHistoryDates, fetchIndexDashboard, fetchStockFullHistory, fetchSavedScanners, saveScanner, deleteScanner, fetchMarketBreadthHistory, fetchEmaBreadthHistory, fetchTopGainers, fetchRecentAlerts, fetchSectorRotation, fetchIndexRotation, fetchWatchlistRotation } from './lib/db'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import {
  calcRSRaw, percentileRank, buildRSHistory, rsSlope,
  detectPP, calcHY, calcHT, calcNearEMA9,
  detect52WLCrossover, detectWeakRSBigMove, buildSectorRS
} from './scanners/math'
import { SECTOR_MAP, NIFTY50, MIDCAP, SMALLCAP, getSector } from './data/sectors'
import {
  calcSMASeries, findSwingPoints, computeSupportResistance,
  detectInsideBars, detectAccDistDays, detectVCPContractions, detectCupAndHandle,
  detectPPDays, detectHYDays, detectHTDays, detectIBVDays, detectNearEMA9Days
} from './scanners/chartAnalysis'

// ─────────────────────────────────────────────────────────────────────
// 🔑 YOUR UPSTOX TOKEN — set this so users don't need to enter anything
// Leave empty string "" to require users to enter their own token
// ─────────────────────────────────────────────────────────────────────
let OWNER_TOKEN = import.meta.env.VITE_OWNER_UPSTOX_TOKEN || ''

// ── Colors ────────────────────────────────────────────────────────────
// ── Theming ──────────────────────────────────────────────────────────
// C stays the same shared object every component already reads
// directly (rewriting every component to take a theme prop would touch
// thousands of style references across the whole file) — but its VALUES
// are now swappable. applyTheme() mutates C in place; components pick
// up the new colors on their next render, triggered by bumping the
// themeVersion state at the top of App (see below).
const THEMES = {
  dark: {
    bg:'#0a0d12',card:'#0e1117',border:'#1c2333',
    accent:'#4f8ef7',text:'#e2e8f0',muted:'#4a5568',
    green:'#22c55e',red:'#ef4444',yellow:'#eab308',
    purple:'#a855f7',orange:'#f97316',blue:'#3b82f6',
    pink:'#ec4899',lime:'#84cc16',teal:'#14b8a6',
    sidebar:'#080b10',divider:'#161b27',
    rowHover:'#121824',active:'#1a2035',
  },
  light: {
    bg:'#f8fafc',card:'#ffffff',border:'#e2e8f0',
    accent:'#2563eb',text:'#0f172a',muted:'#64748b',
    green:'#16a34a',red:'#dc2626',yellow:'#ca8a04',
    purple:'#9333ea',orange:'#ea580c',blue:'#2563eb',
    pink:'#db2777',lime:'#65a30d',teal:'#0d9488',
    sidebar:'#f1f5f9',divider:'#e2e8f0',
    rowHover:'#f1f5f9',active:'#dbeafe',
  },
  midnight: {
    bg:'#0b1220',card:'#0f1830',border:'#1e2a4a',
    accent:'#60a5fa',text:'#e8edf7',muted:'#5b6a8c',
    green:'#34d399',red:'#f87171',yellow:'#fbbf24',
    purple:'#c084fc',orange:'#fb923c',blue:'#60a5fa',
    pink:'#f472b6',lime:'#a3e635',teal:'#2dd4bf',
    sidebar:'#080e1c',divider:'#182544',
    rowHover:'#141f3d',active:'#1c2b52',
  },
}
const C = {...THEMES.dark}
function applyTheme(key){
  const t = THEMES[key] || THEMES.dark
  Object.assign(C, t)
  document.body.style.background = t.bg
  document.body.style.color = t.text
  try{ localStorage.setItem('lakshmimata-theme', key) }catch(e){}
}

const rsColor  = r => r>=90?C.green:r>=70?C.accent:r>=50?C.yellow:C.red
const rsLabel  = r => r>=90?'Elite':r>=80?'Strong':r>=60?'Avg+':r>=40?'Avg':'Weak'
const trendIcon  = t => t==='improving'?'↑↑':t==='declining'?'↓↓':'→'
const trendColor = t => t==='improving'?C.green:t==='declining'?C.red:C.muted
const fmtP   = v => `₹${v>=1000?v.toFixed(0):v.toFixed(2)}`
const fmtVol = v => v>=1e7?`${(v/1e7).toFixed(1)}Cr`:v>=1e5?`${(v/1e5).toFixed(1)}L`:`${(v/1e3).toFixed(0)}K`
const fmtDT  = d => d?new Date(d).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—'
const REFRESH_OPTIONS=[{label:'1 min',ms:60000},{label:'5 min',ms:300000},{label:'10 min',ms:600000},{label:'30 min',ms:1800000}]

// ── Weinstein Stage Detection ─────────────────────────────────────────
// Stage 1: Basing — price flat near lows, RS weak/flat
// Stage 2: Uptrend — price above 30W MA, RS improving/strong ← best buys
// Stage 3: Topping — price extended above MA, RS may be declining
// Stage 4: Downtrend — price below 30W MA, RS declining
function calcWeinsteinStage(s){
  const rs = s.rs || 0
  const trend = s.rsTrend?.trend || 'flat'
  const chg = s.chg || 0
  const pctFromHigh = s.pctFromHigh || 0  // negative = below high
  const hist = s.hist || []
  const recentRS = hist.filter(Boolean).slice(-5)
  const avgRecentRS = recentRS.length ? recentRS.reduce((a,b)=>a+b,0)/recentRS.length : rs

  // Stage 2: Strong RS + improving trend + not too extended
  if(rs >= 70 && (trend === 'improving' || trend === 'flat') && pctFromHigh >= -30){
    if(pctFromHigh >= -5) return {stage:3, label:'S3 Top', color:C.orange, desc:'Topping — extended'}
    return {stage:2, label:'S2 Up', color:C.green, desc:'Uptrend — best buys'}
  }
  // Stage 3: High RS but declining
  if(rs >= 70 && trend === 'declining'){
    return {stage:3, label:'S3 Top', color:C.orange, desc:'Topping — RS declining'}
  }
  // Stage 4: Weak RS + declining
  if(rs < 40 && (trend === 'declining' || avgRecentRS < 40)){
    return {stage:4, label:'S4 Down', color:C.red, desc:'Downtrend — avoid'}
  }
  // Stage 1: Weak/flat RS, flat trend, near lows
  if(rs < 50 && trend === 'flat'){
    return {stage:1, label:'S1 Base', color:C.yellow, desc:'Basing — watch for breakout'}
  }
  // Default: Stage 1/2 transition
  if(rs >= 50 && rs < 70){
    return {stage:2, label:'S2 Early', color:C.teal, desc:'Early uptrend'}
  }
  return {stage:1, label:'S1 Base', color:C.yellow, desc:'Basing'}
}

// ── Volume vs Average ─────────────────────────────────────────────────
function calcVolAnalysis(s){
  const vol = s.hy?.todayVol || 0
  const pctOfMax = s.hy?.pctOfMax || 0
  // Classify volume
  if(pctOfMax >= 95) return {label:'🔥 Surge', color:C.orange, pct:pctOfMax}
  if(pctOfMax >= 70) return {label:'↑ High', color:C.green, pct:pctOfMax}
  if(pctOfMax >= 40) return {label:'→ Avg', color:C.muted, pct:pctOfMax}
  return {label:'↓ Low', color:C.red, pct:pctOfMax}
}

// ── IBV Detection (Institutional Buying Volume) ──────────────────────
// 3+ big up days with volume > down days volume in last 10 days
function calcIBV(s){
  const rs = s.rs || 0
  const trend = s.rsTrend?.trend || 'flat'
  const ppCount = s.pp?.ppCount10d || 0
  const chg = s.chg || 0

  const ibvScore = (ppCount >= 3 ? 3 : ppCount) +
                   (trend === 'improving' ? 2 : 0) +
                   (chg > 0 ? 1 : 0) +
                   (rs >= 70 ? 1 : 0)

  const isIBV = s.ibvSignal === true
  return {
    isIBV,
    ibvScore,
    ppCount,
    label: isIBV ? '🏛️ IBV' : 'No IBV',
    color: isIBV ? C.purple : C.muted,
    desc: 'Institutional-style volume activity detected'
  }
}

// A stock can technically have HT, HY, IBV, and PP all true at once
// (they're independent volume checks) — but showing all four badges on
// one card is redundant, and HT/HY/IBV are all stronger signals than
// PP specifically, so only the single highest-priority one should
// actually be surfaced anywhere (badges, filters, counts, Breakout tab
// sections), matching the same HT > HY > IBV > PP priority already
// used for the chart's volume bar coloring. Module-level (not inside
// App) so every component that needs it — including ones outside
// App's closure, like PresetFilterBar — can call it directly.
function topVolumeSignal(s){
  if(s.ht?.isHT) return 'ht'
  if(s.hy?.isHY) return 'hy'
  if(calcIBV(s).isIBV) return 'ibv'
  if(s.pp?.isPP) return 'pp'
  return null
}

// True if the last-10-days boolean history has at least `n` Pocket
// Pivots occurring on consecutive trading days anywhere in the window
// — back-to-back accumulation days, not just scattered PP days.
function hasConsecutivePP(ppHistory, n=2){
  if(!ppHistory || ppHistory.length===0) return false
  let streak = 0
  for(const isOn of ppHistory){
    streak = isOn ? streak+1 : 0
    if(streak >= n) return true
  }
  return false
}

// ── HY/HT Breakout Scanner ────────────────────────────────────────────
// Had HY or HT in last 5 days + price breaking out today
function calcHYHTBreakout(s){
  const ppHist = s.pp?.ppHistory || []
  const rs = s.rs || 0
  const chg = s.chg || 0
  const trend = s.rsTrend?.trend || 'flat'

  // Recent HY/HT signal = PP in last 5 days (proxy for high volume event)
  const recentPP = ppHist.slice(-5).some(Boolean)
  const todayPP  = ppHist[ppHist.length-1] || false
  const isHY     = s.hy?.isHY || false
  const isHT     = s.ht?.isHT || false

  // Breakout conditions:
  // 1. Had HY or HT in last 5 days
  // 2. Price is up today (breaking out)
  // 3. RS is strong
  const hadRecentHighVol = recentPP || isHY || isHT
  const priceBreaking    = chg > 1.0   // price up > 1% today
  const rsStrong         = rs >= 60
  const isBreakout       = hadRecentHighVol && priceBreaking && rsStrong

  // Breakout strength
  let strength = 'Weak'
  let color    = C.muted
  if(isBreakout){
    if(rs >= 80 && chg >= 3)  { strength = '🚀 Power'; color = C.accent }
    else if(rs >= 70 && chg >= 2){ strength = '⭐ Strong'; color = C.green }
    else                         { strength = '✅ Valid';  color = C.teal }
  }

  return {
    isBreakout,
    hadRecentHighVol,
    priceBreaking,
    strength,
    color,
    chg: chg.toFixed(2),
    recentPPCount: ppHist.slice(-5).filter(Boolean).length,
    isHY,
    isHT,
    desc: isBreakout
      ? `${strength} breakout — +${chg.toFixed(1)}% with recent high vol`
      : 'No breakout signal'
  }
}

// ── Preset filter definitions ─────────────────────────────────────────
const PRESETS = [
  {id:'all',       label:'All',          icon:'🌐', desc:'Show all stocks'},
  {id:'s2',        label:'Stage 2',      icon:'🚀', desc:'Weinstein Stage 2 uptrend — best buys'},
  {id:'breakout',  label:'HY/HT Break',  icon:'💥', desc:'Had HY/HT in last 5 days + breaking out today'},
  {id:'ibv',       label:'IBV',          icon:'🏛️', desc:'Institutional-style buying activity detected'},
  {id:'pp',        label:'PP Today',     icon:'🔥', desc:'Pocket Pivot today'},
  {id:'ema9',      label:'EMA9',         icon:'⚡', desc:'RS 90+ near 9-day EMA'},
  {id:'hy',        label:'HY Vol',       icon:'📊', desc:'Today volume > 52W max volume'},
  {id:'ht',        label:'HT Vol',       icon:'🎯', desc:'Today volume > all-time high volume'},
  {id:'rs90',      label:'RS 90+',       icon:'👑', desc:'Elite RS rating'},
  {id:'rs80',      label:'RS 80+',       icon:'⭐', desc:'Strong RS rating'},
  {id:'impr',      label:'Improving',    icon:'↑↑', desc:'RS trend improving'},
  {id:'power',     label:'Power',        icon:'💎', desc:'PP + RS 80+ together'},
  {id:'s1',        label:'Stage 1',      icon:'👀', desc:'Weinstein Stage 1 basing — watch for breakout'},
  {id:'s3',        label:'Stage 3',      icon:'⚠️', desc:'Weinstein Stage 3 topping — be careful'},
  {id:'s4',        label:'Stage 4',      icon:'🔴', desc:'Weinstein Stage 4 downtrend — avoid'},
  {id:'surge',     label:'Vol Surge',    icon:'🌊', desc:'Volume surge today'},
]

// ── Hooks ─────────────────────────────────────────────────────────────
// Click-and-drag horizontal scroll for wide tables — desktop mouse users
// don't have a trackpad/touch swipe gesture available, so without this
// the only way to see columns past the viewport edge is the (often tiny
// or hidden) native scrollbar. Returns props to spread onto the
// scrollable container; native touch scrolling still works as-is.
function useDragScroll(){
  const ref = useRef(null)
  const stateRef = useRef(null)
  const lastMovedRef = useRef(false)
  const onMouseDown = (e) => {
    if (!ref.current) return
    stateRef.current = { startX: e.clientX, startScroll: ref.current.scrollLeft, moved: false }
  }
  const onMouseMove = (e) => {
    const st = stateRef.current
    if (!st || !ref.current) return
    const delta = e.clientX - st.startX
    if (Math.abs(delta) > 3) st.moved = true
    ref.current.scrollLeft = st.startScroll - delta
  }
  const endDrag = () => {
    lastMovedRef.current = stateRef.current?.moved || false
    stateRef.current = null
  }
  // The click event fires AFTER mouseup, so the moved flag has to survive
  // past endDrag — otherwise dragging across a row to scroll the table
  // also "clicks" it and opens its chart right after you let go.
  const onClickCapture = (e) => {
    if (lastMovedRef.current) { e.stopPropagation(); e.preventDefault(); lastMovedRef.current = false }
  }
  return {
    ref,
    style: { cursor: 'grab' },
    handlers: { onMouseDown, onMouseMove, onMouseUp: endDrag, onMouseLeave: endDrag, onClickCapture },
  }
}

// ── Ambient sound ────────────────────────────────────────────────────
// Generates a soft ambient pad entirely with the Web Audio API — no
// external audio file, so no copyright/licensing concern (can't
// legally embed or link to an actual music track). A few detuned sine
// oscillators forming a simple open chord, each slowly breathing in
// volume via its own LFO, run through a gently sweeping lowpass filter.
// ── Signal glossary — plain-language descriptions for every filter/
// badge, so people don't have to guess what PP/IBV/R1/etc mean. ──
const SIGNAL_TOOLTIPS = {
  pp: 'Pocket Pivot — up day where volume beats every down day in the past 10 days, price near its short-term average.',
  hy: 'High Yield (volume) — today\'s volume is near the highest it\'s been in the last 52 weeks, on an up day.',
  ht: 'High Turnover — today\'s volume is near the highest it\'s ever been for this stock, on an up day.',
  ibv: 'Institutional-style Buying Volume — heavy volume + strong close within the day\'s range, suggesting large buying.',
  ema9: 'Price has pulled back to within 3% of its 9-day average, on a top-10%-RS stock.',
  r1: 'Price just crossed above a significant resistance level it had been held under for a while.',
  cup: 'Price just broke out above a cup-and-handle pattern. Algorithmic — treat as a visual aid, not a precise signal.',
  guppy: 'EMA9 just crossed above EMA50 — a fresh golden-cross-style momentum shift.',
}

// Tooltips for the Index Performance Dashboard's column headers.
const IDX_COLUMN_TOOLTIPS = {
  name: 'Which NSE sector/index this row tracks.',
  lastPrice: 'Current level of this index.',
  rsTv: 'Relative Strength (1-99) — how this index is performing vs the broader market. Above 70 = leading; below 40 = lagging.',
  stage: "Weinstein stage — where this index sits in its trend cycle (1=base, 2=uptrend, 3=topping, 4=downtrend).",
  chgD: '% change today.',
  chgW: '% change over the last week, with rank vs other indices.',
  chgM: '% change over the last month, with rank vs other indices.',
  chgQ: '% change over the last 3 months.',
  chgY: '% change over the last year.',
}

// Tooltips for the Sectors table's column headers.
const SEC_COLUMN_TOOLTIPS = {
  sector: 'Which sector this row tracks.',
  rank: "This sector's current rank vs all other sectors, by average RS.",
  avgRS: 'Average Relative Strength (1-99) across every stock in this sector — the core leadership signal.',
  count: 'How many stocks are tracked in this sector.',
  ppCount: "Stocks in this sector showing a Pocket Pivot today — early accumulation, real-time.",
  improving: "Count of this sector's stocks whose RS trend is currently improving, not just high.",
  advancesD: '% of this sector\'s stocks that are up today.',
  advancesW: '% of this sector\'s stocks that are up over the last week.',
  advancesM: '% of this sector\'s stocks that are up over the last month.',
}

const SIGNAL_GLOSSARY = [
  ['🚀 HT', 'High Turnover — today\'s volume is near the highest it\'s ever been for this stock, on an up day.'],
  ['📊 HY', 'High Yield (volume) — today\'s volume is near the highest it\'s been in the last 52 weeks, on an up day.'],
  ['🏛️ IBV', 'Institutional-style Buying Volume — unusually heavy volume combined with the price closing strong within the day\'s range, suggesting large/institutional buying rather than retail noise.'],
  ['🔥 PP', 'Pocket Pivot — an up day where volume beats every down day in the past 10 days, while price stays near its short-term average. A classic early-accumulation signal.'],
  ['🔥 PP 2x Consecutive', 'At least two Pocket Pivot days back-to-back within the last 10 days — sustained accumulation, not a one-off.'],
  ['🔥 PP >2 in 10d', 'More than two Pocket Pivot days total within the last 10 days (don\'t need to be consecutive) — repeated accumulation interest.'],
  ['⚡ EMA9 / EMA21 / EMA50', 'Price has pulled back to within 3% of its 9/21/50-day average — a common "buy the dip in an uptrend" zone, shown only for stocks already ranked in the top 10% by RS.'],
  ['⭐ Power', 'A Pocket Pivot day combined with a Relative Strength rating of 80 or higher — strong momentum plus fresh buying pressure together.'],
  ['🎯 R1 Breakout', 'Price just crossed above a significant resistance level it had been held under for a while — a fresh breakout, not one that happened days ago.'],
  ['☕ Cup Breakout', 'Price just broke out above a cup-and-handle chart pattern. Algorithmic pattern-matching — treat as a visual aid, not a precise signal.'],
  ['🐠 Guppy Crossover', 'The 9-day EMA just crossed above the 50-day EMA — a fresh golden-cross-style signal, short-term momentum shifting ahead of the broader trend.'],
  ['🌀 VCP 2T / 3T / 4T', 'Volatility Contraction Pattern — a series of pullbacks, each shallower than the last, with volume drying up. The number is how many contractions the pattern currently shows.'],
]

const AMBIENT_SOUNDS = [
  ['pad','🎐 Ambient Pad'],
  ['bowl','🔔 Singing Bowl'],
  ['rain','🌧️ Rain'],
  ['piano','🎹 Generative Piano'],
]

function useAmbientSound(){
  const [playing,setPlaying]=useState(false)
  const [enabled,setEnabled]=useState(false) // persisted preference, separate from live playing state
  const [volume,setVolume]=useState(0.25)
  const [soundType,setSoundTypeState]=useState('pad')
  const ctxRef=useRef(null)
  const nodesRef=useRef([])   // oscillators/sources to stop() on cleanup
  const timersRef=useRef([])  // setTimeout ids for generative patterns (bowl strikes, piano notes)
  const masterRef=useRef(null)

  const stop=()=>{
    timersRef.current.forEach(id=>clearTimeout(id))
    timersRef.current=[]
    nodesRef.current.forEach(n=>{ try{n.stop()}catch(e){} })
    nodesRef.current=[]
    if(ctxRef.current){ ctxRef.current.close().catch(()=>{}); ctxRef.current=null }
    setPlaying(false)
  }

  // -- Ambient Pad -- the original sound, a few detuned sines forming an
  // open chord, each breathing via its own slow LFO.
  const startPad=(ctx,filter)=>{
    const freqs=[110,164.8,220,277.2]
    freqs.forEach((f,i)=>{
      const osc=ctx.createOscillator()
      osc.type='sine'; osc.frequency.value=f
      osc.detune.value=(i%2===0?1:-1)*(3+i)
      const voiceGain=ctx.createGain(); voiceGain.gain.value=0
      const breathLfo=ctx.createOscillator()
      const breathLfoGain=ctx.createGain()
      breathLfo.frequency.value=0.05+i*0.015
      breathLfoGain.gain.value=0.06
      breathLfo.connect(breathLfoGain); breathLfoGain.connect(voiceGain.gain)
      osc.connect(voiceGain); voiceGain.connect(filter)
      osc.start(); breathLfo.start()
      voiceGain.gain.setValueAtTime(0,ctx.currentTime)
      voiceGain.gain.linearRampToValueAtTime(0.09,ctx.currentTime+2+i*0.4)
      nodesRef.current.push(osc,breathLfo)
    })
  }

  // -- Tibetan Singing Bowl -- a struck bowl's inharmonic overtone
  // structure (real bowls aren't a clean harmonic series), fast attack,
  // very long decay, periodically re-struck at a slightly different
  // pitch. Two near-identical oscillators per partial, a few cents
  // apart, give the characteristic slow "singing" beating/warble.
  const strikeBowl=(ctx,filter,baseFreq)=>{
    const partials=[1,2.76,4.1,5.43,6.79] // inharmonic ratios
    partials.forEach((ratio,i)=>{
      const freq=baseFreq*ratio
      const amp=0.5/(i+1)
      ;[-3,3].forEach(detuneCents=>{
        const osc=ctx.createOscillator()
        osc.type='sine'; osc.frequency.value=freq; osc.detune.value=detuneCents
        const g=ctx.createGain(); g.gain.value=0
        osc.connect(g); g.connect(filter)
        osc.start()
        const now=ctx.currentTime
        g.gain.setValueAtTime(0,now)
        g.gain.linearRampToValueAtTime(amp*0.18,now+0.05) // fast attack
        g.gain.exponentialRampToValueAtTime(0.0001,now+16+i*1.5) // long decay
        osc.stop(now+18)
        nodesRef.current.push(osc)
      })
    })
  }
  const startBowl=(ctx,filter)=>{
    const pitches=[196,220,261.6] // a few pleasant strike pitches to cycle through
    let i=0
    const scheduleStrike=()=>{
      strikeBowl(ctx,filter,pitches[i%pitches.length])
      i++
      const next=12000+Math.random()*8000 // re-strike every 12-20s
      timersRef.current.push(setTimeout(scheduleStrike,next))
    }
    scheduleStrike()
  }

  // -- Rain -- filtered noise (Web Audio has no built-in noise node, so
  // a buffer of random samples stands in for one), shaped toward the
  // mid/high energy real rain has, with slow amplitude swells so it
  // doesn't sound like a flat hiss.
  const startRain=(ctx,filter)=>{
    const bufferSize=2*ctx.sampleRate
    const buffer=ctx.createBuffer(1,bufferSize,ctx.sampleRate)
    const data=buffer.getChannelData(0)
    for(let i=0;i<bufferSize;i++) data[i]=Math.random()*2-1
    const noise=ctx.createBufferSource()
    noise.buffer=buffer; noise.loop=true
    const hp=ctx.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=800
    const shelf=ctx.createBiquadFilter(); shelf.type='highshelf'; shelf.frequency.value=3000; shelf.gain.value=-6
    const swellGain=ctx.createGain(); swellGain.gain.value=0.22
    const swellLfo=ctx.createOscillator()
    const swellLfoGain=ctx.createGain()
    swellLfo.frequency.value=0.04
    swellLfoGain.gain.value=0.06
    swellLfo.connect(swellLfoGain); swellLfoGain.connect(swellGain.gain)
    noise.connect(hp); hp.connect(shelf); shelf.connect(swellGain); swellGain.connect(filter)
    noise.start(); swellLfo.start()
    nodesRef.current.push(noise,swellLfo)
  }

  // -- Generative Piano -- sparse, randomized notes from a pentatonic
  // scale (always sounds consonant regardless of order/combination, a
  // standard generative-music trick), each a simple decaying tone. Not
  // any existing composition -- a new arrangement every time.
  const startPiano=(ctx,filter)=>{
    // C major pentatonic across two octaves
    const scale=[261.6,293.7,329.6,392.0,440.0,523.3,587.3,659.3,784.0,880.0]
    const playNote=()=>{
      const freq=scale[Math.floor(Math.random()*scale.length)]
      const osc=ctx.createOscillator()
      osc.type='triangle'; osc.frequency.value=freq
      const osc2=ctx.createOscillator() // a quiet octave-up partial for a brighter timbre
      osc2.type='sine'; osc2.frequency.value=freq*2
      const g=ctx.createGain(); g.gain.value=0
      const g2=ctx.createGain(); g2.gain.value=0
      osc.connect(g); g.connect(filter)
      osc2.connect(g2); g2.connect(filter)
      osc.start(); osc2.start()
      const now=ctx.currentTime
      g.gain.setValueAtTime(0,now); g.gain.linearRampToValueAtTime(0.11,now+0.02)
      g.gain.exponentialRampToValueAtTime(0.0001,now+3.5)
      g2.gain.setValueAtTime(0,now); g2.gain.linearRampToValueAtTime(0.03,now+0.02)
      g2.gain.exponentialRampToValueAtTime(0.0001,now+2)
      osc.stop(now+4); osc2.stop(now+2.2)
      nodesRef.current.push(osc,osc2)
      const next=1800+Math.random()*3200 // next note in 1.8-5s
      timersRef.current.push(setTimeout(playNote,next))
    }
    playNote()
  }

  const SOUND_STARTERS={pad:startPad,bowl:startBowl,rain:startRain,piano:startPiano}

  const start=()=>{
    if(playing) return
    const ctx=new (window.AudioContext||window.webkitAudioContext)()
    ctxRef.current=ctx
    const master=ctx.createGain(); master.gain.value=volume
    const filter=ctx.createBiquadFilter()
    filter.type='lowpass'; filter.frequency.value=soundType==='rain'?4000:900
    filter.connect(master); master.connect(ctx.destination)
    masterRef.current=master

    if(soundType!=='rain'){
      // Slowly sweep the filter for gentle movement (rain shapes its own
      // texture via the highpass/shelf chain instead, this would just
      // muffle it)
      const filterLfo=ctx.createOscillator()
      const filterLfoGain=ctx.createGain()
      filterLfo.frequency.value=0.03; filterLfoGain.gain.value=350
      filterLfo.connect(filterLfoGain); filterLfoGain.connect(filter.frequency)
      filterLfo.start()
      nodesRef.current.push(filterLfo)
    }

    ;(SOUND_STARTERS[soundType]||startPad)(ctx,filter)
    setPlaying(true)
  }

  const setVol = (v) => {
    setVolume(v)
    if(masterRef.current) masterRef.current.gain.setTargetAtTime(v, ctxRef.current.currentTime, 0.1)
  }

  const setSoundType = (type) => {
    setSoundTypeState(type)
    try{ localStorage.setItem('lakshmimata-ambient-sound', type) }catch(e){}
    if(playing){ stop(); setTimeout(()=>start(),50) } // restart with the new soundscape
  }

  // Load the persisted enable/disable + sound-type preference once on mount.
  useEffect(()=>{
    let pref=false, savedType='pad'
    try{
      pref = localStorage.getItem('lakshmimata-ambient-enabled')==='true'
      savedType = localStorage.getItem('lakshmimata-ambient-sound') || 'pad'
    }catch(e){}
    setEnabled(pref)
    setSoundTypeState(savedType)
  },[])

  // Browsers block autoplay-with-sound unconditionally -- a saved
  // 'enabled' preference from a past session can't just resume itself
  // on page load. Instead, listen for the person's FIRST genuine click
  // anywhere in the app this session and resume then, so re-enabling it
  // every single visit isn't necessary once they've opted in once.
  useEffect(()=>{
    if(!enabled || playing) return
    const resumeOnce = () => { start(); document.removeEventListener('click', resumeOnce) }
    document.addEventListener('click', resumeOnce)
    return () => document.removeEventListener('click', resumeOnce)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[enabled])


  const toggle = () => {
    const next = !enabled
    setEnabled(next)
    try{ localStorage.setItem('lakshmimata-ambient-enabled', String(next)) }catch(e){}
    if(next) start(); else stop()
  }

  useEffect(()=>()=>stop(),[]) // cleanup on unmount

  return { playing, enabled, volume, toggle, setVolume: setVol, soundType, setSoundType }
}

function useIsMobile(){
  const [v,setV]=useState(window.innerWidth<768)
  useEffect(()=>{const f=()=>setV(window.innerWidth<768);window.addEventListener('resize',f);return()=>window.removeEventListener('resize',f)},[])
  return v
}

// ── TradingView copy helper ───────────────────────────────────────────
function useCopy(){
  const [copied,setCopied]=useState('')
  const copy=(text,label)=>{
    navigator.clipboard.writeText(text).then(()=>{setCopied(label);setTimeout(()=>setCopied(''),2000)})
  }
  return{copy,copied}
}

// ── TV Copy Panel ─────────────────────────────────────────────────────
// shows two copy buttons: plain symbol list (for TradingView's
// watchlist-import box) + NSE:SYM format (for its symbol search)
function TVCopyPanel({stocks,label,compact}){
  // compact=true → single "Export to TradingView" button style (for top bar)
  const {copy,copied}=useCopy()
  if(!stocks||stocks.length===0)return null
  const syms=stocks.map(s=>s.sym)
  const symbolList=syms.map(s=>`NSE:${s}`).join(',')
  const alertStr=syms.map(s=>`NSE:${s}`).join('\n')
  if(compact){
    return(
      <div style={{display:'flex',gap:4}}>
        <button onClick={()=>copy(symbolList,'symlist')} title="Copy NSE:SYM list — paste into TradingView's watchlist import or symbol search"
          style={{padding:'5px 10px',borderRadius:6,border:'none',cursor:'pointer',
            background:copied==='symlist'?C.green:C.teal,color:'#000',fontSize:11,fontWeight:700,whiteSpace:'nowrap'}}>
          {copied==='symlist'?'✅ Copied':'📋 Copy for TV'} <span style={{background:'#00000033',borderRadius:4,padding:'0 4px',fontSize:10}}>{syms.length}</span>
        </button>
      </div>
    )
  }
  return(
    <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',
      background:C.card,border:`1px solid ${C.teal}33`,borderRadius:8,
      padding:'6px 12px',marginBottom:10,fontSize:11}}>
      <span style={{color:C.teal,fontWeight:700,whiteSpace:'nowrap'}}>
        📊 TV ({syms.length})
      </span>
      <button onClick={()=>copy(symbolList,'symlist')} title="Copy NSE:SYM list — paste into TradingView's watchlist import or symbol search"
        style={{padding:'4px 10px',borderRadius:6,border:`1px solid ${C.teal}33`,cursor:'pointer',
          background:copied==='symlist'?C.teal+'22':'transparent',
          color:copied==='symlist'?C.teal:C.muted,fontSize:10,fontWeight:600,whiteSpace:'nowrap'}}>
        {copied==='symlist'?'✅ Copied':'📋 Copy for TV'}
      </button>
      <button onClick={()=>copy(alertStr,'alert')} title="One symbol per line for alert wizard"
        style={{padding:'4px 10px',borderRadius:6,border:`1px solid ${C.teal}33`,cursor:'pointer',
          background:copied==='alert'?C.teal+'22':'transparent',
          color:copied==='alert'?C.teal:C.muted,fontSize:10,fontWeight:600,whiteSpace:'nowrap'}}>
        {copied==='alert'?'✅ Copied':'🔔 Alerts'}
      </button>
      {label&&<span style={{color:C.muted,fontSize:10,marginLeft:'auto',whiteSpace:'nowrap'}}>{label}</span>}
    </div>
  )
}

// ── Micro components ──────────────────────────────────────────────────
function Badge({color,children,glow,title}){
  return<span title={title} style={{fontSize:10,fontWeight:700,padding:'2px 6px',borderRadius:4,
    background:color+'22',color,whiteSpace:'nowrap',boxShadow:glow?`0 0 6px ${color}66`:'none',
    cursor:title?'help':'default'}}>{children}</span>
}
function Sparkline({data,width=70,height=26,color}){
  const valid=data.filter(v=>v!==null)
  if(valid.length<2)return null
  const min=Math.min(...valid),max=Math.max(...valid),range=max-min||1
  const pts=valid.map((v,i)=>`${(i/(valid.length-1))*width},${height-((v-min)/range)*(height-4)-2}`).join(' ')
  const lx=width,ly=height-((valid[valid.length-1]-min)/range)*(height-4)-2
  return(<svg width={width} height={height} style={{display:'block'}}>
    <polyline points={pts} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round"/>
    <circle cx={lx} cy={ly} r="2.5" fill={color}/>
  </svg>)
}
function RSCells({history,compact}){
  return(
    <div style={{display:'flex',gap:compact?2:3,flexWrap:'wrap'}}>
      {history.map((v,i)=>{
        const daysAgo=history.length-1-i,label=daysAgo===0?'T':`-${daysAgo}`
        const color=v===null?C.border:v>=90?C.green:v>=70?C.accent:v>=50?C.yellow:C.red
        const sz=compact?22:26
        return(
          <div key={i} title={`${daysAgo===0?'Today':`${daysAgo}d ago`}: RS ${v??'N/A'}`}
            style={{display:'flex',flexDirection:'column',alignItems:'center',gap:2}}>
            <div style={{width:sz,height:sz,background:v!==null?color+'28':C.border+'33',
              border:`1px solid ${v!==null?color+'88':C.border}`,borderRadius:4,
              display:'flex',alignItems:'center',justifyContent:'center',
              fontWeight:800,fontSize:compact?8:9,color:v!==null?color:C.muted}}>
              {v!==null?v:'—'}
            </div>
            <div style={{fontSize:6,color:C.muted,fontWeight:600}}>{label}</div>
          </div>
        )
      })}
    </div>
  )
}
// ── Ranked Bar Chart (Chartink-style Index Strength / Segment Advances) ──
const BAR_PALETTE = ['#4f8ef7','#e0575b','#4caf50','#d4a72c','#8b7fd6','#2ba7a0','#e0825b','#5b9bd5','#c85a9e']
// Maps an Index Dashboard name to the closest matching SECTOR_MAP key, for
// showing "constituent stocks" when an index row is expanded. Only the
// indices with a genuine matching sector are listed. Nifty 500/Next 50/
// Bank Nifty are deliberately excluded — they span every sector (or, for
// Bank Nifty, both Private+PSU banks at once) by design, so there's no
// single matching bucket, not a gap to fill. MNC/Housing/Financial
// Services/Consumption/PSE/Commodities/Chemicals/Oil & Gas/Consumer
// Durables also excluded — no verified official constituent data exists
// for these without risking an inaccurate list, which would be worse
// than the honest "not available" message for a financial tool.
const INDEX_TO_SECTOR = {
  'IT': 'IT', 'Pharma': 'Pharma', 'Auto': 'Auto', 'FMCG': 'FMCG',
  'Metal': 'Metals', 'Realty': 'Realty', 'Energy': 'Energy',
  'Healthcare': 'Healthcare', 'Infrastructure': 'Infra/Capital',
  'Private Bank': 'Private Bank', 'PSU Bank': 'PSU Bank', 'Defence': 'Defence',
  'Media': 'Telecom', // closest available bucket — not a precise match
}
function getIndexConstituents(idxName, allStocks){
  if(idxName==='Nifty 50')     return allStocks.filter(s=>s.inNifty50)
  if(idxName==='Midcap 150')   return allStocks.filter(s=>s.inMidcap)
  if(idxName==='Smallcap 250') return allStocks.filter(s=>s.inSmallcap)
  if(idxName==='Microcap 250') return allStocks.filter(s=>s.inMicrocap)
  const sectorKey = INDEX_TO_SECTOR[idxName]
  if(sectorKey) return allStocks.filter(s=>s.sector===sectorKey)
  return null // no reliable constituent mapping for this index yet
}
const chgColor = v => v>=0?C.green:C.red
const fmtChg = v => v!=null?`${v>=0?'+':''}${v.toFixed(2)}%`:'—'

function RankedBarChart({title, subtitle, items, formatVal, positiveOnly, compact}){
  if(!items||items.length===0) return null
  const maxAbs = Math.max(...items.map(i=>Math.abs(i.value??0)), positiveOnly?100:1)
  return (
    <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,
      padding:compact?10:14,marginBottom:compact?0:14}}>
      <div style={{fontWeight:800,fontSize:compact?12:14,marginBottom:2}}>{title}</div>
      {subtitle&&<div style={{fontSize:10,color:C.muted,marginBottom:8}}>{subtitle}</div>}
      <div style={{display:'flex',flexDirection:'column',gap:4,marginTop:6}}>
        {items.map((item,i)=>{
          const val = item.value ?? 0
          const widthPct = Math.max(6, Math.min(100, (Math.abs(val)/maxAbs)*100))
          const barColor = BAR_PALETTE[i % BAR_PALETTE.length]
          return (
            <div key={item.name} style={{display:'flex',alignItems:'center',gap:compact?4:8}}>
              <div style={{width:compact?36:54,textAlign:'right',fontSize:compact?9:11,fontWeight:700,color:C.muted,flexShrink:0}}>
                {formatVal ? formatVal(val) : val}
              </div>
              <div style={{flex:1,position:'relative',height:compact?20:26}}>
                <div style={{position:'absolute',left:0,top:0,height:'100%',width:`${widthPct}%`,
                  background:barColor,borderRadius:5,display:'flex',alignItems:'center',paddingLeft:compact?5:10,
                  minWidth:compact?22:36,overflow:'hidden',transition:'width 0.25s ease'}}>
                  <span style={{fontSize:compact?9:11,fontWeight:700,color:'#0a0a0f',whiteSpace:'nowrap',
                    overflow:'hidden',textOverflow:'ellipsis'}}>
                    {item.name}
                  </span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function PPDots({ppHistory, color=C.orange}){
  return(
    <div style={{display:'flex',flexDirection:'column',gap:4}}>
      <div style={{display:'flex',gap:2,alignItems:'center'}}>
        {(ppHistory||[]).map((isOn,i)=>{
          const d=(ppHistory.length-1-i)
          const isToday = d===0
          return<div key={i} title={`${isToday?'Today':`${d}d ago`}: ${isOn?'✅':'No'}`}
            style={{width:isToday?11:8,height:isToday?11:8,flexShrink:0,borderRadius:'50%',
              background:isOn?color:C.border,
              border:isToday?`1.5px solid ${C.text}`:'none',
              boxShadow:isOn?`0 0 4px ${color}`:'none'}}/>
        })}
      </div>
      {(ppHistory||[]).length>0&&(
        <div style={{fontSize:8,color:C.muted}}>← oldest &nbsp;·&nbsp; newest/today is the outlined dot →</div>
      )}
    </div>
  )
}
// Shows the 10-day dot history for whichever volume signal is actually
// this stock's top priority (HT > HY > IBV > PP) — instead of always
// hardcoding "PP 10d" even for a stock whose real signal is HT, which
// was inconsistent with the badge shown above it.
function TopSignalDots({s,withCount=true}){
  const top = topVolumeSignal(s)
  const config = {
    ht:  {label:'HT 10d',  history:s.ht.history,       color:C.orange, count:s.ht.history?.filter(Boolean).length||0},
    hy:  {label:'HY 10d',  history:s.hy.history,        color:C.pink,   count:s.hy.history?.filter(Boolean).length||0},
    ibv: {label:'IBV 10d', history:s.ibvHistory||[],    color:C.blue,   count:(s.ibvHistory||[]).filter(Boolean).length},
    pp:  {label:'PP 10d',  history:s.pp?.ppHistory||[], color:C.green,  count:s.pp?.ppCount10d||0},
  }
  const c = config[top] || config.pp
  return(
    <div style={{display:'flex',alignItems:'center',gap:8}}>
      <span style={{fontSize:10,color:C.muted}}>{c.label}:</span>
      <PPDots ppHistory={c.history} color={c.color}/>
      {withCount&&<span style={{fontSize:10,color:c.count>0?c.color:C.muted,fontWeight:700}}>{c.count}×</span>}
    </div>
  )
}
function PPFilterBar({ppFilter,setPpFilter,ppCount,total}){
  return(
    <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',
      background:C.card,border:`1px solid ${C.border}`,borderRadius:10,
      padding:'10px 14px',marginBottom:12}}>
      <span style={{fontSize:11,fontWeight:700,color:C.text}}>🔥 Pocket Pivot:</span>
      {[['all','All',C.muted],['yes',`Yes (${ppCount})`,C.orange],['no','No PP',C.muted]].map(([v,label,color])=>(
        <button key={v} onClick={()=>setPpFilter(v)}
          style={{padding:'5px 13px',borderRadius:20,border:`1px solid ${ppFilter===v?color:C.border}`,
            cursor:'pointer',fontSize:12,fontWeight:600,
            background:ppFilter===v?color+'22':'transparent',color:ppFilter===v?color:C.muted}}>{label}</button>
      ))}
      <span style={{fontSize:11,color:C.muted,marginLeft:'auto'}}>Showing {total}</span>
    </div>
  )
}
function RefreshBar({lastRefresh,interval,loading,onRefresh}){
  const [now,setNow]=useState(Date.now())
  useEffect(()=>{const t=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(t)},[])
  const elapsed=now-lastRefresh,pct=Math.min(100,(elapsed/interval)*100)
  const remaining=Math.max(0,Math.round((interval-elapsed)/1000))
  const mm=String(Math.floor(remaining/60)).padStart(2,'0'),ss=String(remaining%60).padStart(2,'0')
  return(
    <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:'10px 14px',marginBottom:12}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:6}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <div style={{width:8,height:8,borderRadius:'50%',background:loading?C.yellow:C.green,boxShadow:`0 0 6px ${loading?C.yellow:C.green}`}}/>
          <span style={{fontSize:12,fontWeight:600,color:C.text}}>{loading?'Refreshing…':'Auto-refresh ON'}</span>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <span style={{fontSize:11,color:C.muted}}>Next: <span style={{color:C.accent,fontWeight:700}}>{mm}:{ss}</span></span>
          <button onClick={onRefresh} disabled={loading}
            style={{padding:'4px 10px',borderRadius:6,border:`1px solid ${C.accent}44`,
              background:'transparent',color:C.accent,fontSize:11,fontWeight:600,cursor:'pointer'}}>↻ Now</button>
        </div>
      </div>
      <div style={{width:'100%',background:C.border,borderRadius:99,height:3,overflow:'hidden'}}>
        <div style={{width:`${pct}%`,height:'100%',background:C.accent,borderRadius:99,transition:'width 0.5s linear'}}/>
      </div>
      <div style={{display:'flex',justifyContent:'space-between',marginTop:5,fontSize:10,color:C.muted}}>
        <span>Last: {fmtDT(lastRefresh)}</span><span>Every {interval/60000}min</span>
      </div>
    </div>
  )
}

// ── Last Updated Bar — shows on every page ───────────────────────────
// ── History Calendar Picker ─────────────────────────────────────────
// Replaces a plain <select> of dates with a visual month calendar —
// available snapshot dates are clickable, everything else is greyed
// out. availableDates comes from fetchAvailableHistoryDates(), sorted
// newest-first.
function HistoryCalendarPicker({historyDate, setHistoryDate, availableDates, isMobile}){
  const [open, setOpen] = useState(false)
  const availSet = useMemo(() => new Set(availableDates), [availableDates])
  const initialMonth = useMemo(() => {
    const base = historyDate || availableDates[0] || new Date().toISOString().slice(0,10)
    return base.slice(0,7) // 'YYYY-MM'
  }, [historyDate, availableDates])
  const [viewMonth, setViewMonth] = useState(initialMonth)
  useEffect(() => { if(open) setViewMonth(initialMonth) }, [open, initialMonth])

  const [y, m] = viewMonth.split('-').map(Number)
  const firstOfMonth = new Date(y, m-1, 1)
  const startWeekday = firstOfMonth.getDay() // 0=Sun
  const daysInMonth = new Date(y, m, 0).getDate()
  const monthLabel = firstOfMonth.toLocaleDateString('en-IN',{month:'long',year:'numeric'})
  const pad = n => String(n).padStart(2,'0')
  const dateStr = d => `${y}-${pad(m)}-${pad(d)}`

  const changeMonth = delta => {
    const d = new Date(y, m-1+delta, 1)
    setViewMonth(`${d.getFullYear()}-${pad(d.getMonth()+1)}`)
  }

  const todayStr = new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'short'})
  const label = historyDate
    ? `📅 ${new Date(historyDate).toLocaleDateString('en-IN',{day:'2-digit',month:'short'})}`
    : `📅 ${todayStr}`

  return (
    <div style={{position:'relative'}}>
      <button onClick={()=>setOpen(v=>!v)}
        style={{padding:isMobile?'8px':'5px 8px',background:historyDate?C.purple+'22':C.card,
          border:`1px solid ${historyDate?C.purple+'66':C.border}`,
          borderRadius:isMobile?8:6,color:historyDate?C.purple:C.text,fontSize:isMobile?11:11,
          outline:'none',cursor:'pointer',fontWeight:historyDate?700:400,whiteSpace:'nowrap'}}>
        {label}
      </button>
      {open && (
        <>
          <div onClick={()=>setOpen(false)} style={{position:'fixed',inset:0,zIndex:59}}/>
          <div style={{position:'absolute',top:'110%',left:0,zIndex:60,width:260,
            background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:12,
            boxShadow:'0 12px 32px rgba(0,0,0,0.4)'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
              <button onClick={()=>changeMonth(-1)} style={{background:'transparent',border:'none',
                color:C.muted,cursor:'pointer',fontSize:14,padding:4}}>◀</button>
              <span style={{fontSize:12,fontWeight:700,color:C.text}}>{monthLabel}</span>
              <button onClick={()=>changeMonth(1)} style={{background:'transparent',border:'none',
                color:C.muted,cursor:'pointer',fontSize:14,padding:4}}>▶</button>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:2,marginBottom:4}}>
              {['S','M','T','W','T','F','S'].map((d,i)=>(
                <div key={i} style={{textAlign:'center',fontSize:9,color:C.muted,fontWeight:700}}>{d}</div>
              ))}
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:2}}>
              {Array.from({length:startWeekday}).map((_,i)=><div key={'blank'+i}/>)}
              {Array.from({length:daysInMonth}).map((_,i)=>{
                const d = i+1
                const ds = dateStr(d)
                const available = availSet.has(ds)
                const isSelected = historyDate===ds
                return (
                  <button key={d} disabled={!available}
                    onClick={()=>{setHistoryDate(ds);setOpen(false)}}
                    style={{aspectRatio:'1',borderRadius:6,fontSize:11,fontWeight:isSelected?800:500,
                      border:isSelected?`1.5px solid ${C.purple}`:'1px solid transparent',
                      background:isSelected?C.purple+'33':available?C.bg:'transparent',
                      color:available?(isSelected?C.purple:C.text):C.border,
                      cursor:available?'pointer':'default'}}>
                    {d}
                  </button>
                )
              })}
            </div>
            <button onClick={()=>{setHistoryDate(null);setOpen(false)}}
              style={{width:'100%',marginTop:10,padding:'7px',borderRadius:7,
                border:`1px solid ${!historyDate?C.accent:C.border}`,
                background:!historyDate?C.accent+'22':'transparent',
                color:!historyDate?C.accent:C.muted,fontSize:11,fontWeight:700,cursor:'pointer'}}>
              📅 Back to Live
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function LastUpdatedBar({scanMeta,lastRefresh,loading,autoRefresh,setAutoRefresh,refreshInterval,setRefreshInterval,onRefresh}){
  const [now,setNow]=useState(Date.now())
  useEffect(()=>{const t=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(t)},[])

  const isMarketOpen=()=>{
    const ist=new Date(now+((330+new Date().getTimezoneOffset())*60000))
    const day=ist.getDay()
    if(day===0||day===6)return false
    const h=ist.getHours(),m=ist.getMinutes()
    const mins=h*60+m
    return mins>=555&&mins<=930 // 9:15 to 15:30
  }
  const marketOpen=isMarketOpen()

  // Next scan countdown
  const nextScan=scanMeta?.next_scan?new Date(scanMeta.next_scan).getTime():null
  const remaining=nextScan?Math.max(0,Math.round((nextScan-now)/1000)):null
  const mm=remaining!=null?String(Math.floor(remaining/60)).padStart(2,'0'):null
  const ss=remaining!=null?String(remaining%60).padStart(2,'0'):null

  // Last scan time
  const lastScan=scanMeta?.last_scan||null
  const lastScanStr=lastScan?new Date(lastScan).toLocaleString('en-IN',{
    day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true
  }):'—'

  // Progress bar
  const pct=lastRefresh?Math.min(100,((now-lastRefresh)/refreshInterval)*100):0

  return(
    <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,
      padding:'7px 12px',marginBottom:10}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',
        flexWrap:'wrap',gap:6}}>
        {/* Status */}
        <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap',fontSize:11}}>
          <div style={{display:'flex',alignItems:'center',gap:5}}>
            <div style={{width:7,height:7,borderRadius:'50%',
              background:loading?C.yellow:marketOpen?C.green:C.muted,
              boxShadow:`0 0 5px ${loading?C.yellow:marketOpen?C.green:C.muted}`,
              animation:loading?'pulse 1s infinite':'none'}}/>
            <span style={{fontWeight:700,color:C.text}}>
              {loading?'Updating…':marketOpen?'Live':'Closed'}
            </span>
          </div>
          <span style={{color:C.muted}}>· {lastScanStr}</span>
          {scanMeta?.stocks_count&&(
            <span style={{color:C.muted}}>· <strong style={{color:C.accent}}>{scanMeta.stocks_count}</strong></span>
          )}
          {scanMeta?.scan_type&&(
            <span style={{padding:'1px 6px',borderRadius:20,fontSize:9,fontWeight:600,
              background:C.accent+'22',color:C.accent}}>
              {scanMeta.scan_type==='live'?'⚡':scanMeta.scan_type==='batch_morning'?'🌅':'🌆'}
            </span>
          )}
        </div>
        {/* Controls */}
        <div style={{display:'flex',alignItems:'center',gap:6}}>
          {remaining!=null&&!loading&&(
            <span style={{fontSize:10,color:C.muted}}>
              <span style={{color:C.accent,fontWeight:700}}>{mm}:{ss}</span>
            </span>
          )}
          <button onClick={onRefresh} disabled={loading}
            style={{padding:'3px 8px',borderRadius:5,border:`1px solid ${C.accent}44`,
              background:'transparent',color:C.accent,fontSize:10,fontWeight:600,cursor:'pointer'}}>
            ↻
          </button>
          <button onClick={()=>setAutoRefresh(v=>!v)}
            style={{padding:'3px 8px',borderRadius:5,
              border:`1px solid ${autoRefresh?C.green:C.border}`,
              background:autoRefresh?C.green+'22':'transparent',
              color:autoRefresh?C.green:C.muted,fontSize:10,fontWeight:600,cursor:'pointer'}}>
            {autoRefresh?'⏸':'▶'}
          </button>
          <select value={refreshInterval} onChange={e=>setRefreshInterval(+e.target.value)}
            style={{padding:'4px 7px',background:C.card,border:`1px solid ${C.border}`,
              borderRadius:6,color:C.text,fontSize:10,outline:'none',cursor:'pointer'}}>
            <option value={60000}>1 min</option>
            <option value={120000}>2 min</option>
            <option value={300000}>5 min</option>
            <option value={600000}>10 min</option>
          </select>
        </div>
      </div>
    </div>
  )
}

// ── Stage Badge ──────────────────────────────────────────────────────
function StageBadge({stage}){
  return(
    <div title={stage.desc}
      style={{display:'inline-flex',alignItems:'center',
        padding:'1px 5px',borderRadius:3,fontSize:8,fontWeight:700,
        background:stage.color+'18',color:stage.color,
        border:`1px solid ${stage.color}33`,whiteSpace:'nowrap',cursor:'help',
        letterSpacing:'0.03em'}}>
      {stage.label}
    </div>
  )
}

// ── Volume Badge ──────────────────────────────────────────────────────
function VolBadge({vol}){
  return(
    <div style={{display:'inline-flex',alignItems:'center',gap:3,
      padding:'2px 7px',borderRadius:5,fontSize:9,fontWeight:700,
      background:vol.color+'18',color:vol.color,whiteSpace:'nowrap'}}>
      {vol.label} <span style={{fontSize:8,opacity:0.7}}>{vol.pct}%</span>
    </div>
  )
}

// ── Preset Filter Bar ─────────────────────────────────────────────────
function PresetFilterBar({active,setActive,stocks}){
  const counts = {}
  PRESETS.forEach(p => {
    if(p.id === 'all')       counts[p.id] = stocks.length
    else if(p.id === 'pp')       counts[p.id] = stocks.filter(s=>topVolumeSignal(s)==='pp').length
    else if(p.id === 'ema9')     counts[p.id] = stocks.filter(s=>s.nearEMA9?.isNearEMA9).length
    else if(p.id === 'hy')       counts[p.id] = stocks.filter(s=>topVolumeSignal(s)==='hy').length
    else if(p.id === 'ht')       counts[p.id] = stocks.filter(s=>topVolumeSignal(s)==='ht').length
    else if(p.id === 'rs90')     counts[p.id] = stocks.filter(s=>(s.rsTv??s.rs)>=90).length
    else if(p.id === 'rs80')     counts[p.id] = stocks.filter(s=>(s.rsTv??s.rs)>=80).length
    else if(p.id === 'impr')     counts[p.id] = stocks.filter(s=>s.rsTrend?.trend==='improving').length
    else if(p.id === 'power')    counts[p.id] = stocks.filter(s=>topVolumeSignal(s)==='pp'&&s.rs>=80).length
    else if(p.id === 's2')       counts[p.id] = stocks.filter(s=>calcWeinsteinStage(s).stage===2).length
    else if(p.id === 's1')       counts[p.id] = stocks.filter(s=>calcWeinsteinStage(s).stage===1).length
    else if(p.id === 's3')       counts[p.id] = stocks.filter(s=>calcWeinsteinStage(s).stage===3).length
    else if(p.id === 's4')       counts[p.id] = stocks.filter(s=>calcWeinsteinStage(s).stage===4).length
    else if(p.id === 'surge')    counts[p.id] = stocks.filter(s=>s.hy?.pctOfMax>=95).length
    else if(p.id === 'ibv')      counts[p.id] = stocks.filter(s=>topVolumeSignal(s)==='ibv').length
    else if(p.id === 'breakout') counts[p.id] = stocks.filter(s=>calcHYHTBreakout(s).isBreakout).length
  })

  return(
    <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,
      padding:'12px 14px',marginBottom:12}}>
      <div style={{fontSize:11,fontWeight:700,color:C.muted,marginBottom:10,textTransform:'uppercase',letterSpacing:'0.08em'}}>
        ⚡ Quick Filters
      </div>
      <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
        {PRESETS.map(p=>(
          <button key={p.id} onClick={()=>setActive(p.id)}
            title={p.desc}
            style={{display:'flex',alignItems:'center',gap:5,
              padding:'7px 12px',borderRadius:8,cursor:'pointer',
              border:`1px solid ${active===p.id?C.accent:C.border}`,
              background:active===p.id?C.accent+'22':'transparent',
              color:active===p.id?C.accent:C.muted,
              fontWeight:active===p.id?700:500,fontSize:12,
              transition:'all 0.15s'}}>
            <span>{p.icon}</span>
            <span>{p.label}</span>
            {counts[p.id]!=null&&(
              <span style={{fontSize:10,fontWeight:800,
                color:active===p.id?C.accent:C.muted,
                background:active===p.id?C.accent+'22':C.border+'88',
                padding:'1px 5px',borderRadius:99}}>
                {counts[p.id]}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Watchlist Manager ─────────────────────────────────────────────────
function WatchlistManager({watchlists,activeWl,setActiveWl,onSave,onDelete,allKnownStocks}){
  const [wlName,setWlName]=useState('')
  const [manualSym,setManualSym]=useState('')
  const [showSuggest,setShowSuggest]=useState(false)
  const [editId,setEditId]=useState(null)
  const [editStocks,setEditStocks]=useState([])
  const [dragOver,setDragOver]=useState(false)
  const fileRef=useRef()
  const {copy,copied}=useCopy()

  // Autocomplete suggestions for the manual-add input, sourced from the
  // full live stock universe (allKnownStocks) — previously this prop was
  // passed in but never actually used, so this field was pure blind text
  // entry with no way to browse/search what's trackable. Matches on the
  // last comma/space-separated token being typed, so multi-symbol paste
  // still works; prefix matches rank above substring matches.
  const suggestQuery=manualSym.split(/[\s,;]+/).pop().toUpperCase().trim()
  const suggestions=suggestQuery.length>=1?(()=>{
    const already=new Set(editStocks)
    const prefix=[],substr=[]
    for(const st of allKnownStocks){
      if(already.has(st.sym))continue
      if(st.sym.startsWith(suggestQuery))prefix.push(st)
      else if(st.sym.includes(suggestQuery))substr.push(st)
      if(prefix.length>=8)break
    }
    return [...prefix,...substr].slice(0,8)
  })():[]

  const pickSuggestion=sym=>{
    const parts=manualSym.split(/[\s,;]+/).map(s=>s.trim().toUpperCase()).filter(Boolean)
    parts[parts.length-1]=sym  // replace the in-progress token with the picked symbol
    setEditStocks(prev=>[...new Set([...prev,...parts])])
    setManualSym('')
    setShowSuggest(false)
  }

  const addManual=()=>{
    const syms=manualSym.toUpperCase().split(/[\s,;]+/).map(s=>s.trim()).filter(Boolean)
    const deduped=[...new Set([...editStocks,...syms])]
    setEditStocks(deduped);setManualSym('');setShowSuggest(false)
  }

  const parseCSV=file=>{
    const reader=new FileReader()
    reader.onload=e=>{
      const text=e.target.result
      const syms=text.split(/[\n,;\r]+/).map(s=>s.trim().toUpperCase().replace(/^NSE:/,'')).filter(s=>s&&/^[A-Z&-]+$/.test(s))
      setEditStocks(prev=>[...new Set([...prev,...syms])])
    }
    reader.readAsText(file)
  }

  const handleDrop=e=>{
    e.preventDefault();setDragOver(false)
    const file=e.dataTransfer.files[0]
    if(file)parseCSV(file)
  }

  const saveEdit=()=>{
    if(editId==='__draft__'){
      if(!wlName.trim())return  // require a name before creating
      const id=Date.now().toString()
      onSave({id,name:wlName.trim(),stocks:editStocks,createdAt:Date.now()})
    }else{
      const wl=watchlists.find(w=>w.id===editId)
      if(!wl)return
      onSave({...wl,name:wlName.trim()||wl.name,stocks:editStocks})
    }
    setEditId(null);setEditStocks([]);setWlName('')
  }

  const startEdit=wl=>{setEditId(wl.id);setEditStocks([...wl.stocks]);setWlName(wl.name)}
  const startCreate=()=>{setEditId('__draft__');setEditStocks([]);setWlName('')}

  return(
    <div>
      {/* Watchlist selector row */}
      <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:12,alignItems:'center'}}>
        <span style={{fontSize:12,fontWeight:700,color:C.text}}>📋 Watchlist:</span>
        <button onClick={()=>setActiveWl(null)}
          style={{padding:'6px 13px',borderRadius:20,border:`1px solid ${activeWl===null?C.accent:C.border}`,
            cursor:'pointer',fontSize:12,fontWeight:600,
            background:activeWl===null?C.accent+'22':'transparent',
            color:activeWl===null?C.accent:C.muted}}>
          All Stocks
        </button>
        {watchlists.map(wl=>(
          <button key={wl.id} onClick={()=>setActiveWl(wl.id)}
            style={{padding:'6px 13px',borderRadius:20,border:`1px solid ${activeWl===wl.id?C.accent:C.border}`,
              cursor:'pointer',fontSize:12,fontWeight:600,
              background:activeWl===wl.id?C.accent+'22':'transparent',
              color:activeWl===wl.id?C.accent:C.muted}}>
            {wl.name} <span style={{color:C.muted,fontWeight:400}}>({wl.stocks.length})</span>
          </button>
        ))}
        <button onClick={startCreate}
          style={{padding:'6px 13px',borderRadius:20,border:`1px solid ${C.green}44`,
            cursor:'pointer',fontSize:12,fontWeight:600,background:'transparent',color:C.green}}>
          + New Watchlist
        </button>
      </div>

      {/* Create/Edit panel — one unified flow instead of a separate
          "name it, click Create, THEN see a different screen to add
          stocks" split, which people kept getting stuck on (typing a
          stock symbol into the name field, expecting suggestions there).
          editId==='__draft__' is the sentinel for "creating a new one";
          everything else works exactly like editing an existing list. */}
      {editId&&(()=>{
        const isDraft=editId==='__draft__'
        const wl=isDraft?{name:wlName,id:'__draft__'}:watchlists.find(w=>w.id===editId)
        if(!wl)return null
        return(
          <div style={{background:C.card,border:`1px solid ${C.accent}44`,borderRadius:12,padding:'16px',marginBottom:12}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
              <div style={{fontWeight:800,fontSize:14,color:C.accent}}>{isDraft?'✨ New Watchlist':`✏️ Editing: ${wl.name}`}</div>
              <div style={{display:'flex',gap:8}}>
                <button onClick={saveEdit}
                  style={{padding:'6px 14px',borderRadius:7,border:'none',cursor:'pointer',
                    background:C.accent,color:'#000',fontWeight:700,fontSize:12}}>
                  {isDraft?'✓ Create':'💾 Save'}
                </button>
                <button onClick={()=>{setEditId(null);setEditStocks([]);setWlName('')}}
                  style={{padding:'6px 14px',borderRadius:7,border:`1px solid ${C.border}`,cursor:'pointer',
                    background:'transparent',color:C.muted,fontWeight:600,fontSize:12}}>Cancel</button>
                {!isDraft&&(
                  <button onClick={()=>{onDelete(wl.id);setEditId(null);setEditStocks([]);setWlName('')}}
                    style={{padding:'6px 14px',borderRadius:7,border:`1px solid ${C.red}44`,cursor:'pointer',
                      background:'transparent',color:C.red,fontWeight:600,fontSize:12}}>🗑 Delete</button>
                )}
              </div>
            </div>

            {/* Name field — always shown, whether creating or editing */}
            <div style={{marginBottom:14}}>
              <div style={{fontSize:11,fontWeight:700,color:C.muted,marginBottom:6}}>Watchlist name</div>
              <input value={wlName} onChange={e=>setWlName(e.target.value)}
                placeholder="e.g. My Top Picks"
                style={{width:'100%',padding:'8px 12px',background:C.bg,border:`1px solid ${C.border}`,
                  borderRadius:8,color:C.text,fontSize:13,outline:'none',boxSizing:'border-box'}}/>
            </div>

            {/* Manual add */}
            <div style={{marginBottom:12,position:'relative'}}>
              <div style={{fontSize:11,fontWeight:700,color:C.muted,marginBottom:6}}>Add stocks manually (comma or space separated)</div>
              <div style={{display:'flex',gap:8}}>
                <input value={manualSym}
                  onChange={e=>{setManualSym(e.target.value);setShowSuggest(true)}}
                  onFocus={()=>setShowSuggest(true)}
                  onBlur={()=>setTimeout(()=>setShowSuggest(false),150)}
                  onKeyDown={e=>e.key==='Enter'&&addManual()}
                  placeholder="RELIANCE, TCS, INFY..."
                  style={{flex:1,padding:'8px 12px',background:C.bg,border:`1px solid ${C.border}`,
                    borderRadius:8,color:C.text,fontSize:13,outline:'none',fontFamily:'monospace'}}/>
                <button onClick={addManual}
                  style={{padding:'8px 14px',borderRadius:8,border:'none',cursor:'pointer',
                    background:C.accent,color:'#000',fontWeight:700,fontSize:13}}>Add</button>
              </div>
              {showSuggest&&suggestions.length>0&&(
                <div style={{position:'absolute',top:'100%',left:0,right:70,marginTop:4,zIndex:20,
                  background:C.card,border:`1px solid ${C.border}`,borderRadius:8,
                  maxHeight:220,overflowY:'auto',boxShadow:'0 8px 20px rgba(0,0,0,0.4)'}}>
                  {suggestions.map(st=>(
                    <div key={st.sym} onMouseDown={()=>pickSuggestion(st.sym)}
                      style={{padding:'8px 12px',cursor:'pointer',display:'flex',
                        justifyContent:'space-between',alignItems:'center',
                        borderBottom:`1px solid ${C.divider}`,fontSize:12}}>
                      <span style={{fontWeight:700}}>{st.sym}</span>
                      {st.sector&&<span style={{color:C.muted,fontSize:10}}>{st.sector}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* CSV upload / drag-drop */}
            <div
              onDragOver={e=>{e.preventDefault();setDragOver(true)}}
              onDragLeave={()=>setDragOver(false)}
              onDrop={handleDrop}
              onClick={()=>fileRef.current.click()}
              style={{border:`2px dashed ${dragOver?C.accent:C.border}`,borderRadius:10,
                padding:'18px',textAlign:'center',cursor:'pointer',marginBottom:12,
                background:dragOver?C.accent+'10':'transparent',transition:'all 0.2s'}}>
              <div style={{fontSize:22,marginBottom:6}}>📁</div>
              <div style={{fontSize:12,fontWeight:600,color:dragOver?C.accent:C.muted}}>
                {dragOver?'Drop CSV here!':'Drag & drop CSV file or click to upload'}
              </div>
              <div style={{fontSize:11,color:C.muted,marginTop:4}}>
                CSV format: one symbol per line, or comma-separated. NSE: prefix optional.
              </div>
              <input ref={fileRef} type="file" accept=".csv,.txt" style={{display:'none'}}
                onChange={e=>{if(e.target.files[0])parseCSV(e.target.files[0])}}/>
            </div>

            {/* TV copy of watchlist */}
            {editStocks.length>0&&(
              <div style={{marginBottom:12}}>
                <TVCopyPanel stocks={editStocks.map(s=>({sym:s}))} label={wl.name}/>
              </div>
            )}

            {/* Stock chips */}
            {editStocks.length>0&&(
              <div>
                <div style={{fontSize:11,fontWeight:700,color:C.muted,marginBottom:8}}>
                  {editStocks.length} stocks — click × to remove
                </div>
                <div style={{display:'flex',flexWrap:'wrap',gap:6,maxHeight:200,overflowY:'auto'}}>
                  {editStocks.map(sym=>(
                    <div key={sym} style={{display:'flex',alignItems:'center',gap:4,
                      padding:'4px 10px',borderRadius:20,background:C.bg,
                      border:`1px solid ${C.border}`,fontSize:12,fontWeight:600}}>
                      {sym}
                      <span onClick={()=>setEditStocks(prev=>prev.filter(s=>s!==sym))}
                        style={{cursor:'pointer',color:C.red,fontWeight:800,marginLeft:2,fontSize:14,lineHeight:1}}>×</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      })()}

      {/* List of watchlists with edit buttons */}
      {watchlists.length>0&&!editId&&(
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          {watchlists.map(wl=>(
            <button key={wl.id} onClick={()=>startEdit(wl)}
              style={{padding:'5px 12px',borderRadius:8,border:`1px solid ${C.border}`,
                cursor:'pointer',fontSize:11,fontWeight:600,background:'transparent',color:C.muted}}>
              ✏️ Edit {wl.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Stock detail expand ───────────────────────────────────────────────
// ── 2Y Price History Chart (from Supabase stock_full_history) ────────
const HISTORY_RANGES = { '3M': 63, '6M': 126, '1Y': 252, '2Y': 100000 }

function PriceHistoryChart({ sym }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState('1Y')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setData(null)
    fetchStockFullHistory(sym)
      .then(res => { if (!cancelled) setData(res) })
      .catch(() => { if (!cancelled) setData(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [sym])

  if (loading) {
    return <div style={{fontSize:11,color:C.muted,padding:'10px 0'}}>Loading 2Y price history…</div>
  }
  if (!data || !data.prices || data.prices.length === 0) {
    return null // no history fetched yet for this symbol — fail quietly
  }

  const days = HISTORY_RANGES[range]
  const start = Math.max(0, data.prices.length - days)
  const chartData = data.dates.slice(start).map((d, i) => ({
    date:  d,
    price: data.prices[start + i],
  }))

  return (
    <div style={{marginBottom:14}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
        <div style={{fontSize:11,fontWeight:800,color:C.blue,textTransform:'uppercase'}}>📉 Price History</div>
        <div style={{display:'flex',gap:4}}>
          {Object.keys(HISTORY_RANGES).map(r => (
            <button key={r} onClick={() => setRange(r)}
              style={{padding:'3px 8px',borderRadius:6,border:`1px solid ${range===r?C.blue:C.border}`,
                background:range===r?C.blue+'22':'transparent',color:range===r?C.blue:C.muted,
                fontSize:10,fontWeight:700,cursor:'pointer'}}>{r}</button>
          ))}
        </div>
      </div>
      <div style={{background:C.bg,borderRadius:8,padding:'8px',height:160}}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{top:4,right:8,bottom:0,left:0}}>
            <XAxis dataKey="date" hide/>
            <YAxis domain={['auto','auto']} hide/>
            <Tooltip
              contentStyle={{background:C.card,border:`1px solid ${C.border}`,fontSize:11,borderRadius:6}}
              labelStyle={{color:C.muted}}
              formatter={(v) => [fmtP(v), 'Close']}
            />
            <Line type="monotone" dataKey="price" stroke={C.blue} strokeWidth={1.5} dot={false}/>
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div style={{fontSize:9,color:C.muted,marginTop:4}}>
        {data.daysCount} days total
        {data.updatedAt ? ` · updated ${new Date(data.updatedAt).toLocaleDateString('en-IN')}` : ''}
      </div>
    </div>
  )
}

function StockDetail({s}){
  const {copy,copied}=useCopy()
  return(
    <div style={{borderTop:`1px solid ${C.border}`,padding:'14px'}}>
      {/* TV copy for single stock */}
      <div style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap'}}>
        <button onClick={()=>copy(`NSE:${s.sym}`,'tv')}
          style={{padding:'5px 12px',borderRadius:7,border:`1px solid ${C.teal}44`,cursor:'pointer',
            background:copied==='tv'?C.teal+'22':'transparent',color:copied==='tv'?C.teal:C.muted,
            fontSize:11,fontWeight:600}}>
          {copied==='tv'?'✅ Copied!':'📊 Copy NSE:'+s.sym}
        </button>
      </div>

      {/* RS 15-day */}
      <div style={{marginBottom:14}}>
        <div style={{fontSize:11,fontWeight:800,color:C.accent,marginBottom:8,textTransform:'uppercase'}}>📈 RS — Last 15 Days</div>
        <RSCells history={s.hist} compact/>
        <div style={{marginTop:10,background:C.bg,borderRadius:8,padding:'10px'}}>
          <Sparkline data={s.hist} width={320} height={44} color={rsColor(s.rs)}/>
        </div>
      </div>

      {/* 2Y Price History (from Supabase stock_full_history) */}
      <PriceHistoryChart sym={s.sym}/>

      {/* PP 10-day */}
      <div style={{marginBottom:14}}>
        <div style={{fontSize:11,fontWeight:800,color:C.green,marginBottom:8,textTransform:'uppercase'}}>🔥 Pocket Pivot — Last 10 Days</div>
        <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
          <PPDots ppHistory={s.pp.ppHistory||[]} color={C.green}/>
          <span style={{fontSize:12,color:C.green,fontWeight:700}}>{s.pp.ppCount10d} PP in 10 days</span>
        </div>
        <div style={{fontSize:11,color:C.muted,marginTop:6}}>
          10-MA: <strong style={{color:C.text}}>{s.pp.ma10?fmtP(s.pp.ma10):'—'}</strong>&nbsp;·&nbsp;
          50-MA: <strong style={{color:C.text}}>{s.pp.ma50?fmtP(s.pp.ma50):'—'}</strong>&nbsp;·&nbsp;
          Vol: <strong style={{color:s.pp.isPP?C.green:C.muted}}>{s.pp.volRatio}x</strong>
        </div>
      </div>

      {/* IBV / HY / HT 10-day */}
      <div style={{marginBottom:14}}>
        <div style={{fontSize:11,fontWeight:800,color:C.blue,marginBottom:8,textTransform:'uppercase'}}>🏛️ IBV — Last 10 Days</div>
        <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
          <PPDots ppHistory={s.ibvHistory||[]} color={C.blue}/>
          <span style={{fontSize:12,color:C.blue,fontWeight:700}}>{(s.ibvHistory||[]).filter(Boolean).length} IBV in 10 days</span>
        </div>
      </div>
      <div style={{marginBottom:14}}>
        <div style={{fontSize:11,fontWeight:800,color:C.pink,marginBottom:8,textTransform:'uppercase'}}>📊 HY — Last 10 Days</div>
        <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
          <PPDots ppHistory={s.hy.history} color={C.pink}/>
          <span style={{fontSize:12,color:C.pink,fontWeight:700}}>{s.hy.history.filter(Boolean).length} HY in 10 days</span>
        </div>
      </div>
      <div style={{marginBottom:14}}>
        <div style={{fontSize:11,fontWeight:800,color:C.orange,marginBottom:8,textTransform:'uppercase'}}>🚀 HT — Last 10 Days</div>
        <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
          <PPDots ppHistory={s.ht.history} color={C.orange}/>
          <span style={{fontSize:12,color:C.orange,fontWeight:700}}>{s.ht.history.filter(Boolean).length} HT in 10 days</span>
        </div>
      </div>

      {/* Stats */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
        {[
          ['RS-TV',s.rsTv??'—',s.rsTv!=null?rsColor(s.rsTv):C.muted],
          ['RS in Sector',s.rsSector??'—',s.rsSector!=null?rsColor(s.rsSector):C.muted],
          ['RS in Midcap',s.rsMidcap??'—',s.rsMidcap!=null?rsColor(s.rsMidcap):C.muted],
          ['RS in Smallcap',s.rsSmallcap??'—',s.rsSmallcap!=null?rsColor(s.rsSmallcap):C.muted],
          ['RS in Microcap',s.rsMicrocap??'—',s.rsMicrocap!=null?rsColor(s.rsMicrocap):C.muted],
          ['15D High RS',Math.max(...s.hist.filter(Boolean)),C.green],
          ['15D Low RS',Math.min(...s.hist.filter(Boolean)),C.red],
          ['15D Avg RS',Math.round(s.hist.filter(Boolean).reduce((a,b)=>a+b,0)/Math.max(1,s.hist.filter(Boolean).length)),C.accent],
          ['RS Slope',`${s.rsTrend.slope>0?'+':''}${s.rsTrend.slope}/d`,trendColor(s.rsTrend.trend)],
          ['9-EMA',s.nearEMA9.ema9?fmtP(s.nearEMA9.ema9):'—',s.nearEMA9.isNearEMA9?C.green:C.muted],
          ['EMA9 Dist',s.nearEMA9.pctFromEMA9!=null?`${s.nearEMA9.pctFromEMA9>0?'+':''}${s.nearEMA9.pctFromEMA9}%`:'—',s.nearEMA9.isNearEMA9?C.green:C.yellow],
          ['HY%',`${s.hy.pctOfMax}%`,s.hy.isHY?C.blue:C.muted],
          ['HT%',`${s.ht.pctOfATH}%`,s.ht.isHT?C.purple:C.muted],
          ['R1 Resistance',s.resistanceR1?fmtP(s.resistanceR1):'—',s.isResistanceBreakout?C.red:C.muted],
          ['52W High',`${s.pctFromHigh.toFixed(1)}%`,s.pctFromHigh>=-5?C.green:C.yellow],
          ['Sector',s.sector,C.muted],
          ['Day Chg',`${s.chg>=0?'+':''}${s.chg.toFixed(2)}%`,s.chg>=0?C.green:C.red],
        ].map(([k,v,c])=>(
          <div key={k} style={{background:C.bg,borderRadius:8,padding:'9px 11px'}}>
            <div style={{fontSize:9,color:C.muted,marginBottom:2,textTransform:'uppercase',letterSpacing:'0.06em'}}>{k}</div>
            <div style={{fontWeight:800,fontSize:14,color:c}}>{v}</div>
          </div>
        ))}
      </div>

      {/* Fundamentals — snapshot + growth/trend (from Screener.in) */}
      <div style={{marginTop:14}}>
        <div style={{fontSize:11,fontWeight:800,color:C.teal,marginBottom:8,textTransform:'uppercase'}}>💰 Fundamentals</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
          {[
            ['Market Cap', s.marketCap!=null?(s.marketCap>=100000?`₹${(s.marketCap/100000).toFixed(1)}L Cr`:`₹${s.marketCap.toFixed(0)} Cr`):'—', C.text],
            ['P/E', s.pe!=null?s.pe.toFixed(1):'—', s.pe!=null?(s.pe<20?C.green:s.pe<40?C.yellow:C.red):C.muted],
            ['PEG Ratio', s.pegRatio!=null?s.pegRatio.toFixed(2):'—', s.pegRatio!=null?(s.pegRatio<1?C.green:s.pegRatio<2?C.yellow:C.red):C.muted],
            ['ROE', s.roe!=null?`${s.roe.toFixed(1)}%`:'—', s.roe!=null?(s.roe>20?C.green:s.roe>10?C.yellow:C.red):C.muted],
            ['Debt/Equity', s.debtEq!=null?s.debtEq.toFixed(2):'—', s.debtEq!=null?(s.debtEq<0.5?C.green:s.debtEq<1.5?C.yellow:C.red):C.muted],
            ['EPS', s.eps!=null?`₹${s.eps.toFixed(1)}`:'—', C.text],
            ['EPS QoQ', s.epsQoq!=null?`${s.epsQoq>0?'+':''}${s.epsQoq.toFixed(1)}%`:'—', s.epsQoq!=null?(s.epsQoq>0?C.green:C.red):C.muted],
            ['EPS YoY', s.epsYoy!=null?`${s.epsYoy>0?'+':''}${s.epsYoy.toFixed(1)}%`:'—', s.epsYoy!=null?(s.epsYoy>0?C.green:C.red):C.muted],
            ['EPS Growth Streak', s.epsGrowthStreak!=null?`${s.epsGrowthStreak}Q`:'—', s.epsGrowthStreak>=3?C.green:C.muted],
            ['Sales QoQ', s.salesQoq!=null?`${s.salesQoq>0?'+':''}${s.salesQoq.toFixed(1)}%`:'—', s.salesQoq!=null?(s.salesQoq>0?C.green:C.red):C.muted],
            ['Sales YoY', s.salesYoy!=null?`${s.salesYoy>0?'+':''}${s.salesYoy.toFixed(1)}%`:'—', s.salesYoy!=null?(s.salesYoy>0?C.green:C.red):C.muted],
            ['OPM %', s.opmPct!=null?`${s.opmPct.toFixed(1)}%`:'—', C.text],
            ['OPM Trend', s.opmTrend!=null?`${s.opmTrend>0?'+':''}${s.opmTrend.toFixed(1)}pp`:'—', s.opmTrend!=null?(s.opmTrend>0?C.green:s.opmTrend<0?C.red:C.muted):C.muted],
            ['Promoter', s.promoter!=null?`${s.promoter.toFixed(1)}%`:'—', s.promoter!=null?(s.promoter>55?C.green:s.promoter>35?C.yellow:C.red):C.muted],
            ['Promoter Trend', s.promoterTrend!=null?`${s.promoterTrend>0?'+':''}${s.promoterTrend.toFixed(2)}pp`:'—', s.promoterTrend!=null?(s.promoterTrend>0?C.green:s.promoterTrend<0?C.red:C.muted):C.muted],
            ['FII %', s.fiiPct!=null?`${s.fiiPct.toFixed(1)}%`:'—', C.text],
            ['FII Trend', s.fiiTrend!=null?`${s.fiiTrend>0?'+':''}${s.fiiTrend.toFixed(2)}pp`:'—', s.fiiTrend!=null?(s.fiiTrend>0?C.green:s.fiiTrend<0?C.red:C.muted):C.muted],
            ['DII %', s.diiPct!=null?`${s.diiPct.toFixed(1)}%`:'—', C.text],
            ['DII Trend', s.diiTrend!=null?`${s.diiTrend>0?'+':''}${s.diiTrend.toFixed(2)}pp`:'—', s.diiTrend!=null?(s.diiTrend>0?C.green:s.diiTrend<0?C.red:C.muted):C.muted],
          ].map(([k,v,c])=>(
            <div key={k} style={{background:C.bg,borderRadius:8,padding:'9px 11px'}}>
              <div style={{fontSize:9,color:C.muted,marginBottom:2,textTransform:'uppercase',letterSpacing:'0.06em'}}>{k}</div>
              <div style={{fontWeight:800,fontSize:14,color:c}}>{v}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function StockCard({s,i,onChart}){
  const [open,setOpen]=useState(false)
  return(
    <div style={{background:C.card,border:`1px solid ${open?C.accent+'55':C.border}`,
      borderRadius:12,marginBottom:10,overflow:'hidden'}}>
      <div onClick={()=>onChart&&onChart(s.sym)} style={{padding:'14px 14px 12px',cursor:'pointer'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <div style={{width:28,height:28,borderRadius:7,background:rsColor(s.rs)+'22',
              border:`1px solid ${rsColor(s.rs)}55`,display:'flex',alignItems:'center',
              justifyContent:'center',fontSize:11,fontWeight:800,color:C.muted}}>{i+1}</div>
            <div>
              <div style={{fontWeight:800,fontSize:16}}>{s.sym}</div>
              <div style={{fontSize:10,color:C.muted}}>{s.sector}</div>
              <div style={{display:'flex',gap:4,marginTop:3,flexWrap:'wrap'}}>
                {(()=>{
                  const top = topVolumeSignal(s)
                  return <>
                    {top==='ht'&&<Badge color={C.orange} title={SIGNAL_TOOLTIPS.ht}>🚀HT</Badge>}
                    {top==='hy'&&<Badge color={C.pink} title={SIGNAL_TOOLTIPS.hy}>📊HY</Badge>}
                    {top==='ibv'&&<Badge color={C.blue} title={SIGNAL_TOOLTIPS.ibv}>🏛️IBV</Badge>}
                    {top==='pp'&&<Badge color={C.green} title={SIGNAL_TOOLTIPS.pp}>🔥PP</Badge>}
                  </>
                })()}
                {s.nearEMA9.isNearEMA9&&<Badge color={C.green} glow title={SIGNAL_TOOLTIPS.ema9}>⚡EMA9</Badge>}
                {s.nearEMA21?.isNearEMA21&&<Badge color={C.green} title="Price near its 21-day average, top-10%-RS stock.">⚡EMA21</Badge>}
                {s.nearEMA50?.isNearEMA50&&<Badge color={C.green} title="Price near its 50-day average, top-10%-RS stock.">⚡EMA50</Badge>}
                {topVolumeSignal(s)==='pp'&&s.rs>=80&&<Badge color={C.accent} glow title="Pocket Pivot + RS 80 or higher.">⭐Power</Badge>}
                    <StageBadge stage={calcWeinsteinStage(s)}/>
                    {s.isResistanceBreakout&&<Badge color={C.red} title={SIGNAL_TOOLTIPS.r1}>🎯R1</Badge>}
                    {s.isCupHandleBreakout&&<Badge color={C.yellow} title={SIGNAL_TOOLTIPS.cup}>☕Cup</Badge>}
                    {s.isGuppyBullishCrossover&&<Badge color={C.green} title={SIGNAL_TOOLTIPS.guppy}>🐠Guppy</Badge>}
                    {calcHYHTBreakout(s).isBreakout&&<Badge color={C.accent} glow title="High volume + strong RS + price up today, all together.">💥Break</Badge>}
              </div>
            </div>
          </div>
          <div style={{textAlign:'center'}}>
            <div style={{fontSize:32,fontWeight:900,color:rsColor(s.rs),lineHeight:1}}>{s.rs}</div>
            <div style={{fontSize:10,color:C.muted}}>{rsLabel(s.rs)}</div>
            <div style={{fontSize:11,fontWeight:700,color:trendColor(s.rsTrend.trend)}}>{trendIcon(s.rsTrend.trend)}</div>
          </div>
        </div>
        <div style={{display:'flex',gap:8,alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
          <div>
            <span style={{fontWeight:700,fontSize:15}}>{fmtP(s.last)}</span>
            <span style={{marginLeft:8,fontWeight:700,fontSize:13,color:s.chg>=0?C.green:C.red}}>
              {s.chg>=0?'+':''}{s.chg.toFixed(2)}%</span>
          </div>
          <div style={{display:'flex',gap:10,alignItems:'center'}}>
            <a href={`https://www.tradingview.com/chart/?symbol=NSE:${s.sym}`}
              target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()}
              title="Open in TradingView" style={{fontSize:16,textDecoration:'none'}}>
              📈
            </a>
            <a href={`https://www.screener.in/company/${s.sym}/consolidated/`}
              target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()}
              title="Open in Screener.in" style={{fontSize:16,textDecoration:'none'}}>
              📊
            </a>
            <Sparkline data={s.hist} width={60} height={22} color={rsColor(s.rs)}/>
            <span onClick={e=>{e.stopPropagation();setOpen(o=>!o)}}
              style={{fontSize:14,color:C.muted,cursor:'pointer',padding:'4px'}}>{open?'▲':'▼'}</span>
          </div>
        </div>
        <div style={{display:'flex',gap:2,marginBottom:6}}>
          {s.hist.slice(-7).map((v,idx,arr)=>{
            const color=v===null?C.border:v>=90?C.green:v>=70?C.accent:v>=50?C.yellow:C.red
            const isToday = idx===arr.length-1
            return<div key={idx} title={isToday?"Today's RS rating":undefined} style={{flex:1,height:isToday?30:26,
              borderRadius:4,background:color+'28',
              border:isToday?`2px solid ${C.text}`:`1px solid ${color}55`,display:'flex',alignItems:'center',justifyContent:'center',
              fontSize:isToday?10:9,fontWeight:800,color,alignSelf:'center'}}>{v??'—'}</div>
          })}
        </div>
        <TopSignalDots s={s}/>
      </div>
      {open&&<StockDetail s={s}/>}
    </div>
  )
}

// ── Simple Stock Table — reused wherever a subset of stocks (a sector's
// members, an index's constituents) needs to show the same rich table
// used in the main RS tab, without duplicating that markup everywhere.
function SimpleStockTable({stocks, isMobile, onChart}){
  const dragProps = useDragScroll()
  if(!stocks || stocks.length===0){
    return <div style={{padding:20,textAlign:'center',color:C.muted,fontSize:12}}>No stocks found.</div>
  }
  if(isMobile){
    return <div>{stocks.map((s,i)=><StockCard key={s.sym} s={s} i={i} onChart={onChart}/>)}</div>
  }
  return (
    <div ref={dragProps.ref} {...dragProps.handlers}
      style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,overflowX:'auto',...dragProps.style}}>
      <div style={{display:'grid',gridTemplateColumns:'32px 130px 52px 48px 48px 52px 52px 64px 90px 112px 182px 140px 55px 55px 48px 48px 48px 55px 32px 32px',
        padding:'7px 14px',borderBottom:`1px solid ${C.border}`,gap:4,
        fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em'}}>
        <span style={{textAlign:'center',color:C.muted}}>#</span>
        <span style={{color:C.muted}}>Symbol</span>
        <span style={{textAlign:'center',color:C.muted}}>RS-TV</span>
        <span style={{textAlign:'center',color:C.muted,fontSize:9}}>MID</span>
        <span style={{textAlign:'center',color:C.muted,fontSize:9}}>SML</span>
        <span style={{textAlign:'center',color:C.muted,fontSize:9}}>SEC</span>
        <span style={{textAlign:'center',color:C.muted}}>Trend</span>
        <span style={{textAlign:'right',color:C.muted}}>Price</span>
        <span style={{textAlign:'center',color:C.muted}}>Chg%</span>
        <span style={{textAlign:'center',color:C.muted}}>PP 10d</span>
        <span style={{textAlign:'center',color:C.muted}}>RS Last 7d</span>
        <span style={{textAlign:'center',color:C.muted}}>Stage/Vol</span>
        <span style={{textAlign:'right',color:C.muted,fontSize:9}}>MCap</span>
        <span style={{textAlign:'right',color:C.muted,fontSize:9}}>P/E</span>
        <span style={{textAlign:'right',color:C.muted,fontSize:9}}>ROE</span>
        <span style={{textAlign:'right',color:C.muted,fontSize:9}}>D/E</span>
        <span style={{textAlign:'right',color:C.muted,fontSize:9}}>Prom%</span>
        <span/>
        <span style={{textAlign:'center',color:C.muted,fontSize:9}}>TV</span>
        <span style={{textAlign:'center',color:C.muted,fontSize:9}}>Scr</span>
      </div>
      {stocks.map((s,i)=><DesktopRow key={s.sym} s={s} i={i} onChart={()=>onChart&&onChart(s.sym)}/>)}
    </div>
  )
}

// once at the top level and overlays via position:fixed. Swaps symbol in
// place (same panel instance) when a different stock is clicked.
// ── Market Breadth Chart — advances vs declines over time ──────────────
function BreadthChart({data,isMobile,breadthRange,setBreadthRange}){
  if(!data||data.length<2) return null
  const W=900,H=isMobile?200:240,padL=40,padR=12,padT=10,padB=28
  const chartW=W-padL-padR,chartH=H-padT-padB
  const maxVal=Math.max(...data.map(d=>Math.max(d.advances||0,d.declines||0)))||1
  const xAt=i=>padL+(i/(data.length-1))*chartW
  const yAt=v=>padT+chartH-(v/maxVal)*chartH
  const advPath=data.map((d,i)=>`${i===0?'M':'L'} ${xAt(i)},${yAt(d.advances||0)}`).join(' ')
  const decPath=data.map((d,i)=>`${i===0?'M':'L'} ${xAt(i)},${yAt(d.declines||0)}`).join(' ')
  const labelStep=Math.max(1,Math.floor(data.length/6))
  return(
    <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:'14px 14px 8px',marginBottom:14}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8,flexWrap:'wrap',gap:8}}>
        <div style={{fontWeight:800,fontSize:13}}>📈 Market Breadth — Advances vs Declines</div>
        <div style={{display:'flex',gap:12,fontSize:10,color:C.muted}}>
          <span><span style={{color:C.green}}>●</span> Advances</span>
          <span><span style={{color:C.red}}>●</span> Declines</span>
        </div>
      </div>
      {setBreadthRange&&(
        <div style={{display:'flex',gap:6,marginBottom:12,flexWrap:'wrap'}}>
          {['1M','3M','6M','1Y','2Y'].map(label=>(
            <button key={label} onClick={()=>setBreadthRange(label)}
              style={{padding:'5px 12px',borderRadius:20,cursor:'pointer',fontSize:11,fontWeight:600,
                border:`1px solid ${breadthRange===label?C.accent:C.border}`,
                background:breadthRange===label?C.accent+'18':'transparent',
                color:breadthRange===label?C.accent:C.muted}}>
              {label}
            </button>
          ))}
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:isMobile?160:190,display:'block'}}>
        {[0,0.5,1].map(f=>(
          <g key={f}>
            <line x1={padL} y1={padT+chartH*f} x2={W-padR} y2={padT+chartH*f} stroke={C.divider} strokeWidth={1}/>
            <text x={padL-6} y={padT+chartH*f+3} fontSize={8} fill={C.muted} textAnchor="end">
              {Math.round(maxVal*(1-f))}
            </text>
          </g>
        ))}
        <path d={advPath} fill="none" stroke={C.green} strokeWidth={1.5}/>
        <path d={decPath} fill="none" stroke={C.red} strokeWidth={1.5}/>
        {data.map((d,i)=> i%labelStep===0 ? (
          <text key={i} x={xAt(i)} y={H-8} fontSize={8} fill={C.muted} textAnchor="middle">
            {d.date?.slice(5)}
          </text>
        ) : null)}
      </svg>
    </div>
  )
}

// ── EMA Breadth Table — % of stocks above 9/21/50-day EMA per day,
// plus daily Stage 2 count (going forward only, see backend notes). ──
function EmaBreadthTable({data,isMobile,dragProps,rangeLabel}){
  if(!data||data.length===0) return null
  const pct=(n,total)=>total?Math.round(n/total*100):0
  return(
    <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:'14px 14px 4px',marginBottom:14}}>
      <div style={{fontWeight:800,fontSize:13,marginBottom:2}}>📅 Stocks Above EMA{rangeLabel?` — ${rangeLabel}`:''}</div>
      <div style={{fontSize:10,color:C.muted,marginBottom:10}}>
        % of tracked stocks trading above their 9/21/50-day average, plus daily Stage 2 count
        {data.some(d=>d.stage2_count==null) && ' (Stage 2 only available from when this was added — no history before that)'}
      </div>
      <div ref={dragProps?.ref} {...(dragProps?.handlers||{})}
        style={{overflowX:'auto',overflowY:'auto',maxHeight:420,...(dragProps?.style||{})}}>
        <table style={{width:'100%',borderCollapse:'collapse',minWidth:520}}>
          <thead>
            <tr style={{borderBottom:`1px solid ${C.border}`,position:'sticky',top:0,background:C.card}}>
              {['Date','Above EMA9','Above EMA21','Above EMA50','Stage 2'].map(h=>(
                <th key={h} style={{textAlign:h==='Date'?'left':'right',padding:'6px 10px',
                  fontSize:9.5,fontWeight:700,color:C.muted,textTransform:'uppercase',letterSpacing:'0.04em'}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...data].reverse().map(d=>(
              <tr key={d.date} style={{borderBottom:`1px solid ${C.divider}`}}>
                <td style={{padding:'7px 10px',fontSize:11.5,fontWeight:600}}>{d.date}</td>
                <td style={{padding:'7px 10px',fontSize:11.5,textAlign:'right',color:pct(d.above_ema9,d.total)>=50?C.green:C.red}}>
                  {pct(d.above_ema9,d.total)}% <span style={{color:C.muted,fontSize:9.5}}>({d.above_ema9})</span>
                </td>
                <td style={{padding:'7px 10px',fontSize:11.5,textAlign:'right',color:pct(d.above_ema21,d.total)>=50?C.green:C.red}}>
                  {pct(d.above_ema21,d.total)}% <span style={{color:C.muted,fontSize:9.5}}>({d.above_ema21})</span>
                </td>
                <td style={{padding:'7px 10px',fontSize:11.5,textAlign:'right',color:pct(d.above_ema50,d.total)>=50?C.green:C.red}}>
                  {pct(d.above_ema50,d.total)}% <span style={{color:C.muted,fontSize:9.5}}>({d.above_ema50})</span>
                </td>
                <td style={{padding:'7px 10px',fontSize:11.5,textAlign:'right',color:C.text}}>
                  {d.stage2_count!=null ? <>{pct(d.stage2_count,d.total)}% <span style={{color:C.muted,fontSize:9.5}}>({d.stage2_count})</span></> : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ChartPanel({sym, wide, onToggleWide, onClose, isMobile, symList, onNavigate}){
  const [loaded, setLoaded] = useState(false)
  const [chartTab, setChartTab] = useState('own') // 'own' | 'tv' — Our Chart
  // is the default: NSE restricted its symbols in TradingView's embeddable
  // widget ("This symbol is only available on TradingView" even for major
  // stocks), so the embed frequently fails. BSE listings still work in
  // embeds — the TV tab defaults to BSE with an exchange toggle.
  const [tvExchange, setTvExchange] = useState('BSE')
  useEffect(() => { setLoaded(false) }, [sym])

  if(!sym) return null
  const src = `https://s.tradingview.com/widgetembed/?symbol=${tvExchange}%3A${encodeURIComponent(sym)}&interval=D&hidesidetoolbar=0&symboledit=1&saveimage=0&toolbarbg=0e1117&studies=RSI%40tv-basicstudies%1FVolume%40tv-basicstudies%1FMACD%40tv-basicstudies&theme=dark&style=1&timezone=Asia%2FKolkata&withdateranges=1&locale=en`

  // Prev/Next within whatever list was showing when the chart was
  // opened — so you can flip through stocks one by one without closing
  // the panel and re-picking from the (often full-screen-hidden, on
  // mobile) list each time.
  const idx = symList ? symList.indexOf(sym) : -1
  const prevSym = idx > 0 ? symList[idx-1] : null
  const nextSym = idx >= 0 && idx < (symList?.length||0)-1 ? symList[idx+1] : null

  const panelStyle = isMobile
    ? {position:'fixed',inset:0,zIndex:1000,display:'flex',flexDirection:'column',background:C.sidebar}
    : {position:'fixed',top:0,right:0,bottom:0,zIndex:1000,
        width:['50%','70%','92%'][wide]||'50%',minWidth:460,
        display:'flex',flexDirection:'column',background:C.sidebar,
        borderLeft:`1px solid ${C.divider}`,boxShadow:'-8px 0 24px rgba(0,0,0,0.35)',
        transition:'width 0.2s ease'}

  return(
    <div style={panelStyle}>
      {/* Header */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',
        padding:'8px 14px',borderBottom:`1px solid ${C.divider}`,flexShrink:0,height:42}}>
        <div style={{display:'flex',alignItems:'center',gap:6}}>
          <button onClick={()=>prevSym&&onNavigate(prevSym)} disabled={!prevSym}
            title="Previous stock"
            style={{background:'transparent',border:`1px solid ${C.border}`,
              color:prevSym?C.text:C.border,fontSize:13,width:26,height:26,borderRadius:4,
              cursor:prevSym?'pointer':'default',display:'flex',alignItems:'center',justifyContent:'center'}}>
            ◀
          </button>
          <span style={{fontWeight:700,fontSize:14,color:C.text,letterSpacing:'0.01em'}}>{sym}</span>
          <button onClick={()=>nextSym&&onNavigate(nextSym)} disabled={!nextSym}
            title="Next stock"
            style={{background:'transparent',border:`1px solid ${C.border}`,
              color:nextSym?C.text:C.border,fontSize:13,width:26,height:26,borderRadius:4,
              cursor:nextSym?'pointer':'default',display:'flex',alignItems:'center',justifyContent:'center'}}>
            ▶
          </button>
          <span style={{fontSize:10,color:C.muted,background:C.card,padding:'1px 5px',borderRadius:3}}>NSE</span>
          <a href={`https://www.tradingview.com/chart/?symbol=${tvExchange}:${sym}`}
            target="_blank" rel="noopener noreferrer"
            title="Opens your own TradingView account (not the restricted embed) — apply your custom Pine Script here once and it'll persist as you switch symbols"
            style={{fontSize:10,color:C.accent,textDecoration:'none',
              padding:'2px 7px',borderRadius:4,border:`1px solid ${C.accent}33`,
              display:'flex',alignItems:'center',gap:3}}>
            {isMobile?'TV ↗':'Open in TradingView ↗'}
          </a>
        </div>
        <div style={{display:'flex',gap:4,alignItems:'center'}}>
          {!isMobile&&(
            <button onClick={onToggleWide}
              title={['Expand chart','Expand further','Back to normal'][wide]}
              style={{background:'transparent',border:`1px solid ${C.border}`,
                color:C.muted,fontSize:10,padding:'3px 8px',borderRadius:4,
                cursor:'pointer',whiteSpace:'nowrap'}}>
              {['◀◀','◀◀◀','▶▶▶'][wide]}
            </button>
          )}
          <button onClick={onClose}
            style={{background:'transparent',border:`1px solid ${C.border}`,
              color:C.muted,fontSize:16,width:26,height:26,borderRadius:4,
              cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',
              lineHeight:1}}>×
          </button>
        </div>
      </div>

      {/* Chart source tabs */}
      <div style={{display:'flex',gap:0,borderBottom:`1px solid ${C.divider}`,flexShrink:0}}>
        {[['own','Our Chart'],['tv','TradingView']].map(([v,label])=>(
          <button key={v} onClick={()=>setChartTab(v)}
            style={{flex:1,padding:'8px 0',fontSize:11,fontWeight:700,cursor:'pointer',
              background:chartTab===v?C.card:'transparent',
              color:chartTab===v?C.accent:C.muted,
              border:'none',borderBottom:chartTab===v?`2px solid ${C.accent}`:'2px solid transparent'}}>
            {label}
          </button>
        ))}
      </div>

      {/* NSE/BSE toggle — NSE restricted many symbols in TradingView's
          embeddable widget ("only available on TradingView" even for
          major stocks like LODHA); BSE listings still work in embeds. */}
      {chartTab==='tv'&&(
        <div style={{display:'flex',alignItems:'center',gap:6,padding:'6px 14px',
          borderBottom:`1px solid ${C.divider}`,flexShrink:0}}>
          <span style={{fontSize:10,color:C.muted}}>Exchange:</span>
          {['NSE','BSE'].map(ex=>(
            <button key={ex} onClick={()=>{setTvExchange(ex);setLoaded(false)}}
              style={{padding:'2px 10px',borderRadius:6,border:`1px solid ${tvExchange===ex?C.accent:C.border}`,
                background:tvExchange===ex?C.accent+'22':'transparent',
                color:tvExchange===ex?C.accent:C.muted,fontSize:10,fontWeight:700,cursor:'pointer'}}>
              {ex}
            </button>
          ))}
          {tvExchange==='NSE'&&(
            <span style={{fontSize:9,color:C.yellow}}>NSE often blocked in embeds — try BSE if this fails</span>
          )}
        </div>
      )}

      {/* Body */}
      <div style={{flex:1,position:'relative',overflow:chartTab==='own'?'auto':'hidden'}}>
        {chartTab==='tv'?(
          <>
            {!loaded&&(
              <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',
                justifyContent:'center',flexDirection:'column',gap:8,background:C.sidebar}}>
                <div style={{fontSize:12,color:C.muted}}>Loading {sym} chart…</div>
              </div>
            )}
            <iframe
              key={sym+tvExchange}
              src={src}
              onLoad={()=>setLoaded(true)}
              style={{width:'100%',height:'100%',border:'none'}}
              allowFullScreen
            />
          </>
        ):(
          <CandlestickChart sym={sym} isMobile={isMobile}/>
        )}
      </div>
    </div>
  )
}

// ── Native Candlestick Chart — candlesticks, MA20/50/200, Support/
// Resistance, Inside Bar, Accumulation/Distribution, VCP contractions,
// and a Cup & Handle heuristic, all computed client-side from the same
// OHLCV data already fetched for the simple price history chart. Sits
// alongside the TradingView embed as a second tab, not a replacement —
// useful for stocks TradingView's free embed can't resolve, and for
// seeing our own scanner's signals drawn directly on the chart.
const RANGE_BARS = {'5D':5,'1M':21,'3M':63,'6M':126,'YTD':null,'1Y':252,'5Y':1260,'All':100000}

function CandlestickChart({sym, isMobile}){
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState('6M')
  const [zoomBars, setZoomBars] = useState(RANGE_BARS['6M'])
  const [panOffset, setPanOffset] = useState(0) // bars back from the most recent
  const [showMA, setShowMA] = useState(true)
  const [showSR, setShowSR] = useState(true)
  const [showPatterns, setShowPatterns] = useState(true)
  const [showForecast, setShowForecast] = useState(false)
  const [hoverIdx, setHoverIdx] = useState(null)
  const [pinnedIdx, setPinnedIdx] = useState(null)
  const dragRef = useRef(null) // {startX, startPanOffset} | {pinchDist, pinchZoomBars} | null
  const svgRef = useRef(null)
  const rafRef = useRef(null)
  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }, [])

  // Analysis runs on the FULL series (so early visible bars still have
  // correct MA/pattern context from data before the visible window),
  // then only the slice gets rendered. Memoized on `data` specifically
  // because these are genuinely expensive over up to 730 days of
  // history — without this, every single wheel-zoom tick and every
  // pixel of drag-pan was re-running all of them on every render,
  // which is what was actually causing the browser to hang/freeze
  // during zoom or pan gestures, not a browser problem.
  // IMPORTANT: this must run before the loading/error early-returns
  // below (React requires hooks to run unconditionally, in the same
  // order, every render) — so it checks data validity internally
  // instead of relying on the component having already bailed out.
  const analysis = useMemo(() => {
    if (!data || data.error || !data.prices || data.prices.length < 30) return null
    const closes = data.prices, highs = data.highs, lows = data.lows, volumes = data.volumes
    const _swings = findSwingPoints(highs, lows, 5)
    return {
      ma20: calcSMASeries(closes, 20),
      ma50: calcSMASeries(closes, 50),
      ma200: calcSMASeries(closes, 200),
      swings: _swings,
      sr: computeSupportResistance(_swings, closes[closes.length-1]),
      insideBars: detectInsideBars(highs, lows),
      accDist: detectAccDistDays(highs, lows, closes, volumes),
      ppDays: detectPPDays(closes, volumes),
      hyDays: detectHYDays(volumes),
      htDays: detectHTDays(volumes),
      ibvDays: detectIBVDays(highs, lows, closes, volumes),
      nearEma9Days: detectNearEMA9Days(closes),
      vcp: detectVCPContractions(_swings),
      cup: detectCupAndHandle(closes, highs, lows),
    }
  }, [data])

  useEffect(() => {
    let cancelled = false
    setLoading(true); setData(null)
    setZoomBars(RANGE_BARS['6M']); setPanOffset(0) // reset zoom/pan for the new symbol
    setPinnedIdx(null)
    fetchStockFullHistory(sym)
      .then(res => { if(!cancelled) setData(res) })
      .catch(() => { if(!cancelled) setData(null) })
      .finally(() => { if(!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [sym])

  if(loading){
    return <div style={{padding:20,fontSize:12,color:C.muted,textAlign:'center'}}>Loading {sym} chart…</div>
  }
  if(data && data.error){
    return (
      <div style={{padding:20,fontSize:12,color:C.red,textAlign:'center'}}>
        Couldn't load chart data for {sym}: {data.error}
      </div>
    )
  }
  if(!data || !data.prices || data.prices.length < 30){
    return (
      <div style={{padding:20,fontSize:12,color:C.muted,textAlign:'center'}}>
        Not enough price history yet for {sym} to draw a chart
        {data && data.prices ? ` (only ${data.prices.length} days available, need 30+).` : '.'}
      </div>
    )
  }

  const { dates, prices: closes, opens, highs, lows, volumes } = data
  const n = closes.length
  // Fall back to close price if opens weren't backfilled yet for this
  // symbol (older stock_full_history rows fetched before Open tracking
  // was added) — draws a thin/neutral candle instead of breaking.
  const o = (opens && opens.length === n) ? opens : closes.map((c,i)=> i>0 ? closes[i-1] : c)
  const { ma20, ma50, ma200, swings, sr, insideBars, accDist, ppDays, hyDays, htDays, ibvDays, nearEma9Days, vcp, cup } = analysis

  // ── Layout constants needed by both the zoom/pan handlers below and
  // the SVG render further down ──
  const W = 900, H = 420
  const padL = 8, padR = 54, padT = 10, priceH = 300, volH = 60, gapH = 8
  const chartW = W - padL - padR

  // barsToShow/start now driven by zoomBars/panOffset (mouse wheel /
  // pinch to zoom, drag to pan) rather than only the fixed range preset
  // buttons — those buttons just set zoomBars to a starting point.
  const barsToShow = Math.max(10, Math.min(zoomBars, n))
  const maxPanOffset = Math.max(0, n - barsToShow)
  const clampedPanOffset = Math.min(panOffset, maxPanOffset)
  const start = Math.max(0, n - barsToShow - clampedPanOffset)

  // ── Zoom (wheel / pinch) and pan (drag) handlers ──
  // RAF-throttled: wheel/mousemove/touchmove can fire dozens of times
  // per second, but only one state update (and therefore one render) is
  // needed per animation frame — this alone cuts most of the redundant
  // work even beyond the useMemo above.
  const throttle = (fn) => {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => { rafRef.current = null; fn() })
  }
  const handleWheel = (e) => {
    e.preventDefault()
    const factor = e.deltaY > 0 ? 1.15 : 0.87
    throttle(() => setZoomBars(z => Math.max(10, Math.min(n, Math.round(z * factor)))))
  }
  const pxToBars = (pxDelta) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return 0
    const svgDelta = pxDelta * (W / rect.width)
    return Math.round(svgDelta * (barsToShow / chartW))
  }
  const handleMouseDown = (e) => {
    dragRef.current = { startX: e.clientX, startPanOffset: clampedPanOffset }
  }
  const handleMouseMove = (e) => {
    if (!dragRef.current) return
    const deltaBars = pxToBars(e.clientX - dragRef.current.startX)
    // Dragging right reveals older data -> increase panOffset
    throttle(() => setPanOffset(Math.max(0, Math.min(maxPanOffset, dragRef.current.startPanOffset - deltaBars))))
  }
  const handleMouseUp = () => { dragRef.current = null }
  const touchDist = (touches) => {
    const [a, b] = touches
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
  }
  const handleTouchStart = (e) => {
    if (e.touches.length === 2) {
      dragRef.current = { pinchDist: touchDist(e.touches), pinchZoomBars: zoomBars }
    } else if (e.touches.length === 1) {
      dragRef.current = { startX: e.touches[0].clientX, startPanOffset: clampedPanOffset }
    }
  }
  const handleTouchMove = (e) => {
    if (!dragRef.current) return
    if (e.touches.length === 2 && dragRef.current.pinchDist != null) {
      e.preventDefault()
      const newDist = touchDist(e.touches)
      const ratio = dragRef.current.pinchDist / Math.max(1, newDist) // fingers apart = zoom in
      throttle(() => setZoomBars(Math.max(10, Math.min(n, Math.round(dragRef.current.pinchZoomBars * ratio)))))
    } else if (e.touches.length === 1 && dragRef.current.startX != null) {
      const deltaBars = pxToBars(e.touches[0].clientX - dragRef.current.startX)
      throttle(() => setPanOffset(Math.max(0, Math.min(maxPanOffset, dragRef.current.startPanOffset - deltaBars))))
    }
  }
  const handleTouchEnd = () => { dragRef.current = null }

  const vDates  = dates.slice(start)
  const vOpens  = o.slice(start)
  const vHighs  = highs.slice(start)
  const vLows   = lows.slice(start)
  const vCloses = closes.slice(start)
  const vVol    = volumes.slice(start)
  const vMA20   = ma20.slice(start)
  const vMA50   = ma50.slice(start)
  const vMA200  = ma200.slice(start)
  const vInsideBars = insideBars.slice(start)
  const vAccDist = accDist.slice(start)
  const vPP  = ppDays.slice(start)
  const vHY  = hyDays.slice(start)
  const vHT  = htDays.slice(start)
  const vIBV = ibvDays.slice(start)
  const vNearEma9 = nearEma9Days.slice(start)

  // ── Layout ──
  const volTop = padT + priceH + gapH
  const axisY  = volTop + volH + 18

  const visibleHighs = vHighs.filter(v=>v!=null)
  const visibleLows  = vLows.filter(v=>v!=null)
  const maVals = [...vMA20, ...vMA50, ...vMA200].filter(v=>v!=null)
  let maxP = Math.max(...visibleHighs, ...maVals, sr.r1||0, sr.r2||0)
  let minP = Math.min(...visibleLows, ...(maVals.length?maVals:[Infinity]), sr.s1||Infinity, sr.s2||Infinity)
  if(!isFinite(minP)) minP = Math.min(...visibleLows)
  const pad = (maxP - minP) * 0.06 || 1
  maxP += pad; minP -= pad

  const priceToY = p => padT + (maxP - p) / (maxP - minP) * priceH
  // Forecast (simple linear regression trend projection, NOT a real
  // prediction model) reserves some room on the right by treating the
  // effective bar count as larger than what's actually plotted.
  const forecastDays = showForecast ? Math.max(5, Math.round(barsToShow * 0.15)) : 0
  const totalCols = barsToShow + forecastDays
  const idxToX   = i => padL + (i + 0.5) / totalCols * chartW
  const candleW  = Math.max(1.5, (chartW / totalCols) * 0.62)

  // Least-squares linear regression over the last ~30 visible closes,
  // projected forward forecastDays bars. Deliberately simple/transparent
  // — a straight-line trend continuation, not a real forecasting model.
  let forecastPoints = null
  if (showForecast && forecastDays > 0) {
    const sampleN = Math.min(30, vCloses.length)
    const sample = vCloses.slice(-sampleN).map((v,idx)=>({x:idx, y:v})).filter(p=>p.y!=null)
    if (sample.length >= 5) {
      const meanX = sample.reduce((a,p)=>a+p.x,0)/sample.length
      const meanY = sample.reduce((a,p)=>a+p.y,0)/sample.length
      const num = sample.reduce((a,p)=>a+(p.x-meanX)*(p.y-meanY),0)
      const den = sample.reduce((a,p)=>a+(p.x-meanX)**2,0)
      const slope = den ? num/den : 0
      const intercept = meanY - slope*meanX
      const lastRealIdx = barsToShow - 1
      const lastSampleX = sampleN - 1
      forecastPoints = Array.from({length: forecastDays+1}, (_,k)=>{
        const sampleX = lastSampleX + k
        return { idx: lastRealIdx + k, price: intercept + slope*sampleX }
      })
      const fPrices = forecastPoints.map(p=>p.price)
      maxP = Math.max(maxP, ...fPrices)
      minP = Math.min(minP, ...fPrices)
    }
  }

  const maxVol = Math.max(...vVol.filter(v=>v!=null), 1)
  const volToY = v => volTop + volH - (v / maxVol) * volH

  // X-axis labels, TradingView style: show the month abbreviation at
  // month boundaries, just the day number otherwise.
  const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const labelStep = Math.max(1, Math.floor(barsToShow / 6))
  const xLabels = []
  let lastMonthShown = null
  for (let i = 0; i < barsToShow; i += labelStep) {
    const d = vDates[i]
    if (!d) continue
    const m = parseInt(d.slice(5,7), 10)
    const day = parseInt(d.slice(8,10), 10)
    const isNewMonth = lastMonthShown !== m
    lastMonthShown = m
    xLabels.push({ i, text: isNewMonth ? MONTH_ABBR[m-1] : String(day) })
  }

  const hover = (pinnedIdx ?? hoverIdx) != null ? {
    date: vDates[pinnedIdx ?? hoverIdx], open: vOpens[pinnedIdx ?? hoverIdx], high: vHighs[pinnedIdx ?? hoverIdx],
    low: vLows[pinnedIdx ?? hoverIdx], close: vCloses[pinnedIdx ?? hoverIdx], vol: vVol[pinnedIdx ?? hoverIdx],
  } : null

  // YTD's bar count is dynamic (depends on today's date vs the data),
  // unlike the other presets which are fixed trading-day counts.
  const zoomBarsForRange = (r) => {
    if (r === 'YTD') {
      const jan1 = `${new Date().getFullYear()}-01-01`
      const idx = dates.findIndex(d=>d>=jan1)
      return idx>=0 ? n-idx : n
    }
    return RANGE_BARS[r]
  }
  const applyRangePreset = (r) => { setZoomBars(zoomBarsForRange(r)); setPanOffset(0) }

  return (
    <div style={{padding:'10px 12px'}}>
      {/* Controls */}
      <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:8,alignItems:'center'}}>
        <div style={{display:'flex',gap:3}}>
          {Object.keys(RANGE_BARS).map(r=>(
            <button key={r} onClick={()=>{setRange(r);applyRangePreset(r)}}
              style={{padding:'3px 9px',borderRadius:6,border:`1px solid ${range===r?C.accent:C.border}`,
                background:range===r?C.accent+'22':'transparent',color:range===r?C.accent:C.muted,
                fontSize:10,fontWeight:700,cursor:'pointer'}}>{r}</button>
          ))}
        </div>
        <div style={{width:1,height:16,background:C.border,margin:'0 2px'}}/>
        {[['MA','showMA',showMA,setShowMA,C.blue],
          ['S/R','showSR',showSR,setShowSR,C.yellow],
          ['Patterns','showPatterns',showPatterns,setShowPatterns,C.accent],
          ['Forecast','showForecast',showForecast,setShowForecast,C.accent]].map(([label,key,val,setter,color])=>(
          <button key={key} onClick={()=>setter(v=>!v)}
            style={{padding:'3px 9px',borderRadius:6,border:`1px solid ${val?color:C.border}`,
              background:val?color+'1c':'transparent',color:val?color:C.muted,
              fontSize:10,fontWeight:700,cursor:'pointer'}}>{label}</button>
        ))}
        {(zoomBars!==zoomBarsForRange(range)||panOffset!==0)&&(
          <button onClick={()=>applyRangePreset(range)}
            style={{padding:'3px 9px',borderRadius:6,border:`1px solid ${C.border}`,
              background:'transparent',color:C.muted,fontSize:10,fontWeight:700,cursor:'pointer'}}>
            ↺ Reset zoom
          </button>
        )}
        <span style={{fontSize:9,color:C.muted,marginLeft:'auto'}}>
          {isMobile?'Pinch to zoom · drag to pan':'Scroll to zoom · drag to pan'}
        </span>
      </div>

      {/* Hover readout */}
      <div style={{fontSize:10,color:C.muted,marginBottom:4,minHeight:14}}>
        {hover ? (
          <span>
            {pinnedIdx!=null && (
              <span onClick={()=>setPinnedIdx(null)}
                style={{color:C.accent,fontWeight:700,cursor:'pointer',marginRight:6}}>📌 (tap to unpin)</span>
            )}
            <b style={{color:C.text}}>{hover.date}</b>{'  '}
            O <span style={{color:C.text}}>{hover.open?.toFixed(2)}</span>{'  '}
            H <span style={{color:C.green}}>{hover.high?.toFixed(2)}</span>{'  '}
            L <span style={{color:C.red}}>{hover.low?.toFixed(2)}</span>{'  '}
            C <span style={{color:C.text,fontWeight:700}}>{hover.close?.toFixed(2)}</span>{'  '}
            Vol <span style={{color:C.text}}>{hover.vol?.toLocaleString('en-IN')}</span>
          </span>
        ) : `${sym} · ${barsToShow} days · tap a candle to pin its data`}
      </div>

      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`}
        style={{width:'100%',height:isMobile?400:380,display:'block',touchAction:'none',cursor:dragRef.current?'grabbing':'grab'}}
        onMouseLeave={()=>{setHoverIdx(null);dragRef.current=null}}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}>
        {/* Grid lines + price labels */}
        {[0,0.25,0.5,0.75,1].map(f=>{
          const p = maxP - f*(maxP-minP)
          const y = padT + f*priceH
          return (
            <g key={f}>
              <line x1={padL} y1={y} x2={padL+chartW} y2={y} stroke={C.border} strokeWidth={0.5} opacity={0.5}/>
              <text x={padL+chartW+4} y={y+3} fontSize={9} fill={C.muted}>{p.toFixed(1)}</text>
            </g>
          )
        })}

        {/* Support/Resistance lines */}
        {showSR && [['r1',sr.r1,C.red],['r2',sr.r2,C.red],['s1',sr.s1,C.green],['s2',sr.s2,C.green]].map(([k,val,color])=>
          val!=null && val<=maxP && val>=minP ? (
            <g key={k}>
              <line x1={padL} y1={priceToY(val)} x2={padL+chartW} y2={priceToY(val)}
                stroke={color} strokeWidth={1} strokeDasharray="4,3" opacity={0.6}/>
              <text x={padL+2} y={priceToY(val)-3} fontSize={8} fontWeight={700} fill={color}>
                {k.toUpperCase()} {val.toFixed(1)}
              </text>
            </g>
          ) : null
        )}

        {/* Cup & Handle outline — smooth curved overlay (not the actual
            noisy price action) tracing the cup shape, like a hand-drawn
            annotation: left lip -> bottom -> right lip, plus a small
            handle dip after the right lip if one was detected. */}
        {showPatterns && cup && cup.leftLipIdx >= start && cup.leftLipIdx < n && cup.rightLipIdx < n && (() => {
          const li = Math.max(0, cup.leftLipIdx - start)
          const bi = Math.max(0, Math.min(barsToShow-1, cup.bottomIdx - start))
          const ri = Math.min(barsToShow-1, cup.rightLipIdx - start)
          const ly = priceToY(highs[cup.leftLipIdx] ?? closes[cup.leftLipIdx])
          const by = priceToY(lows[cup.bottomIdx] ?? closes[cup.bottomIdx])
          const ry = priceToY(highs[cup.rightLipIdx] ?? closes[cup.rightLipIdx])
          // Smooth half-cosine interpolation between 3 key points — looks
          // like a natural curve rather than a mathematically exact bezier.
          const ease = (a,b,t) => a + (b-a) * (1-Math.cos(t*Math.PI))/2
          const pts = []
          const steps = 24
          for (let s=0; s<=steps; s++){
            const t = s/steps
            const idx = li + t*(ri-li)
            const halfway = t<0.5
            const localT = halfway ? t/0.5 : (t-0.5)/0.5
            const y = halfway ? ease(ly, by, localT) : ease(by, ry, localT)
            pts.push(`${idxToX(idx)},${y}`)
          }
          // Handle: a small shallow dip drawn just after the right lip,
          // roughly spanning the handle zone the detector identified.
          let handlePts = []
          if (cup.hasHandle){
            const handleLen = Math.max(3, Math.round((ri-bi)*0.15))
            const hEnd = Math.min(barsToShow-1, ri+handleLen)
            const dipY = ry + 14 // shallow dip below the right lip level
            for (let s=0; s<=12; s++){
              const t = s/12
              const idx = ri + t*(hEnd-ri)
              const y = t<0.5 ? ease(ry, dipY, t/0.5) : ease(dipY, ry-2, (t-0.5)/0.5)
              handlePts.push(`${idxToX(idx)},${y}`)
            }
          }
          return (
            <g>
              <path d={`M ${pts.join(' L ')}`} fill="none" stroke={C.purple} strokeWidth={2} opacity={0.75} strokeLinecap="round"/>
              {handlePts.length>0 && (
                <path d={`M ${handlePts.join(' L ')}`} fill="none" stroke={C.purple} strokeWidth={2} opacity={0.6} strokeDasharray="4,2" strokeLinecap="round"/>
              )}
              <text x={idxToX((li+ri)/2)} y={Math.min(ly,ry)-8} fontSize={9} fontWeight={700} fill={C.purple} textAnchor="middle">
                Cup {cup.depthPct}%{cup.hasHandle?' + Handle':''}
              </text>
            </g>
          )
        })()}

        {/* VCP contraction connectors */}
        {showPatterns && vcp.isContracting && vcp.contractions.map((c,i)=>
          c.high.idx>=start && c.low.idx>=start ? (
            <line key={i} x1={idxToX(c.high.idx-start)} y1={priceToY(c.high.price)}
              x2={idxToX(c.low.idx-start)} y2={priceToY(c.low.price)}
              stroke={C.orange} strokeWidth={1.5} strokeDasharray="3,2" opacity={0.7}/>
          ) : null
        )}

        {/* MA lines */}
        {showMA && [[vMA20,C.blue],[vMA50,C.yellow],[vMA200,C.purple]].map(([series,color],k)=>{
          const pts = series.map((v,i)=> v!=null ? `${idxToX(i)},${priceToY(v)}` : null).filter(Boolean)
          return pts.length>1 ? <polyline key={k} points={pts.join(' ')} fill="none" stroke={color} strokeWidth={1.3} opacity={0.9}/> : null
        })}

        {/* Candlesticks */}
        {vCloses.map((c,i)=>{
          const op = vOpens[i], hi = vHighs[i], lo = vLows[i]
          if(c==null||op==null||hi==null||lo==null) return null
          const up = c >= op
          const color = up ? C.green : C.red
          const x = idxToX(i)
          const yOpen = priceToY(op), yClose = priceToY(c)
          const bodyTop = Math.min(yOpen,yClose), bodyH = Math.max(1, Math.abs(yClose-yOpen))
          return (
            <g key={i}
              onMouseEnter={()=>setHoverIdx(i)}
              onClick={(e)=>{e.stopPropagation();setPinnedIdx(p=>p===i?null:i)}}
              style={{cursor:'crosshair'}}>
              <rect x={x-candleW/2-1} y={padT} width={candleW+2} height={priceH} fill="transparent"/>
              <line x1={x} y1={priceToY(hi)} x2={x} y2={priceToY(lo)} stroke={color} strokeWidth={1}/>
              <rect x={x-candleW/2} y={bodyTop} width={candleW} height={bodyH} fill={color}/>
              {/* Volume bar — colored per signal, priority order
                  HT > HY > IBV > PP (highest wins if several fire the
                  same day). Each gets a distinct color + label, matching
                  the reference indicator's colored-bar style. */}
              {vVol[i]!=null && (() => {
                const signal = vHT[i] ? 'HT' : vHY[i] ? 'HY' : vIBV[i] ? 'IBV' : vPP[i] ? 'PP' : vNearEma9[i] ? 'EMA9' : null
                const signalColor = {HT:C.orange, HY:C.pink, IBV:C.blue, PP:C.green, EMA9:C.teal}[signal]
                const volColor = signalColor || color
                const barTopY = volToY(vVol[i])
                return (
                  <rect x={x-candleW/2} y={barTopY} width={candleW}
                    height={volTop+volH-barTopY} fill={volColor} opacity={signal?0.85:0.5}/>
                )
              })()}
              {/* Pattern markers */}
              {showPatterns && vInsideBars[i] && (
                <circle cx={x} cy={priceToY(hi)-6} r={2} fill={C.teal}/>
              )}
              {showPatterns && vAccDist[i]==='acc' && (
                <text x={x} y={volTop+volH+10} fontSize={7} fill={C.green} textAnchor="middle">▲</text>
              )}
              {showPatterns && vAccDist[i]==='dist' && (
                <text x={x} y={volTop+volH+10} fontSize={7} fill={C.red} textAnchor="middle">▼</text>
              )}
              {(hoverIdx===i || pinnedIdx===i) && (
                <>
                  <line x1={x} y1={padT} x2={x} y2={volTop+volH} stroke={pinnedIdx===i?C.accent:C.muted}
                    strokeWidth={pinnedIdx===i?1:0.5} strokeDasharray={pinnedIdx===i?'none':'2,2'}/>
                  {/* Floating date label under the crosshair, TradingView style */}
                  <rect x={x-24} y={axisY-9} width={48} height={13} rx={2}
                    fill={pinnedIdx===i?C.accent:C.card} stroke={C.border}/>
                  <text x={x} y={axisY} fontSize={8} fontWeight={700}
                    fill={pinnedIdx===i?'#0a0a0f':C.text} textAnchor="middle">
                    {vDates[i]?.slice(5).replace('-','/')}
                  </text>
                </>
              )}
            </g>
          )
        })}

        {/* Forecast — dashed trend projection, clearly separated from
            real data with its own label and disclaimer below the chart */}
        {showForecast && forecastPoints && (
          <>
            <polyline
              points={forecastPoints.map(p=>`${idxToX(p.idx)},${priceToY(p.price)}`).join(' ')}
              fill="none" stroke={C.accent} strokeWidth={1.5} strokeDasharray="5,4" opacity={0.8}/>
            <text x={idxToX(forecastPoints[forecastPoints.length-1].idx)}
              y={priceToY(forecastPoints[forecastPoints.length-1].price)-6}
              fontSize={8} fontWeight={700} fill={C.accent} textAnchor="end">Forecast</text>
          </>
        )}

        {/* X-axis date labels — TradingView style: month name at month
            boundaries, day number otherwise */}
        {xLabels.map(({i,text})=>(
          <text key={i} x={idxToX(i)} y={axisY} fontSize={8} fill={C.muted} textAnchor="middle">
            {text}
          </text>
        ))}
      </svg>

      {/* Legend */}
      <div style={{display:'flex',flexWrap:'wrap',gap:10,marginTop:6,fontSize:9,color:C.muted}}>
        {showMA && <>
          <span><span style={{color:C.blue}}>■</span> MA20</span>
          <span><span style={{color:C.yellow}}>■</span> MA50</span>
          <span><span style={{color:C.purple}}>■</span> MA200</span>
        </>}
        {showPatterns && <>
          <span><span style={{color:C.teal}}>●</span> Inside Bar</span>
          <span><span style={{color:C.green}}>▲</span> Accumulation</span>
          <span><span style={{color:C.red}}>▼</span> Distribution</span>
          <span><span style={{color:C.orange}}>■</span> HT</span>
          <span><span style={{color:C.pink}}>■</span> HY</span>
          <span><span style={{color:C.blue}}>■</span> IBV</span>
          <span><span style={{color:C.green}}>■</span> PP</span>
          <span><span style={{color:C.teal}}>■</span> EMA9</span>
          {vcp.isContracting && <span><span style={{color:C.orange}}>—</span> VCP contraction</span>}
          {cup && <span><span style={{color:C.purple}}>┊</span> Cup{cup.hasHandle?' & Handle':''}</span>}
        </>}
      </div>
      <div style={{fontSize:8,color:C.muted,marginTop:4}}>
        Patterns are algorithmic approximations (esp. Cup & Handle) — use as a visual aid, not a precise signal.
        {showForecast && ' Forecast is a simple straight-line trend projection from recent closes — not a real prediction.'}
      </div>
    </div>
  )
}

function SortableHeader({label,sortKey,sortBy,sortDir,onSort,align='left'}){
  const active = sortBy===sortKey
  return(
    <span onClick={()=>onSort(sortKey)}
      style={{cursor:'pointer',userSelect:'none',display:'flex',alignItems:'center',
        gap:3,justifyContent:align==='right'?'flex-end':align==='center'?'center':'flex-start',
        color:active?C.accent:C.muted}}>
      {label}
      <span style={{fontSize:8,opacity:active?1:0.3}}>{active&&sortDir==='asc'?'▲':'▼'}</span>
    </span>
  )
}

function DesktopRow({s,i,onChart}){
  const [open,setOpen]=useState(false)
  // Grid: # | Symbol+Sector+Badges | RS | Trend | Price | Chg% | PP 10d | RS 7d | expand
  const COLS='32px 130px 52px 48px 48px 52px 52px 64px 90px 112px 182px 140px 55px 55px 48px 48px 48px 55px 32px 32px'
  return(
    <div style={{borderBottom:`1px solid ${C.border}22`}}>
      <div onClick={()=>onChart&&onChart(s.sym)}
        style={{display:'grid',gridTemplateColumns:COLS,
          padding:'5px 12px',alignItems:'center',cursor:'pointer',gap:4,
          borderBottom:`1px solid ${C.divider}`,
          background:open?C.active:'transparent'}}
        onMouseEnter={e=>{if(!open)e.currentTarget.style.background=C.rowHover}}
        onMouseLeave={e=>{if(!open)e.currentTarget.style.background='transparent'}}>

        {/* # */}
        <span style={{color:C.muted,fontSize:11,textAlign:'center'}}>{i+1}</span>

        {/* Symbol — WealthLab style: bold sym + muted sector on same line */}
        <div style={{minWidth:0,overflow:'hidden'}}>
          <div style={{display:'flex',alignItems:'center',gap:4}}>
            <span onClick={e=>{e.stopPropagation();onChart&&onChart()}}
              style={{fontWeight:600,fontSize:12,color:C.accent,
                letterSpacing:'0.01em',cursor:'pointer',textDecoration:'underline',
                textDecorationColor:C.accent+'55',textUnderlineOffset:'2px'}}
              title={`Open ${s.sym} chart`}>{s.sym}</span>
            {s.pp.isPP&&<span style={{fontSize:9,color:C.orange,fontWeight:700}}>PP</span>}
            {s.hy.isHY&&<span style={{fontSize:9,color:C.blue,fontWeight:700}}>HY</span>}
            {s.ht.isHT&&<span style={{fontSize:9,color:C.purple,fontWeight:700}}>HT</span>}
          </div>
          <div style={{fontSize:9,color:C.muted,marginTop:1,
            overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
            {s.sector}
          </div>
        </div>

        {/* RS-TV (TradingView / Lakshmi Mata formula — primary) */}
        <div style={{textAlign:'center'}}>
          {s.rsTv!=null?(
            <>
              <div style={{fontWeight:700,fontSize:15,color:rsColor(s.rsTv),lineHeight:1}}>{s.rsTv}</div>
              <div style={{fontSize:7,color:C.teal,marginTop:1,fontWeight:700}}>TV</div>
            </>
          ):<span style={{color:C.muted,fontSize:9}} title="RS-TV needs 504+ days of price history">N/A</span>}
        </div>

        {/* RS within Midcap */}
        <div style={{textAlign:'center'}} title={`RS vs Midcap 150 index as benchmark (same TV formula, Midcap index price used instead of Nifty): ${s.rsMidcap??'N/A'}`}>
          {s.rsMidcap!=null?(
            <>
              <div style={{fontWeight:800,fontSize:13,color:rsColor(s.rsMidcap)}}>{s.rsMidcap}</div>
              <div style={{fontSize:7,color:C.blue,marginTop:1,fontWeight:600}}>vs MID</div>
            </>
          ):<span style={{color:C.border,fontSize:9}}>—</span>}
        </div>

        {/* RS within Smallcap */}
        <div style={{textAlign:'center'}} title={`RS vs Smallcap 250 index as benchmark (same TV formula, Smallcap index price used instead of Nifty): ${s.rsSmallcap??'N/A'}`}>
          {s.rsSmallcap!=null?(
            <>
              <div style={{fontWeight:800,fontSize:13,color:rsColor(s.rsSmallcap)}}>{s.rsSmallcap}</div>
              <div style={{fontSize:7,color:C.yellow,marginTop:1,fontWeight:600}}>vs SML</div>
            </>
          ):<span style={{color:C.border,fontSize:9}}>—</span>}
        </div>



        {/* RS within Sector */}
        <div style={{textAlign:'center'}} title={`RS rank vs ${s.sector} sector peers: ${s.rsSector??'N/A'}`}>
          {s.rsSector!=null?(
            <>
              <div style={{fontWeight:800,fontSize:13,color:rsColor(s.rsSector)}}>{s.rsSector}</div>
              <div style={{fontSize:7,color:C.orange,marginTop:1,fontWeight:600}}>SEC</div>
            </>
          ):<span style={{color:C.border,fontSize:9}}>—</span>}
        </div>

        {/* Slope/Trend */}
        <div style={{textAlign:'center'}}>
          <div style={{fontWeight:700,fontSize:14,color:trendColor(s.rsTrend.trend)}}>{trendIcon(s.rsTrend.trend)}</div>
          <div style={{fontSize:9,color:C.muted}}>{s.rsTrend.slope>0?'+':''}{s.rsTrend.slope}/d</div>
        </div>

        {/* Price */}
        <div style={{textAlign:'right'}}>
          <div style={{fontWeight:700,fontSize:13}}>{fmtP(s.last)}</div>
          <div style={{fontSize:10,fontWeight:700,color:s.chg>=0?C.green:C.red}}>
            {s.chg>=0?'+':''}{s.chg.toFixed(2)}%</div>
        </div>

        {/* Chg% badge */}
        <div style={{textAlign:'center'}}>
          <span style={{padding:'3px 7px',borderRadius:6,fontSize:11,fontWeight:700,
            background:(s.chg>=0?C.green:C.red)+'22',color:s.chg>=0?C.green:C.red}}>
            {s.chg>=0?'+':''}{s.chg.toFixed(1)}%
          </span>
        </div>

        {/* PP 10 days */}
        <div style={{display:'flex',flexDirection:'column',gap:3,alignItems:'center',minWidth:0,overflow:'hidden'}}>
          <PPDots ppHistory={s.pp.ppHistory||[]} color={C.green}/>
          <span style={{fontSize:9,color:s.pp.ppCount10d>0?C.orange:C.muted,fontWeight:700,whiteSpace:'nowrap'}}>
            {s.pp.ppCount10d}× PP
          </span>
        </div>

        {/* RS Last 7d */}
        <div style={{display:'flex',gap:2,alignItems:'center',minWidth:0,overflow:'hidden'}}>
          {s.hist.slice(-7).map((v,idx)=>{
            const color=v===null?C.border:v>=90?C.green:v>=70?C.accent:v>=50?C.yellow:C.red
            return<div key={idx} style={{flex:'1 1 0',minWidth:0,height:24,borderRadius:4,background:color+'28',
              border:`1px solid ${color}55`,display:'flex',alignItems:'center',justifyContent:'center',
              fontSize:9,fontWeight:800,color}}>{v??'—'}</div>
          })}
        </div>

        {/* Stage compact */}
        <div style={{display:'flex',flexDirection:'column',gap:2,alignItems:'flex-start'}}>
          <StageBadge stage={calcWeinsteinStage(s)}/>
          {(()=>{const ibv=calcIBV(s);return ibv.isIBV&&(
            <div style={{padding:'2px 6px',borderRadius:5,fontSize:9,fontWeight:700,
              background:ibv.color+'22',color:ibv.color,border:`1px solid ${ibv.color}44`}}
              title={ibv.desc}>
              🏛️ IBV {ibv.ppCount}d
            </div>
          )})()}
          {(()=>{const bo=calcHYHTBreakout(s);return bo.isBreakout&&(
            <div style={{padding:'2px 6px',borderRadius:5,fontSize:9,fontWeight:700,
              background:bo.color+'22',color:bo.color,border:`1px solid ${bo.color}44`}}
              title={bo.desc}>
              💥 {bo.strength}
            </div>
          )})()}
          <VolBadge vol={calcVolAnalysis(s)}/>
        </div>

        {/* Market Cap */}
        <div style={{textAlign:'right',fontSize:10}}>
          {s.marketCap!=null?(
            <span style={{color:C.text}}>
              {s.marketCap>=100000?`${(s.marketCap/100000).toFixed(1)}L`:
               s.marketCap>=1000?`${(s.marketCap/1000).toFixed(1)}K`:
               `${s.marketCap}`}
            </span>
          ):<span style={{color:C.muted}}>—</span>}
          <div style={{fontSize:8,color:C.muted}}>MCap</div>
        </div>

        {/* P/E */}
        <div style={{textAlign:'right',fontSize:10}}>
          {s.pe!=null?(
            <span style={{color:s.pe<20?C.green:s.pe<40?C.yellow:C.red}}>{s.pe.toFixed(1)}</span>
          ):<span style={{color:C.muted}}>—</span>}
          <div style={{fontSize:8,color:C.muted}}>P/E</div>
        </div>

        {/* ROE */}
        <div style={{textAlign:'right',fontSize:10}}>
          {s.roe!=null?(
            <span style={{color:s.roe>20?C.green:s.roe>10?C.yellow:C.red}}>{s.roe.toFixed(1)}%</span>
          ):<span style={{color:C.muted}}>—</span>}
          <div style={{fontSize:8,color:C.muted}}>ROE</div>
        </div>

        {/* Debt/Equity */}
        <div style={{textAlign:'right',fontSize:10}}>
          {s.debtEq!=null?(
            <span style={{color:s.debtEq<0.5?C.green:s.debtEq<1.5?C.yellow:C.red}}>{s.debtEq.toFixed(2)}</span>
          ):<span style={{color:C.muted}}>—</span>}
          <div style={{fontSize:8,color:C.muted}}>D/E</div>
        </div>

        {/* Promoter % */}
        <div style={{textAlign:'right',fontSize:10}}>
          {s.promoter!=null?(
            <span style={{color:s.promoter>55?C.green:s.promoter>35?C.yellow:C.red}}>{s.promoter.toFixed(1)}%</span>
          ):<span style={{color:C.muted}}>—</span>}
          <div style={{fontSize:8,color:C.muted}}>Prom</div>
        </div>

        {/* Expand — separate click target from the row (which now opens
            the chart), so both actions stay reachable */}
        <span onClick={e=>{e.stopPropagation();setOpen(o=>!o)}}
          style={{textAlign:'center',fontSize:10,color:C.muted,cursor:'pointer',padding:'4px 0'}}>
          {open?'▲':'▼'}
        </span>

        {/* Direct-open links — icons only, stop propagation so clicking
            doesn't also toggle the row's expand/collapse */}
        <a href={`https://www.tradingview.com/chart/?symbol=NSE:${s.sym}`}
          target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()}
          title="Open in TradingView" style={{textAlign:'center',fontSize:14,textDecoration:'none'}}>
          📈
        </a>
        <a href={`https://www.screener.in/company/${s.sym}/consolidated/`}
          target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()}
          title="Open in Screener.in" style={{textAlign:'center',fontSize:14,textDecoration:'none'}}>
          📊
        </a>
      </div>
      {open&&<StockDetail s={s}/>}
    </div>
  )
}

// ── Sector Panel ──────────────────────────────────────────────────────
function SectorPanel({sectorData,allStocks,isMobile,onChart,onViewInRS}){
  const [expanded,setExpanded]=useState(null)
  const {copy,copied}=useCopy()
  if(!sectorData||sectorData.length===0)return(
    <div style={{textAlign:'center',padding:'40px 0',color:C.muted}}>
      <div style={{fontSize:36,marginBottom:10}}>📊</div>
      <div style={{fontSize:14,fontWeight:700,color:C.text}}>Run a scan to see Sector RS</div>
    </div>
  )
  return(
    <div>
      <div style={{fontSize:12,color:C.muted,marginBottom:10}}>
        Sector RS = average RS of all scanned stocks in that sector (Nifty50 + Midcap + Smallcap)
      </div>
      <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'1fr 1fr',gap:10}}>
        {sectorData.map(sec=>(
          <div key={sec.sector} style={{background:C.card,
            border:`1px solid ${expanded===sec.sector?C.accent+'55':C.border}`,borderRadius:12,overflow:'hidden'}}>
            <div onClick={()=>setExpanded(e=>e===sec.sector?null:sec.sector)}
              style={{padding:'13px 14px',cursor:'pointer'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                <div>
                  <div style={{fontWeight:800,fontSize:14,display:'flex',alignItems:'center',gap:6}}>
                    <span>#{sec.rank} {sec.sector}</span>
                    {sec.rankChange!=null&&sec.rankChange!==0&&(
                      <span style={{fontSize:10,fontWeight:700,padding:'1px 6px',borderRadius:10,
                        background:(sec.rankChange>0?C.green:C.red)+'22',
                        color:sec.rankChange>0?C.green:C.red}}>
                        {sec.rankChange>0?'▲':'▼'}{Math.abs(sec.rankChange)} wk
                      </span>
                    )}
                  </div>
                  <div style={{fontSize:11,color:C.muted,marginTop:2}}>
                    {sec.count} stocks · {sec.ppCount} PP today · {sec.improving} improving
                  </div>
                </div>
                <div style={{textAlign:'center'}}>
                  <div style={{fontSize:28,fontWeight:900,color:rsColor(sec.avgRS),lineHeight:1}}>{sec.avgRS}</div>
                  <div style={{fontSize:9,color:C.muted}}>Sector RS</div>
                </div>
              </div>
              <div style={{width:'100%',background:C.border,borderRadius:99,height:6,overflow:'hidden',marginBottom:8}}>
                <div style={{width:`${sec.avgRS}%`,height:'100%',background:rsColor(sec.avgRS),borderRadius:99}}/>
              </div>
              <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
                {sec.topStocks.slice(0,5).map(t=>(
                  <div key={t.sym} style={{padding:'3px 8px',borderRadius:20,background:rsColor(t.rs)+'18',
                    border:`1px solid ${rsColor(t.rs)}44`,fontSize:10,fontWeight:700}}>
                    <span style={{color:C.text}}>{t.sym}</span>
                    <span style={{color:rsColor(t.rs),marginLeft:4}}>{t.rs}</span>
                  </div>
                ))}
                <span style={{fontSize:11,color:C.muted,marginLeft:'auto'}}>{expanded===sec.sector?'▲':'▼'}</span>
              </div>
            </div>
            {expanded===sec.sector&&(
              <div style={{borderTop:`1px solid ${C.border}`,padding:'12px 14px'}}>
                {(() => {
                  const sectorStocks = (allStocks||[]).filter(s=>s.sector===sec.sector).sort((a,b)=>b.rs-a.rs)
                  return (
                    <>
                      <TVCopyPanel stocks={sectorStocks} label={sec.sector}/>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                        <div style={{fontSize:11,fontWeight:700,color:C.muted,textTransform:'uppercase'}}>
                          All {sec.sector} stocks ({sectorStocks.length})
                        </div>
                        {onViewInRS&&(
                          <button onClick={e=>{e.stopPropagation();onViewInRS(sec.sector)}}
                            style={{padding:'5px 12px',borderRadius:8,border:`1px solid ${C.accent}`,
                              background:C.accent+'22',color:C.accent,fontSize:11,fontWeight:700,cursor:'pointer'}}>
                            View in RS Scanner →
                          </button>
                        )}
                      </div>
                      <SimpleStockTable stocks={sectorStocks} isMobile={isMobile} onChart={onChart}/>
                    </>
                  )
                })()}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Auth Screen ────────────────────────────────────────────────────────
// ── Landing Page ─────────────────────────────────────────────────────
function LandingPage({onEnroll,onSignIn,onDemo}){
  const [slide,setSlide]=useState(0)
  const [paused,setPaused]=useState(false)
  const [topGainers,setTopGainers]=useState([])
  const slideCount=3
  useEffect(()=>{
    if(paused) return
    const t=setInterval(()=>setSlide(s=>(s+1)%slideCount),4200)
    return ()=>clearInterval(t)
  },[paused])
  useEffect(()=>{
    fetchTopGainers(15).then(setTopGainers)
  },[])

  const gold='#C9A227', goldSoft='#E8D28A'
  const mono={fontFamily:"'IBM Plex Mono',monospace"}
  const serif={fontFamily:"'Playfair Display',serif"}
  const badge=(bg,fg,label)=>(
    <span style={{fontSize:9.5,padding:'2px 7px',borderRadius:4,marginRight:4,fontWeight:600,
      display:'inline-block',marginBottom:3,background:bg,color:fg}}>{label}</span>
  )
  const smallcaps=(text,center)=>(
    <div style={{...mono,fontSize:11,letterSpacing:'0.16em',textTransform:'uppercase',color:gold,
      display:'flex',alignItems:'center',gap:12,justifyContent:center?'center':'flex-start',marginBottom:16}}>
      <span style={{width:24,height:1,background:gold,opacity:0.5,display:'inline-block'}}/>
      {text}
      <span style={{width:24,height:1,background:gold,opacity:0.5,display:'inline-block'}}/>
    </div>
  )
  const rulesLine={borderBottom:`1px solid ${C.divider}`}

  return(
    <div style={{background:C.bg,color:C.text,fontFamily:"'Inter',sans-serif",lineHeight:1.55,minHeight:'100vh'}}>

      <div style={{background:C.sidebar,borderBottom:`1px solid ${C.divider}`,textAlign:'center',
        padding:'8px 0',...mono,fontSize:10.5,letterSpacing:'0.12em',color:C.muted}}>
        FOR INFORMATIONAL AND EDUCATIONAL PURPOSES · NOT INVESTMENT ADVICE
      </div>

      {/* Live ticker — today's real top gainers, not sample data. Public
          read on the stocks table (no auth needed), so this works for
          logged-out visitors too. */}
      {topGainers.length>0 && (
        <div style={{background:C.card,borderBottom:`1px solid ${C.divider}`,overflow:'hidden',
          whiteSpace:'nowrap',padding:'9px 0'}}>
          <style>{`
            @keyframes lakshmimata-ticker-scroll {
              from { transform: translateX(0); }
              to { transform: translateX(-50%); }
            }
          `}</style>
          <div style={{display:'inline-block',animation:'lakshmimata-ticker-scroll 32s linear infinite'}}>
            {[...topGainers,...topGainers].map((s,i)=>(
              <span key={i} style={{...mono,fontSize:12.5,letterSpacing:'0.02em',color:'#aab0c0',marginRight:36}}>
                <b style={{color:'#fff',fontWeight:500}}>{s.sym}</b>{' '}
                ₹{s.last_price?.toLocaleString('en-IN',{maximumFractionDigits:2})}{' '}
                <span style={{color:s.chg_pct>=0?'#5C8A6C':'#B4544A'}}>
                  {s.chg_pct>=0?'▲':'▼'} {Math.abs(s.chg_pct||0).toFixed(2)}%
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div style={{maxWidth:1080,margin:'0 auto',padding:'0 24px'}}>
        {/* Nav */}
        <nav style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'24px 0',
          borderBottom:`1px solid ${C.divider}`}}>
          <div style={{display:'flex',alignItems:'center',gap:11}}>
            <div style={{width:36,height:36,border:`1px solid ${gold}`,borderRadius:'50%',display:'flex',
              alignItems:'center',justifyContent:'center',...serif,color:gold,fontSize:16,fontStyle:'italic'}}>L</div>
            <div style={{...serif,fontSize:20,color:'#fff'}}>Lakshmi<em style={{color:gold,fontStyle:'italic'}}>mata</em></div>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <button onClick={onDemo} title="Browse with sample data — no signup"
              style={{border:`1px solid ${gold}66`,padding:'9px 16px',fontSize:12.5,borderRadius:3,
                ...mono,background:'transparent',color:goldSoft,cursor:'pointer',
                display:'flex',alignItems:'center',gap:6}}>
              👁 Demo
            </button>
            <button onClick={onSignIn} style={{border:`1px solid ${C.border}`,padding:'9px 20px',fontSize:12.5,
              ...mono,background:'transparent',color:C.text,cursor:'pointer'}}>Sign In</button>
          </div>
        </nav>

        {/* Hero */}
        <section style={{padding:'76px 0 52px',textAlign:'center'}}>
          {smallcaps('An NSE Relative-Strength Scanner',true)}
          <h1 style={{...serif,fontWeight:600,fontSize:'clamp(34px,4.8vw,56px)',lineHeight:1.14,
            maxWidth:800,margin:'0 auto',color:'#fff'}}>
            See which stocks are<br/>
            <em style={{color:goldSoft,fontStyle:'italic'}}>gathering strength</em><br/>
            before the crowd does.
          </h1>
          <p style={{maxWidth:540,margin:'24px auto 0',fontSize:16,color:'#aab0c0',lineHeight:1.7}}>
            A daily, systematic read on relative strength, volume conviction, and breakout structure
            across the NSE universe — for traders who would rather scan the whole market than one chart at a time.
          </p>
          <div style={{marginTop:32}}>
            <button onClick={onEnroll} style={{background:gold,color:'#0a0d12',padding:'14px 32px',
              fontWeight:700,fontSize:14,letterSpacing:'0.02em',border:`1px solid ${gold}`,cursor:'pointer'}}>
              Enroll — No Charge to Begin
            </button>
            <div style={{marginTop:14}}>
              <button onClick={onDemo} style={{background:'transparent',border:'none',cursor:'pointer',
                color:goldSoft,fontSize:12.5,...mono,letterSpacing:'0.02em',textDecoration:'underline',
                textUnderlineOffset:3}}>
                👁 Or browse with sample data first — no signup
              </button>
            </div>
          </div>
          <p style={{fontSize:11.5,color:C.muted,...mono,letterSpacing:'0.03em',marginTop:14}}>
            2,380+ NSE STOCKS TRACKED · UPDATED THROUGH THE SESSION
          </p>
        </section>

        {/* Slideshow */}
        <div style={{maxWidth:900,margin:'56px auto 0'}}
          onMouseEnter={()=>setPaused(true)} onMouseLeave={()=>setPaused(false)}>
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,overflow:'hidden',
            boxShadow:'0 30px 70px -30px rgba(0,0,0,0.6)'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'13px 20px',
              borderBottom:`1px solid ${C.divider}`,background:C.sidebar}}>
              <span style={{...mono,fontSize:11.5,color:C.muted,letterSpacing:'0.04em'}}>● LIVE PREVIEW — SAMPLE DATA</span>
              <div style={{display:'flex',gap:5}}>
                {[0,1,2].map(i=><div key={i} style={{width:7,height:7,borderRadius:'50%',background:C.border}}/>)}
              </div>
            </div>
            <div style={{padding:'22px 24px 26px',minHeight:280}}>
              {slide===0 && (
                <div>
                  <div style={{display:'flex',alignItems:'baseline',gap:10,marginBottom:16}}>
                    <h4 style={{...serif,fontSize:17,color:'#fff',fontWeight:600}}>RS Scanner</h4>
                    <span style={{fontSize:11,color:C.muted,...mono}}>Relative strength, ranked 1–99</span>
                  </div>
                  <table style={{width:'100%',borderCollapse:'collapse'}}>
                    <thead><tr>
                      {['Symbol','Sector','RS','Signal','Chg'].map(h=>(
                        <th key={h} style={{textAlign:'left',padding:'8px 10px',...mono,fontSize:9.5,
                          letterSpacing:'0.06em',textTransform:'uppercase',color:C.muted,...rulesLine,fontWeight:400}}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody style={mono}>
                      {[
                        ['LODHA','Realty','99',C.green,badge(C.orange+'26',C.orange,'🔥PP'),'+3.4%'],
                        ['KIRLOSENG','Engineering','98',C.green,badge(C.blue+'26',C.blue,'📊HY'),'+2.1%'],
                        ['IPCALAB','Pharma','99',C.green,badge(C.green+'26',C.green,'⚡EMA9'),'+1.8%'],
                        ['GODREJPROP','Realty','99',C.green,badge(C.yellow+'26',C.yellow,'☕Cup'),'+0.9%'],
                        ['GREAVESCOT','Engineering','95',C.accent,badge(C.purple+'26',C.purple,'🚀HT'),'+1.2%'],
                      ].map(([sym,sec,rs,rsColor2,bdg,chg])=>(
                        <tr key={sym}>
                          <td style={{padding:'11px 10px',fontSize:12.5,...rulesLine}}>{sym}</td>
                          <td style={{padding:'11px 10px',fontSize:12.5,...rulesLine}}>{sec}</td>
                          <td style={{padding:'11px 10px',fontSize:12.5,...rulesLine}}>
                            <span style={{padding:'2px 9px',borderRadius:20,fontWeight:600,fontSize:12,
                              background:rsColor2+'26',color:rsColor2}}>{rs}</span>
                          </td>
                          <td style={{padding:'11px 10px',fontSize:12.5,...rulesLine}}>{bdg}</td>
                          <td style={{padding:'11px 10px',fontSize:12.5,...rulesLine,color:C.green}}>{chg}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {slide===1 && (
                <div>
                  <div style={{display:'flex',alignItems:'baseline',gap:10,marginBottom:16}}>
                    <h4 style={{...serif,fontSize:17,color:'#fff',fontWeight:600}}>Breakout Scanner</h4>
                    <span style={{fontSize:11,color:C.muted,...mono}}>Resistance breaks, cup &amp; handle, Guppy crossovers</span>
                  </div>
                  <table style={{width:'100%',borderCollapse:'collapse'}}>
                    <thead><tr>
                      {['Symbol','Signal','Level / Detail','RS','Chg'].map(h=>(
                        <th key={h} style={{textAlign:'left',padding:'8px 10px',...mono,fontSize:9.5,
                          letterSpacing:'0.06em',textTransform:'uppercase',color:C.muted,...rulesLine,fontWeight:400}}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody style={mono}>
                      {[
                        ['SCANSTL',badge(C.red+'26',C.red,'🎯R1 Break'),'R1 @ ₹47.10','99','+11.1%'],
                        ['THERMAX',badge(C.yellow+'26',C.yellow,'☕Cup'),'Depth 21%','84','+2.4%'],
                        ['GRINDWELL',badge(C.green+'26',C.green,'🐠Guppy'),'EMA9 crossed above EMA50','86','+1.7%'],
                        ['DLF',badge(C.teal+'26',C.teal,'🏛️IBV'),'2× vol, DCR 81%','92','+2.9%'],
                      ].map(([sym,bdg,detail,rs,chg])=>(
                        <tr key={sym}>
                          <td style={{padding:'11px 10px',fontSize:12.5,...rulesLine}}>{sym}</td>
                          <td style={{padding:'11px 10px',fontSize:12.5,...rulesLine}}>{bdg}</td>
                          <td style={{padding:'11px 10px',fontSize:12.5,...rulesLine}}>{detail}</td>
                          <td style={{padding:'11px 10px',fontSize:12.5,...rulesLine}}>{rs}</td>
                          <td style={{padding:'11px 10px',fontSize:12.5,...rulesLine,color:C.green}}>{chg}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {slide===2 && (
                <div>
                  <div style={{display:'flex',alignItems:'baseline',gap:10,marginBottom:16}}>
                    <h4 style={{...serif,fontSize:17,color:'#fff',fontWeight:600}}>Sector Rotation</h4>
                    <span style={{fontSize:11,color:C.muted,...mono}}>Where money is actually moving this week</span>
                  </div>
                  <table style={{width:'100%',borderCollapse:'collapse'}}>
                    <thead><tr>
                      {['Sector','Rank','Avg RS','Strength','Stocks'].map(h=>(
                        <th key={h} style={{textAlign:'left',padding:'8px 10px',...mono,fontSize:9.5,
                          letterSpacing:'0.06em',textTransform:'uppercase',color:C.muted,...rulesLine,fontWeight:400}}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody style={mono}>
                      {[
                        ['Realty','#1 ▲',92,C.green,8],
                        ['Consumption','#2',99,C.green,6],
                        ['Pharma','#3',94,C.green,12],
                        ['Private Bank','#4 ▼',78,C.accent,11],
                      ].map(([sec,rank,rs,barColor,n])=>(
                        <tr key={sec}>
                          <td style={{padding:'11px 10px',fontSize:12.5,...rulesLine}}>{sec}</td>
                          <td style={{padding:'11px 10px',fontSize:12.5,...rulesLine}}>{rank}</td>
                          <td style={{padding:'11px 10px',fontSize:12.5,...rulesLine,color:barColor}}>{rs}</td>
                          <td style={{padding:'11px 10px',fontSize:12.5,...rulesLine,width:120}}>
                            <div style={{background:C.divider,borderRadius:3,height:5,width:'100%',overflow:'hidden'}}>
                              <div style={{height:'100%',borderRadius:3,width:`${rs}%`,background:barColor}}/>
                            </div>
                          </td>
                          <td style={{padding:'11px 10px',fontSize:12.5,...rulesLine}}>{n}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div style={{display:'flex',justifyContent:'center',gap:8,padding:'16px 0 6px'}}>
              {[0,1,2].map(i=>(
                <div key={i} onClick={()=>setSlide(i)} style={{width:7,height:7,borderRadius:'50%',
                  cursor:'pointer',background:slide===i?gold:C.border,transition:'background .2s'}}/>
              ))}
            </div>
          </div>
        </div>

        {/* Lotus divider */}
        <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:16,padding:'64px 0 8px'}}>
          <div style={{height:1,background:C.divider,flex:1,maxWidth:240}}/>
          <svg width="30" height="30" viewBox="0 0 34 34" fill="none">
            <g stroke={gold} strokeWidth="1">
              <path d="M17 17 C17 9, 12 5, 17 2 C22 5, 17 9, 17 17Z"/>
              <path d="M17 17 C25 17, 29 12, 32 17 C29 22, 25 17, 17 17Z"/>
              <path d="M17 17 C17 25, 22 29, 17 32 C12 29, 17 25, 17 17Z"/>
              <path d="M17 17 C9 17, 5 22, 2 17 C5 12, 9 17, 17 17Z"/>
            </g>
            <circle cx="17" cy="17" r="2" fill={gold}/>
          </svg>
          <div style={{height:1,background:C.divider,flex:1,maxWidth:240}}/>
        </div>

        {/* How it works */}
        <section style={{padding:'88px 0'}}>
          <div style={{maxWidth:600,margin:'0 auto 52px',textAlign:'center'}}>
            {smallcaps('How It Works',true)}
            <h2 style={{...serif,fontWeight:600,fontSize:'clamp(26px,3.2vw,36px)',color:'#fff'}}>
              Four signals. One ranked list.
            </h2>
          </div>
          <div style={{borderTop:`1px solid ${C.divider}`,maxWidth:820,margin:'0 auto'}}>
            {[
              ['I.','Relative Strength (RS-TV)','Every stock ranked 1–99 against the broader market and its own peer group, recalculated through the trading session — not a static end-of-day number.'],
              ['II.','Volume conviction','Pocket Pivots, HY/HT volume surges, and institutional-style buying pressure — the difference between a move with real participation and a move without it.'],
              ['III.','Structure & breakouts','Resistance breaks, cup-and-handle formations, and Guppy moving-average crossovers, flagged the day they happen — not three candles later.'],
              ['IV.','Sector & index context','See which sectors are actually leading this week versus which stock is just borrowing strength from a hot theme.'],
            ].map(([num,title,desc])=>(
              <div key={num} style={{display:'grid',gridTemplateColumns:'64px 1fr',gap:24,padding:'26px 0',
                borderBottom:`1px solid ${C.divider}`}}>
                <div style={{...serif,fontStyle:'italic',color:gold,fontSize:20}}>{num}</div>
                <div>
                  <h3 style={{fontSize:18,marginBottom:7,fontWeight:600,color:'#fff'}}>{title}</h3>
                  <p style={{color:'#9aa0b0',fontSize:14,maxWidth:480}}>{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Trust */}
        <section style={{padding:'0 0 88px'}}>
          <div style={{border:`1px solid ${C.border}`,padding:'36px 42px',maxWidth:820,margin:'0 auto',
            background:C.card,borderRadius:6}}>
            <h3 style={{fontSize:18,marginBottom:14,fontStyle:'italic',color:goldSoft,...serif,fontWeight:600}}>
              Before you rely on this
            </h3>
            <p style={{color:'#9aa0b0',fontSize:13.5,lineHeight:1.8}}>
              Lakshmimata is a data and screening tool. It surfaces relative-strength rankings and technical
              signals computed from public market data — it does not constitute investment advice, a
              recommendation to buy or sell any security, or a research report under SEBI (Research Analysts)
              Regulations, 2014.
            </p>
            <p style={{color:'#9aa0b0',fontSize:13.5,lineHeight:1.8,marginTop:12}}>
              Past performance and technical signals are not indicative of future results. Please consult a
              SEBI-registered investment adviser or research analyst before making investment decisions, and
              review NSE/BSE data independently before trading.
            </p>
          </div>
        </section>

        {/* Enroll */}
        <section style={{textAlign:'center',padding:'96px 0 84px'}}>
          {smallcaps('Get Started',true)}
          <h2 style={{...serif,fontWeight:600,fontSize:'clamp(28px,3.6vw,40px)',maxWidth:600,margin:'0 auto 16px',color:'#fff'}}>
            Your watchlist is already moving. Go see it.
          </h2>
          <p style={{color:'#9aa0b0',maxWidth:440,margin:'0 auto 30px',fontSize:15}}>
            Create a free account and get today's ranked scan the moment you log in.
          </p>
          <button onClick={onEnroll} style={{background:gold,color:'#0a0d12',padding:'14px 32px',fontWeight:700,
            fontSize:14,letterSpacing:'0.02em',border:`1px solid ${gold}`,cursor:'pointer'}}>
            Enroll Free
          </button>
        </section>

        <footer style={{borderTop:`1px solid ${C.divider}`,padding:'28px 0',display:'flex',
          justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:14,fontSize:11,
          color:C.muted,...mono}}>
          <span>© 2026 LAKSHMIMATA · FOR INFORMATIONAL AND EDUCATIONAL PURPOSES ONLY</span>
          <span>NOT A SEBI-REGISTERED RESEARCH ANALYST OR INVESTMENT ADVISER</span>
        </footer>
      </div>
    </div>
  )
}

// ── Auth Screen ──────────────────────────────────────────────────────
function AuthScreen({onLogin,initialMode='login',onBack}){
  const [mode,setMode]=useState(initialMode) // login | register | forgot
  const [email,setEmail]=useState('')
  const [password,setPassword]=useState('')
  const [name,setName]=useState('')
  const [upstoxToken,setUpstoxToken]=useState('')
  const [error,setError]=useState('')
  const [info,setInfo]=useState('')
  const [loading,setLoading]=useState(false)
  const [googleLoading,setGoogleLoading]=useState(false)
  const ownerMode=!!OWNER_TOKEN

  // Google OAuth — Supabase handles everything
  const handleGoogle=async()=>{
    setGoogleLoading(true);setError('')
    const{error:e}=await supabase.auth.signInWithOAuth({
      provider:'google',
      options:{
        redirectTo: window.location.origin, // redirect back to the app after Google login
        queryParams:{access_type:'offline',prompt:'select_account'},
      }
    })
    if(e){setError(e.message);setGoogleLoading(false)}
    // On success, Supabase redirects to Google, then back — onAuthStateChange handles it
  }

  const handleEmailAuth=async()=>{
    setError('');setInfo('');setLoading(true)
    try{
      if(mode==='forgot'){
        const{error:e}=await supabase.auth.resetPasswordForEmail(email,{
          redirectTo:`${window.location.origin}?reset=true`
        })
        if(e)throw e
        setInfo('Password reset email sent! Check your inbox.');setMode('login')
      } else if(mode==='login'){
        const{data,error:e}=await supabase.auth.signInWithPassword({email,password})
        if(e)throw e
        const{data:decryptedToken}=await supabase.rpc('get_upstox_token')
        onLogin({user:data.user,token:decryptedToken||OWNER_TOKEN})
      } else {
        // Register — password must be at least 10 characters and contain
        // both letters and numbers, checked client-side before hitting
        // Supabase so the person gets immediate, specific feedback.
        if(password.length<10){
          throw new Error('Password must be at least 10 characters long.')
        }
        if(!/[a-zA-Z]/.test(password)||!/[0-9]/.test(password)){
          throw new Error('Password must contain both letters and numbers.')
        }
        const{data,error:e}=await supabase.auth.signUp({
          email,password,
          options:{data:{full_name:name||email.split('@')[0]}}
        })
        if(e)throw e
        if(data.user&&upstoxToken){
          await supabase.rpc('save_upstox_token',{token:upstoxToken})
        }
        setInfo('Account created! Check your email to confirm, then sign in.')
        setMode('login')
      }
    }catch(e){setError(e.message||'Auth error')}
    setLoading(false)
  }

  return(
    <div style={{minHeight:'100vh',background:C.bg,display:'flex',alignItems:'center',
      justifyContent:'center',padding:20,position:'relative',
      backgroundImage:`radial-gradient(ellipse at 20% 50%, ${C.accent}08 0%, transparent 50%),radial-gradient(ellipse at 80% 20%, ${C.purple}08 0%, transparent 50%)`}}>
      {onBack&&(
        <button onClick={onBack} style={{position:'absolute',top:20,left:20,background:'transparent',
          border:'none',color:C.muted,fontSize:13,cursor:'pointer',display:'flex',alignItems:'center',gap:6}}>
          ← Back
        </button>
      )}
      <div style={{width:'100%',maxWidth:400}}>

        {/* Logo */}
        <div style={{textAlign:'center',marginBottom:28}}>
          <div style={{width:60,height:60,background:`linear-gradient(135deg,${C.accent},${C.purple})`,
            borderRadius:18,display:'inline-flex',alignItems:'center',justifyContent:'center',
            fontWeight:900,color:'#000',fontSize:30,marginBottom:14,
            boxShadow:`0 8px 32px ${C.accent}44`}}>P</div>
          <div style={{fontWeight:800,fontSize:26,letterSpacing:'-0.03em'}}>Lakshmimata</div>
          <div style={{color:C.muted,fontSize:13,marginTop:4}}>NSE Stock Scanner</div>
          {ownerMode&&(
            <div style={{marginTop:10,padding:'6px 14px',borderRadius:20,
              background:C.green+'18',border:`1px solid ${C.green}44`,
              display:'inline-block',fontSize:11,color:C.green,fontWeight:600}}>
              ✅ No Upstox token needed — powered by owner data
            </div>
          )}
        </div>

        <div style={{background:C.card,borderRadius:20,border:`1px solid ${C.border}`,
          padding:28,boxShadow:`0 20px 60px #00000044`}}>

          {/* ── Google Sign In (primary) ── */}
          <button onClick={handleGoogle} disabled={googleLoading||loading}
            style={{width:'100%',padding:'13px',borderRadius:12,
              border:`1px solid ${C.border}`,cursor:'pointer',
              background:'#fff',color:'#1f1f1f',fontWeight:700,fontSize:14,
              display:'flex',alignItems:'center',justifyContent:'center',gap:10,
              marginBottom:20,transition:'all 0.2s',
              boxShadow:googleLoading?'none':'0 1px 3px #00000022'}}>
            {googleLoading?(
              <div style={{width:18,height:18,border:'2px solid #4285f4',borderTopColor:'transparent',
                borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>
            ):(
              /* Google G logo SVG */
              <svg width="18" height="18" viewBox="0 0 18 18">
                <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
                <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
                <path fill="#FBBC05" d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z"/>
                <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.96l3.007 2.332C4.672 5.163 6.656 3.58 9 3.58z"/>
              </svg>
            )}
            {googleLoading?'Connecting to Google…':'Continue with Google'}
          </button>

          {/* Divider */}
          <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:20}}>
            <div style={{flex:1,height:1,background:C.border}}/>
            <span style={{fontSize:11,color:C.muted,fontWeight:600}}>OR</span>
            <div style={{flex:1,height:1,background:C.border}}/>
          </div>

          {/* Mode tabs */}
          <div style={{display:'flex',background:C.bg,borderRadius:10,padding:3,marginBottom:20}}>
            {[['login','Sign In'],['register','Register']].map(([m,label])=>(
              <button key={m} onClick={()=>{setMode(m);setError('');setInfo('')}}
                style={{flex:1,padding:'7px',borderRadius:8,border:'none',cursor:'pointer',
                  fontWeight:700,fontSize:12,
                  background:mode===m?C.card:'transparent',
                  color:mode===m?C.text:C.muted,
                  boxShadow:mode===m?'0 1px 4px #00000044':'none'}}>
                {label}
              </button>
            ))}
          </div>

          {/* Alerts */}
          {error&&(
            <div style={{background:C.red+'18',border:`1px solid ${C.red}44`,borderRadius:8,
              padding:'10px 12px',marginBottom:14,fontSize:12,color:C.red,fontWeight:600}}>
              ❌ {error}
            </div>
          )}
          {info&&(
            <div style={{background:C.green+'18',border:`1px solid ${C.green}44`,borderRadius:8,
              padding:'10px 12px',marginBottom:14,fontSize:12,color:C.green,fontWeight:600}}>
              ✅ {info}
            </div>
          )}

          {/* Form fields */}
          <div style={{display:'flex',flexDirection:'column',gap:12}}>
            {mode==='register'&&(
              <div>
                <label style={{fontSize:11,color:C.muted,fontWeight:700,textTransform:'uppercase',
                  letterSpacing:'0.08em',display:'block',marginBottom:5}}>Name</label>
                <input value={name} onChange={e=>setName(e.target.value)}
                  placeholder="Your name"
                  style={{width:'100%',padding:'12px 13px',background:C.bg,
                    border:`1px solid ${C.border}`,borderRadius:9,color:C.text,
                    fontSize:14,outline:'none',boxSizing:'border-box'}}/>
              </div>
            )}
            <div>
              <label style={{fontSize:11,color:C.muted,fontWeight:700,textTransform:'uppercase',
                letterSpacing:'0.08em',display:'block',marginBottom:5}}>Email</label>
              <input type="email" value={email} onChange={e=>setEmail(e.target.value)}
                placeholder="you@gmail.com"
                onKeyDown={e=>e.key==='Enter'&&handleEmailAuth()}
                style={{width:'100%',padding:'12px 13px',background:C.bg,
                  border:`1px solid ${C.border}`,borderRadius:9,color:C.text,
                  fontSize:14,outline:'none',boxSizing:'border-box'}}/>
            </div>
            {mode!=='forgot'&&(
              <div>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:5}}>
                  <label style={{fontSize:11,color:C.muted,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em'}}>Password</label>
                  {mode==='login'&&(
                    <button onClick={()=>{setMode('forgot');setError('');setInfo('')}}
                      style={{fontSize:11,color:C.accent,fontWeight:600,background:'none',border:'none',cursor:'pointer',padding:0}}>
                      Forgot password?
                    </button>
                  )}
                </div>
                <input type="password" value={password} onChange={e=>setPassword(e.target.value)}
                  placeholder={mode==='register'?'Min 10 characters, letters + numbers':'Enter password'}
                  onKeyDown={e=>e.key==='Enter'&&handleEmailAuth()}
                  style={{width:'100%',padding:'12px 13px',background:C.bg,
                    border:`1px solid ${C.border}`,borderRadius:9,color:C.text,
                    fontSize:14,outline:'none',boxSizing:'border-box'}}/>
                {mode==='register'&&(
                  <div style={{fontSize:11,color:C.muted,marginTop:6}}>
                    At least 10 characters, with both letters and numbers.
                  </div>
                )}
              </div>
            )}
            {mode==='register'&&(
              <div>
                <label style={{fontSize:11,color:C.muted,fontWeight:700,textTransform:'uppercase',
                  letterSpacing:'0.08em',display:'block',marginBottom:5}}>
                  Upstox Token <span style={{color:C.muted,fontWeight:400,textTransform:'none'}}>(optional)</span>
                </label>
                <input type="password" value={upstoxToken}
                  placeholder={ownerMode?'Leave blank to use owner token':'eyJ0eXAiOiJKV1Q…'}
                  onChange={e=>setUpstoxToken(e.target.value)}
                  style={{width:'100%',padding:'12px 13px',background:C.bg,
                    border:`1px solid ${C.border}`,borderRadius:9,color:C.text,
                    fontSize:13,outline:'none',boxSizing:'border-box',fontFamily:'monospace'}}/>
              </div>
            )}

            <button onClick={handleEmailAuth} disabled={loading||googleLoading}
              style={{width:'100%',padding:'13px',
                background:loading?C.border:`linear-gradient(135deg,${C.accent},${C.accent}cc)`,
                color:loading?C.muted:'#000',border:'none',borderRadius:9,
                fontWeight:800,fontSize:14,cursor:loading?'not-allowed':'pointer',marginTop:4}}>
              {loading?'Please wait…':
                mode==='forgot'?'📧 Send Reset Email':
                mode==='login'?'🔐 Sign In':'🚀 Create Account'}
            </button>

            {mode==='forgot'&&(
              <button onClick={()=>{setMode('login');setError('');setInfo('')}}
                style={{width:'100%',padding:'10px',background:'transparent',color:C.muted,
                  border:'none',cursor:'pointer',fontSize:13,fontWeight:600}}>
                ← Back to Sign In
              </button>
            )}
          </div>

          {/* Security note */}
          <div style={{marginTop:18,padding:'10px 12px',background:C.accent+'08',
            border:`1px solid ${C.accent}18`,borderRadius:8}}>
            <div style={{fontSize:10,color:C.muted,lineHeight:1.6,display:'flex',gap:6,alignItems:'flex-start'}}>
              <span>🔒</span>
              <span>Passwords bcrypt-hashed · Google OAuth 2.0 · Row Level Security · TLS encrypted</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Settings Panel ────────────────────────────────────────────────────
function SettingsPanel({session,onUpdate,onLogout,themeKey,switchTheme,ambient}){
  const [newToken,setNewToken]=useState('')
  const [msg,setMsg]=useState('')
  const [loading,setLoading]=useState(false)
  const ownerMode=!!OWNER_TOKEN

  const saveToken=async()=>{
    if(!newToken){setMsg('❌ Enter a token');return}
    setLoading(true)
    const{error}=await supabase.from('user_tokens')
      .upsert({user_id:session.user.id,upstox_token:newToken},{onConflict:'user_id'})
    if(error)setMsg('❌ '+error.message)
    else{setMsg('✅ Token saved!');onUpdate({...session,token:newToken});setNewToken('')}
    setLoading(false)
  }
  const handleLogout=async()=>{await supabase.auth.signOut();onLogout()}

  return(
    <div style={{maxWidth:480,margin:'32px auto',padding:'0 16px'}}>
      <div style={{background:C.card,borderRadius:14,border:`1px solid ${C.border}`,padding:24}}>
        <div style={{fontWeight:800,fontSize:18,marginBottom:4}}>Account Settings</div>
        <div style={{color:C.muted,fontSize:12,marginBottom:16}}>
          Signed in as <strong style={{color:C.accent}}>{session.user.email}</strong>
        </div>
        <div style={{marginBottom:20,fontSize:12,color:C.muted,background:C.bg,
          border:`1px solid ${C.border}`,borderRadius:8,padding:'10px 12px'}}>
          🎨 Theme and ambient sound moved — look for the palette icon in the top-right corner, on any tab.
        </div>
        {ownerMode&&(
          <div style={{background:C.green+'18',border:`1px solid ${C.green}33`,borderRadius:8,
            padding:'10px 12px',marginBottom:16,fontSize:12,color:C.green}}>
            ✅ Using owner's Upstox token — scanner works without your own token.
            You can optionally override with your own below.
          </div>
        )}
        {msg&&<div style={{background:(msg.startsWith('✅')?C.green:C.red)+'18',
          border:`1px solid ${(msg.startsWith('✅')?C.green:C.red)}44`,
          borderRadius:8,padding:'10px 12px',marginBottom:14,fontSize:12,
          color:msg.startsWith('✅')?C.green:C.red,fontWeight:600}}>{msg}</div>}
        <div style={{marginBottom:20}}>
          <label style={{fontSize:11,color:C.muted,fontWeight:700,textTransform:'uppercase',
            letterSpacing:'0.08em',display:'block',marginBottom:6}}>
            {ownerMode?'Override with your own Upstox Token (optional)':'Update Upstox Token'}
          </label>
          <input type="password" value={newToken} placeholder="eyJ0eXAiOiJKV1Q…"
            onChange={e=>setNewToken(e.target.value)}
            style={{width:'100%',padding:'11px 13px',background:C.bg,border:`1px solid ${C.border}`,
              borderRadius:8,color:C.text,fontSize:13,outline:'none',boxSizing:'border-box',
              fontFamily:'monospace',marginBottom:10}}/>
          <button onClick={saveToken} disabled={loading}
            style={{width:'100%',padding:'11px',background:C.accent,color:'#000',border:'none',
              borderRadius:8,fontWeight:700,fontSize:13,cursor:'pointer'}}>💾 Save Token</button>
        </div>
        <div style={{padding:'12px',background:C.accent+'10',border:`1px solid ${C.accent}22`,borderRadius:8,marginBottom:16}}>
          <div style={{fontSize:11,color:C.muted,lineHeight:1.7}}>
            <strong style={{color:C.accent}}>🔒</strong> Tokens encrypted in Supabase Postgres with Row Level Security.
          </div>
        </div>
        <button onClick={handleLogout}
          style={{width:'100%',padding:'11px',background:'transparent',color:C.red,
            border:`1px solid ${C.red}44`,borderRadius:8,fontWeight:700,fontSize:13,cursor:'pointer'}}>
          🚪 Sign Out
        </button>
      </div>
    </div>
  )
}

// ── Demo generators ───────────────────────────────────────────────────
function genC(days=320,trend=0.0003,vol=0.018){
  const p=[100],v=[500000]
  for(let i=1;i<days;i++){
    const chg=trend+(Math.random()-0.48)*vol
    p.push(+(p[i-1]*(1+chg)).toFixed(2))
    v.push(Math.round((200000+Math.random()*800000)*(Math.random()<0.04?5:1)))
  }
  return{prices:p,volumes:v}
}
function genDip(days=320){
  const p=[120],v=[400000]
  for(let i=1;i<days;i++){
    const t=i>270?0.003:-0.0005,chg=t+(Math.random()-0.48)*0.02
    p.push(+(p[i-1]*(1+chg)).toFixed(2))
    v.push(Math.round((200000+Math.random()*600000)*(i>270&&Math.random()<0.3?4:1)))
  }
  return{prices:p,volumes:v}
}
function genWeak(days=320){
  const p=[50],v=[300000]
  for(let i=1;i<days;i++){
    const t=i>300?0.004:-0.0003,chg=t+(Math.random()-0.52)*0.022
    p.push(+(p[i-1]*(1+chg)).toFixed(2))
    v.push(Math.round((150000+Math.random()*500000)*(i>300?3:1)))
  }
  return{prices:p,volumes:v}
}
const TRENDS=[0.0006,0.0009,0.0008,0.0007,0.0006,0.0005,0.0007,0.0004,0.0003,0.0002,0.0002,0.0001,0.0001,-0.0002,-0.0003,-0.0004,-0.0003,-0.0005,0.0005,0.0004,0.0003,0.0004,0.0003,0.0005,0.0002,0.0003,0.0004,0.0002,0.0003,0.0004,0.0003,0.0002,0.0001,0.0003,0.0002]
const DEMO_SYMS=['RELIANCE','ZOMATO','TRENT','HAL','BHARTIARTL','ICICIBANK','IRCTC','TITAN','TCS','HDFCBANK','INFOSYS','WIPRO','SBIN','TATAMOTORS','ADANIENT','NYKAA','PAYTM','YESBANK','SUNPHARMA','DRREDDY','MARUTI','BAJFINANCE','HCLTECH','EICHERMOT','KOTAKBANK','NTPC','DIVISLAB','BPCL','AXISBANK','APOLLOHOSP','M&M','JSWSTEEL','COALINDIA','LT','NESTLEIND']
const DEMO=[
  ...DEMO_SYMS.map((sym,i)=>({sym,...genC(320,TRENDS[i]||0.0003)})),
  ...['PVR','INDIABULL','RBLBANK','BANDHANBNK','DELTACORP','GMRINFRA'].map(sym=>({sym,...genDip()})),
  ...['IDEA','SUZLON','UNITECH','DISHTV','JPASSOCIAT','ALOKTEXT'].map(sym=>({sym,...genWeak()})),
]

// ── WATCHLIST STORAGE (localStorage) ─────────────────────────────────
const WL_KEY='pocketrs_watchlists'
function loadWatchlists(){try{return JSON.parse(localStorage.getItem(WL_KEY)||'[]')}catch{return[]}}
function saveWatchlists(wls){localStorage.setItem(WL_KEY,JSON.stringify(wls))}


// ── Market open check for sidebar dot ────────────────────────────────
function isMarketOpen(){
  const ist = new Date(Date.now() + ((330 + new Date().getTimezoneOffset())*60000))
  const day = ist.getDay()
  if(day===0||day===6) return false
  const mins = ist.getHours()*60 + ist.getMinutes()
  return mins >= 555 && mins <= 930
}

// ── Main App ──────────────────────────────────────────────────────────
// ── Error Boundary ───────────────────────────────────────────────────
// Without this, ANY uncaught render error anywhere in the tree takes
// the entire app to a blank screen with zero information — which has
// happened repeatedly in this project and is nearly impossible to
// diagnose on mobile without a proper console. This catches it and
// shows the actual error message + component stack on screen instead.
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null, info: null }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  componentDidCatch(error, info) {
    this.setState({ info })
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{minHeight:'100vh',background:'#0a0d12',color:'#e2e8f0',
          padding:20,fontFamily:'monospace',fontSize:13,lineHeight:1.6}}>
          <div style={{fontSize:18,fontWeight:700,color:'#ef4444',marginBottom:12}}>
            ⚠️ Something broke
          </div>
          <div style={{marginBottom:16}}>
            The app hit an error and couldn't render. Screenshot this whole
            screen and send it — this is the actual error message, which is
            what's needed to fix it (much more useful than "blank screen").
          </div>
          <div style={{background:'#1c2333',border:'1px solid #ef4444',borderRadius:8,
            padding:12,marginBottom:12,whiteSpace:'pre-wrap',wordBreak:'break-word'}}>
            {String(this.state.error?.message || this.state.error)}
          </div>
          {this.state.error?.stack && (
            <details style={{marginBottom:12}}>
              <summary style={{cursor:'pointer',color:'#4f8ef7'}}>Stack trace</summary>
              <div style={{background:'#0e1117',border:'1px solid #1c2333',borderRadius:8,
                padding:12,marginTop:8,whiteSpace:'pre-wrap',wordBreak:'break-word',fontSize:10.5,color:'#4a5568'}}>
                {this.state.error.stack}
              </div>
            </details>
          )}
          {this.state.info?.componentStack && (
            <details>
              <summary style={{cursor:'pointer',color:'#4f8ef7'}}>Component stack</summary>
              <div style={{background:'#0e1117',border:'1px solid #1c2333',borderRadius:8,
                padding:12,marginTop:8,whiteSpace:'pre-wrap',wordBreak:'break-word',fontSize:10.5,color:'#4a5568'}}>
                {this.state.info.componentStack}
              </div>
            </details>
          )}
          <button onClick={()=>window.location.reload()}
            style={{marginTop:16,padding:'10px 20px',background:'#4f8ef7',color:'#0a0d12',
              border:'none',borderRadius:8,fontWeight:700,cursor:'pointer'}}>
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

export default function App(){
  const isMobile=useIsMobile()
  const [session,setSession]=useState(null)
  // Demo mode: lets a logged-out visitor see the RS Rating scanner
  // populated with sample data (the existing DEMO dataset, previously
  // only reachable via the 👁 button INSIDE the already-authenticated
  // app) without signing up first. session stays null throughout —
  // every session-gated feature (DB-backed tabs, portfolio sync, etc.)
  // naturally no-ops on a null session, which is the correct behavior
  // here: demo mode is RS Rating with sample data only, not a fake
  // account with fake access to everything else.
  const [demoMode,setDemoMode]=useState(false)
  const [showAuth,setShowAuth]=useState(false)
  const [authMode,setAuthMode]=useState('login')
  const [themeVersion,setThemeVersion]=useState(0)
  const [themeKey,setThemeKey]=useState('dark')
  const ambient=useAmbientSound()
  const [showQuickSettings,setShowQuickSettings]=useState(false)
  const [showMoreMenu,setShowMoreMenu]=useState(false)
  const [showSignalGlossary,setShowSignalGlossary]=useState(false)
  const [expandedTileInfo,setExpandedTileInfo]=useState(null)
  const [showRowGuidance,setShowRowGuidance]=useState(false)
  const [breadthHistory,setBreadthHistory]=useState([])
  const [emaBreadthHistory,setEmaBreadthHistory]=useState([])
  const [breadthRange,setBreadthRange]=useState('1M')
  const [mainTab,setMainTab]=useState('rs')
  const [presetFilter,setPresetFilter]=useState('all')
  const [rsMin,setRsMin]=useState(0),[rsMax,setRsMax]=useState(99)
  const [rsImprFilter,setRsImprFilter]=useState('all')
  const [sigFilters,setSigFilters]=useState([]) // multi-select, [] = no filter (all)
  const [stageFilter,setStageFilter]=useState('all')
  const [sectorFilter,setSectorFilter]=useState('all')
  const [mcapMin,setMcapMin]=useState('')
  const [mcapMax,setMcapMax]=useState('')
  const [savedScanners,setSavedScanners]=useState([])
  const [selectedScannerId,setSelectedScannerId]=useState('')
  const [showSaveScannerInput,setShowSaveScannerInput]=useState(false)
  const [scannerNameInput,setScannerNameInput]=useState('')
  const [search,setSearch]=useState('')
  useEffect(()=>{
    if(mainTab==='indices' && breadthHistory.length===0){
      fetchMarketBreadthHistory(500).then(setBreadthHistory)
      fetchEmaBreadthHistory(500).then(setEmaBreadthHistory)
    }
  },[mainTab])

  // Load saved theme preference once on mount, before first paint of
  // anything meaningful. themeVersion is a dummy counter — bumping it
  // forces this component (and everything under it, since nothing here
  // is memoized) to re-render and re-read C's current values, since
  // React has no way to detect that C's properties were mutated.
  useEffect(()=>{
    let saved='dark'
    try{ saved=localStorage.getItem('lakshmimata-theme')||'dark' }catch(e){}
    applyTheme(saved)
    setThemeKey(saved)
    setThemeVersion(v=>v+1)
  },[])
  const switchTheme=(key)=>{
    applyTheme(key)
    setThemeKey(key)
    setThemeVersion(v=>v+1)
  }

  useEffect(()=>{
    if(session?.user?.id){
      fetchSavedScanners(session.user.id).then(setSavedScanners)
    } else {
      setSavedScanners([])
    }
  },[session])

  const currentFilterState = () => ({
    search, rsMin, rsMax, mcapMin, mcapMax, rsImprFilter,
    sigFilters, stageFilter, sectorFilter, presetFilter,
  })
  const applyFilterState = (f) => {
    setSearch(f.search??'')
    setRsMin(f.rsMin??0); setRsMax(f.rsMax??99)
    setMcapMin(f.mcapMin??''); setMcapMax(f.mcapMax??'')
    setRsImprFilter(f.rsImprFilter??'all')
    // Backward compatible: scanners saved before the Signal filter
    // became multi-select stored a single string (sigFilter); newer
    // ones store an array (sigFilters).
    if(Array.isArray(f.sigFilters)) setSigFilters(f.sigFilters)
    else if(f.sigFilter&&f.sigFilter!=='all') setSigFilters([f.sigFilter])
    else setSigFilters([])
    setStageFilter(f.stageFilter??'all')
    setSectorFilter(f.sectorFilter??'all')
    setPresetFilter(f.presetFilter??'all')
  }
  const handleSaveScanner = async () => {
    if(!session?.user?.id || !scannerNameInput.trim()) return
    const res = await saveScanner(session.user.id, scannerNameInput.trim(), currentFilterState())
    if(res.data){
      setSavedScanners(prev=>[res.data,...prev])
      setShowSaveScannerInput(false); setScannerNameInput('')
    }
  }
  const handleDeleteScanner = async (id) => {
    await deleteScanner(id)
    setSavedScanners(prev=>prev.filter(s=>s.id!==id))
  }
  const [authLoading,setAuthLoading]=useState(true)

  useEffect(()=>{
    // Load owner token from Supabase at runtime (refreshed daily by cron)
    fetchOwnerToken().then(t=>{ if(t) OWNER_TOKEN=t })

    supabase.auth.getSession().then(async({data:{session:s}})=>{
      if(s){
        const{data:td}=await supabase.from('user_tokens').select('upstox_token').eq('user_id',s.user.id).single()
        setSession({user:s.user,token:td?.upstox_token||OWNER_TOKEN})
      }
      setAuthLoading(false)
    })
    const{data:{subscription}}=supabase.auth.onAuthStateChange(async(event,s)=>{
      if(!s){ setSession(null); return }
      // Handle Google OAuth callback and email confirmation
      if(event==='SIGNED_IN'||event==='TOKEN_REFRESHED'){
        // Load owner token fresh
        const ownerTok = await fetchOwnerToken()
        if(ownerTok) OWNER_TOKEN = ownerTok
        // Load user's custom token if any
        const{data:td}=await supabase.from('user_tokens').select('upstox_token').eq('user_id',s.user.id).single()
        setSession({user:s.user,token:td?.upstox_token||OWNER_TOKEN})
        setAuthLoading(false)
      }
      if(event==='SIGNED_OUT') setSession(null)
    })
    return()=>subscription.unsubscribe()
  },[])

  // Scanner state
  const [stocks,setStocks]=useState([])
  const [sectorData,setSectorData]=useState([])
  const [loading,setLoading]=useState(false)
  const [progress,setProgress]=useState(0)
  const [progressMsg,setProgressMsg]=useState('')
  const [lastRefresh,setLastRefresh]=useState(null)
  const [autoRefresh,setAutoRefresh]=useState(true)   // ON by default
  const [refreshInterval,setRefreshInterval]=useState(60000) // 1 min default
  const [scanMeta,setScanMeta]=useState(null)
  const [weakThreshold,setWeakThreshold]=useState(8)
  const [indexFilter,setIndexFilter]=useState('all')
  const refreshTimer=useRef(null)

  // Watchlist state
  const [watchlists,setWatchlists]=useState(()=>loadWatchlists())
  const [activeWl,setActiveWl]=useState(null) // null = use index filter, else watchlist id

  const saveWL=wl=>{
    setWatchlists(prev=>{
      const exists=prev.find(w=>w.id===wl.id)
      const next=exists?prev.map(w=>w.id===wl.id?wl:w):[...prev,wl]
      saveWatchlists(next);return next
    })
  }
  const deleteWL=id=>{
    setWatchlists(prev=>{const next=prev.filter(w=>w.id!==id);saveWatchlists(next);return next})
    if(activeWl===id)setActiveWl(null)
  }

  // PP filters per tab
  const [chartSym,setChartSym]=useState(null)
  const autoOpenedRef=useRef(false)
  const rsTableDrag=useDragScroll()
  const idxTableDrag=useDragScroll()
  const secTableDrag=useDragScroll()
  const indTableDrag=useDragScroll()
  const emaBreadthTableDrag=useDragScroll()
  const [notifPermission,setNotifPermission]=useState(
    typeof Notification!=='undefined'?Notification.permission:'denied'
  )
  const lastAlertCheck = useRef(null)

  // Request notification permission on mount
  useEffect(()=>{
    if(typeof Notification!=='undefined' && Notification.permission==='default'){
      Notification.requestPermission().then(p=>setNotifPermission(p))
    }
  },[])

  // Poll for new squeeze/VCP and HY/HT fires every minute — both write to
  // the same squeeze_alerts table on the backend.
  useEffect(()=>{
    if(!session) return
    const checkSqueezeAlerts = async()=>{
      try{
        const since = lastAlertCheck.current || new Date(Date.now()-90000).toISOString()
        const {data} = await supabase
          .from('squeeze_alerts')
          .select('*')
          .gte('fired_at', since)
          .order('fired_at', {ascending:false})
          .limit(10)

        lastAlertCheck.current = new Date().toISOString()

        if(data && data.length > 0){
          data.forEach(alert=>{
            // Browser notification
            if(typeof Notification!=='undefined' && Notification.permission==='granted'){
              const isVolAlert = /HY|HT/.test(alert.fire_type) && !/Squeeze|VCP/.test(alert.fire_type)
              const title = isVolAlert
                ? `🔊 ${alert.sym} — ${alert.fire_type} Volume!`
                : `🔥 ${alert.sym} — Squeeze Fired!`
              const n = new Notification(
                title,
                {
                  body: `${alert.fire_type} | RS: ${alert.rs_tv||alert.rs} | ${alert.chg_pct>=0?'+':''}${alert.chg_pct?.toFixed(2)}% | ${alert.sector}`,
                  icon: '/favicon.ico',
                  tag: `alert-${alert.sym}-${alert.fire_type}`,  // prevents duplicate for same stock+signal
                  requireInteraction: false,
                }
              )
              // Click notification → HY/HT alerts live in the RS tab
              // (they're columns there, not a separate tab); squeeze/VCP
              // still go to the Squeeze tab.
              n.onclick = ()=>{
                window.focus()
                setMainTab(isVolAlert ? 'rs' : 'squeeze')
              }
              // Auto-close after 8 seconds
              setTimeout(()=>n.close(), 8000)
            }
          })
        }
      }catch(e){
        console.warn('Squeeze alert check failed:', e.message)
      }
    }

    // Check immediately then every 60s
    checkSqueezeAlerts()
    const timer = setInterval(checkSqueezeAlerts, 60000)
    return ()=>clearInterval(timer)
  },[session])
  const [chartWide,setChartWide]=useState(0) // 0=normal 1=wide 2=extra-wide
  const [ppFilterRS,setPpFilterRS]=useState('all')
  const [ppFilter52WL,setPpFilter52WL]=useState('all')
  const [ppFilterWeak,setPpFilterWeak]=useState('all')

  // Shared market cap check, used everywhere a stock list gets filtered
  // (RS Scanner's rsBase above, and the Breakout tab's sections below) so
  // the filter is consistent across tabs, not just the main scanner.
  const passesMcap = s => (mcapMin===''||(s.marketCap??-1)>=+mcapMin) && (mcapMax===''||(s.marketCap??Infinity)<=+mcapMax)
  // Used by the multi-select Signal filter (OR logic — a stock matches
  // if it satisfies ANY of the selected signals).
  const matchesSignal = (s,sig) => {
    if(sig==='pp') return topVolumeSignal(s)==='pp'
    if(sig==='hy') return topVolumeSignal(s)==='hy'
    if(sig==='ht') return topVolumeSignal(s)==='ht'
    if(sig==='ema9') return !!s.nearEMA9?.isNearEMA9
    if(sig==='ema21') return !!s.nearEMA21?.isNearEMA21
    if(sig==='ema50') return !!s.nearEMA50?.isNearEMA50
    if(sig==='power') return topVolumeSignal(s)==='pp' && s.rs>=80
    if(sig==='ibv') return topVolumeSignal(s)==='ibv'
    if(sig==='r1breakout') return !!s.isResistanceBreakout
    if(sig==='cupbreakout') return !!s.isCupHandleBreakout
    if(sig==='guppy') return !!s.isGuppyBullishCrossover
    if(sig==='vcp2t') return !!s.isVCP && s.vcpStage===2
    if(sig==='vcp3t') return !!s.isVCP && s.vcpStage===3
    if(sig==='vcp4t') return !!s.isVCP && s.vcpStage===4
    if(sig==='ppconsec2') return hasConsecutivePP(s.pp?.ppHistory, 2)
    if(sig==='ppgt2') return (s.pp?.ppCount10d||0) > 2
    return false
  }
  const [sortBy,setSortBy]=useState('rs')
  const [sortDir,setSortDir]=useState('desc')
  const handleSort = useCallback(key=>{
    setSortBy(prev=>{
      if(prev===key){ setSortDir(d=>d==='desc'?'asc':'desc'); return prev }
      setSortDir('desc')
      return key
    })
  },[])
  const [showFilters,setShowFilters]=useState(false)
  const [wlSearch,setWlSearch]=useState(''),[wlSigOnly,setWlSigOnly]=useState(false)
  const [weakSearch,setWeakSearch]=useState(''),[weakSigOnly,setWeakSigOnly]=useState(false)

  // ── DB-powered scan (reads from Supabase, pre-computed by live server) ──
  const [indexData,setIndexData]=useState([])
  const [expandedIndex,setExpandedIndex]=useState(null)
  const [idxSort,setIdxSort]=useState({key:'rsTv',dir:-1})
  const [secSort,setSecSort]=useState({key:'avgRS',dir:-1})
  const [breadthData,setBreadthData]=useState(null)
  const [alertsLog,setAlertsLog]=useState(null)
  const [loadingAlerts,setLoadingAlerts]=useState(false)
  const [rotationData,setRotationData]=useState(null)
  const [loadingRotation,setLoadingRotation]=useState(false)
  const [rotationWindow,setRotationWindow]=useState(10) // trading days
  const [rotationScope,setRotationScope]=useState('sector') // 'sector' | 'index' | 'watchlist'
  const [rotationWlId,setRotationWlId]=useState(null)
  // Which sectors/indices/stocks are focused on in the Rotation chart.
  // Empty set = show everyone (unfiltered, the original behavior).
  // Non-empty = show ONLY the selected ones — lets the chart zoom in on
  // just a handful, like a real RRG chart does, instead of always
  // plotting all ~20 sectors at once regardless of how cluttered that is.
  const [rotationSelectedIds,setRotationSelectedIds]=useState(()=>new Set())
  const [portfolioHoldings,setPortfolioHoldings]=useState(()=>{
    try{return JSON.parse(localStorage.getItem('lm_portfolio')||'[]')}catch{return []}
  })
  const [journalOpenSym,setJournalOpenSym]=useState(null)
  const [compareSyms,setCompareSyms]=useState([])
  const [compareInput,setCompareInput]=useState('')
  const [historyDate,setHistoryDate]=useState(null) // null = live today, else 'YYYY-MM-DD'
  const [availableDates,setAvailableDates]=useState([])

  useEffect(()=>{
    fetchAvailableHistoryDates().then(setAvailableDates)
  },[])

  const runDBScan=useCallback(async()=>{
    setLoading(true);setProgress(0);setProgressMsg(historyDate?`Loading ${historyDate}…`:'Loading from database…')
    try{
      const activeWlObj=watchlists.find(w=>w.id===activeWl)
      const syms=activeWlObj?.stocks||null
      const [dbStocks,dbSectors,meta]=await Promise.all([
        fetchStocksFromDB({indexFilter,watchlistSyms:syms,historyDate}),
        fetchSectorsFromDB(historyDate),
        historyDate?Promise.resolve(null):fetchScanMeta(),
      ])
      setStocks(dbStocks)
      setSectorData(dbSectors)
      setScanMeta(meta)
      setLastRefresh(Date.now())
      setProgress(100);setProgressMsg('Done!')
    }catch(e){
      setProgressMsg('DB error: '+e.message)
      console.error(e)
    }
    setLoading(false)
  },[indexFilter,activeWl,watchlists,historyDate])

  const fetchStock=async(sym,tok)=>{
    const to=new Date().toISOString().split('T')[0]
    const from=new Date(Date.now()-400*864e5).toISOString().split('T')[0]
    const key=encodeURIComponent(`NSE_EQ|${sym}`)
    const res=await fetch(`https://api.upstox.com/v2/historical-candle/${key}/day/${to}/${from}`,
      {headers:{Authorization:`Bearer ${tok}`,Accept:'application/json'}})
    if(!res.ok)throw new Error(`${sym} ${res.status}`)
    const data=await res.json()
    const c=(data?.data?.candles||[]).reverse()
    return{prices:c.map(x=>x[4]),volumes:c.map(x=>x[5])}
  }

  const runScan=useCallback(async(useDemo=false)=>{
    const tok=session?.token||OWNER_TOKEN
    setLoading(true);setProgress(0)
    let raw=[]
    if(useDemo||(!tok&&!OWNER_TOKEN)){
      setProgressMsg('Loading demo data…');raw=DEMO;setProgress(50)
    }else{
      // Determine stock list: watchlist or index
      let list
      if(activeWl){
        const wl=watchlists.find(w=>w.id===activeWl)
        list=wl?.stocks||[]
      }else{
        const lists={nifty50:NIFTY50,midcap:MIDCAP,smallcap:SMALLCAP,
          all:[...new Set([...NIFTY50,...MIDCAP,...SMALLCAP])]}
        list=lists[indexFilter]||lists.all
      }
      const BATCH=5
      for(let i=0;i<list.length;i+=BATCH){
        const batch=list.slice(i,i+BATCH)
        setProgressMsg(`Fetching ${i+1}–${Math.min(i+BATCH,list.length)} of ${list.length}…`)
        await Promise.all(batch.map(async sym=>{
          try{const d=await fetchStock(sym,tok);raw.push({sym,...d})}catch{}
        }))
        setProgress(Math.round(((i+BATCH)/list.length)*60))
        await new Promise(r=>setTimeout(r,300))
      }
    }
    if(raw.length===0){setLoading(false);setProgress(0);setProgressMsg('');return}
    setProgressMsg('Computing RS + PP signals…')
    const todayRaws=raw.map(s=>({sym:s.sym,raw:calcRSRaw(s.prices,s.prices.length-1)})).filter(s=>s.raw!==null)
    const todayVals=todayRaws.map(s=>s.raw)
    const histMap=buildRSHistory(raw,15);setProgress(80)
    const processed=raw.map(s=>{
      const tRS=todayRaws.find(t=>t.sym===s.sym)
      const rs=tRS?percentileRank(todayVals,tRS.raw):0
      const n=s.prices.length,last=s.prices[n-1],prev=s.prices[n-2]||last
      return{
        sym:s.sym,rs,last,chg:((last-prev)/prev)*100,
        pctFromHigh:((last-Math.max(...s.prices.slice(-252)))/Math.max(...s.prices.slice(-252)))*100,
        pp:detectPP(s.prices,s.volumes),hist:histMap[s.sym]||[],
        rsTrend:rsSlope(histMap[s.sym]||[]),
        hy:calcHY(s.volumes),ht:calcHT(s.volumes),
        nearEMA9:calcNearEMA9(s.prices,rs),
        scanner52wl:detect52WLCrossover(s.prices,s.volumes),
        weakRS:detectWeakRSBigMove(s.prices,s.volumes,rs,weakThreshold),
        sector:getSector(s.sym),
      }
    }).sort((a,b)=>b.rs-a.rs)
    // Note: sectorData is intentionally NOT set here. This client-side
    // recomputation doesn't have rank_change/advances_d/w/m (those are
    // backend-persisted history, not derivable from a one-off live scan),
    // so setting it here would overwrite the richer data runDBScan loads
    // from Supabase — which is exactly why the Sectors table's rank and
    // week-over-week movement badges looked frozen/wrong after a manual
    // Scan. sectorData stays sourced solely from fetchSectorsFromDB.
    setProgress(100);setProgressMsg('Done!')
    setStocks(processed);setLastRefresh(Date.now());setLoading(false)
  },[session,indexFilter,weakThreshold,activeWl,watchlists])

  // Demo mode: auto-run the sample-data scan once, right when demoMode
  // flips on, and land on the RS tab (the only place demo data is
  // actually meaningful to look at) rather than wherever mainTab
  // happened to default to.
  useEffect(()=>{
    if(demoMode&&stocks.length===0){
      setMainTab('rs')
      runScan(true)
    }
  },[demoMode])

  // Auto-refresh from DB every 1 minute — disabled while viewing a past
  // date, and disabled in demo mode (a real runDBScan() would silently
  // replace the curated sample dataset with a live scan, breaking the
  // 'sample data — not live' promise the demo banner makes).
  useEffect(()=>{
    clearInterval(refreshTimer.current)
    if(autoRefresh&&!historyDate&&!demoMode){
      refreshTimer.current=setInterval(()=>runDBScan(),refreshInterval)
    }
    return()=>clearInterval(refreshTimer.current)
  },[autoRefresh,refreshInterval,runDBScan,historyDate,demoMode])

  // Auto-open the #1 RS-ranked stock's chart the first time stocks load,
  // so the app doesn't start on an empty panel. Only fires once per
  // session (autoOpenedRef) — later refreshes shouldn't yank the chart
  // open again if the person already closed it or picked a different stock.
  useEffect(()=>{
    if(!autoOpenedRef.current && stocks.length>0 && !chartSym){
      autoOpenedRef.current = true
      const top = [...stocks].sort((a,b)=>(b.rsTv??b.rs??0)-(a.rsTv??a.rs??0))[0]
      if(top) setChartSym(top.sym)
    }
  },[stocks,chartSym])

  // Load from DB on mount, and whenever the selected history date changes
  useEffect(()=>{
    if(session)runDBScan()
  },[session,historyDate])

  // Load index dashboard and breadth data on tab switch. The Indices tab
  // also auto-refreshes every 60s while active — the backend writes live
  // index prices every scan, but without polling here the UI showed one
  // stale snapshot from whenever the tab was opened.
  useEffect(()=>{
    if(!session) return
    let timer = null
    if(mainTab==='indices'){
      const load = () => fetchIndexDashboard().then(setIndexData).catch(e=>console.error('Index fetch:',e))
      load()
      timer = setInterval(load, 60000)
    }
    if(mainTab==='breadth'){
      // Fetch market breadth from Supabase
      supabase.from('market_breadth').select('*').order('scan_date',{ascending:false}).limit(30)
        .then(({data})=>setBreadthData(data||[]))
        .catch(e=>console.error('Breadth fetch:',e))
    }
    if(mainTab==='alerts'){
      setLoadingAlerts(true)
      fetchRecentAlerts(150)
        .then(setAlertsLog)
        .catch(e=>console.error('Alerts fetch:',e))
        .finally(()=>setLoadingAlerts(false))
    }
    if(mainTab==='rotation'){
      setLoadingRotation(true)
      const effectiveWlId = rotationWlId ?? activeWl ?? watchlists[0]?.id ?? null
      const loader = rotationScope==='index'
        ? fetchIndexRotation(rotationWindow)
        : rotationScope==='watchlist'
          ? fetchWatchlistRotation((watchlists.find(w=>w.id===effectiveWlId)?.stocks)||[], rotationWindow)
          : fetchSectorRotation(rotationWindow)
      loader
        .then(setRotationData)
        .catch(e=>console.error('Sector rotation fetch:',e))
        .finally(()=>setLoadingRotation(false))
    }
    return ()=>{ if(timer) clearInterval(timer) }
  },[session,mainTab,rotationWindow,rotationScope,rotationWlId,watchlists,activeWl])

  // Save portfolio to localStorage whenever it changes
  useEffect(()=>{
    localStorage.setItem('lm_portfolio', JSON.stringify(portfolioHoldings))
  },[portfolioHoldings])

  // Filter helpers
  const applyPP=(list,f)=>f==='yes'?list.filter(s=>s.pp?.isPP):f==='no'?list.filter(s=>!s.pp?.isPP):list

  const rsBase=useMemo(()=>stocks.filter(s=>{
    if(!s.sym.toLowerCase().includes(search.toLowerCase()))return false
    if(s.rs<rsMin||s.rs>rsMax)return false
    if(mcapMin!==''&&(s.marketCap==null||s.marketCap<+mcapMin))return false
    if(mcapMax!==''&&(s.marketCap==null||s.marketCap>+mcapMax))return false
    if(rsImprFilter!=='all'&&s.rsTrend?.trend!==rsImprFilter)return false
    if(sigFilters.length>0&&!sigFilters.some(sig=>matchesSignal(s,sig)))return false
    if(stageFilter!=='all'&&calcWeinsteinStage(s).stage!==+stageFilter)return false
    if(sectorFilter!=='all'&&s.sector!==sectorFilter)return false
    // Preset filter
    if(presetFilter==='pp'&&!s.pp?.isPP)return false
    if(presetFilter==='ema9'&&!s.nearEMA9?.isNearEMA9)return false
    if(presetFilter==='hy'&&!s.hy?.isHY)return false
    if(presetFilter==='ht'&&!s.ht?.isHT)return false
    if(presetFilter==='rs90'&&(s.rsTv??s.rs)<90)return false
    if(presetFilter==='rs80'&&(s.rsTv??s.rs)<80)return false
    if(presetFilter==='impr'&&s.rsTrend?.trend!=='improving')return false
    if(presetFilter==='power'&&!(s.pp?.isPP&&s.rs>=80))return false
    if(presetFilter==='s2'&&calcWeinsteinStage(s).stage!==2)return false
    if(presetFilter==='s1'&&calcWeinsteinStage(s).stage!==1)return false
    if(presetFilter==='s3'&&calcWeinsteinStage(s).stage!==3)return false
    if(presetFilter==='s4'&&calcWeinsteinStage(s).stage!==4)return false
    if(presetFilter==='surge'&&(s.hy?.pctOfMax||0)<95)return false
    if(presetFilter==='ibv'&&!calcIBV(s).isIBV)return false
    if(presetFilter==='breakout'&&!calcHYHTBreakout(s).isBreakout)return false
    return true
  }).sort((a,b)=>{
    const dir = sortDir==='asc'?1:-1
    const getVal = (s,key)=>{
      if(key==='rs') return s.rs??-1
      if(key==='rsTv') return s.rsTv??-1
      if(key==='rsMidcap') return s.rsMidcap??-1
      if(key==='rsSmallcap') return s.rsSmallcap??-1
      if(key==='rsMicrocap') return s.rsMicrocap??-1
      if(key==='rsSector') return s.rsSector??-1
      if(key==='slope') return s.rsTrend?.slope??0
      if(key==='pp10') return s.pp?.ppCount10d??0
      if(key==='chg') return s.chg??0
      if(key==='last') return s.last??0
      if(key==='sym') return s.sym
      return 0
    }
    const av=getVal(a,sortBy), bv=getVal(b,sortBy)
    if(sortBy==='sym') return dir===1?av.localeCompare(bv):bv.localeCompare(av)
    // nulls always sort to bottom regardless of direction
    if(av===-1&&bv!==-1) return 1
    if(bv===-1&&av!==-1) return -1
    return dir===1?(av-bv):(bv-av)
  }),[stocks,search,rsMin,rsMax,mcapMin,mcapMax,rsImprFilter,sigFilters,stageFilter,sectorFilter,presetFilter,sortBy,sortDir])
  const displayedRS=useMemo(()=>applyPP(rsBase,ppFilterRS),[rsBase,ppFilterRS])

  const wlBase=stocks.filter(s=>s.scanner52wl.near52wLow&&s.sym.toLowerCase().includes(wlSearch.toLowerCase())&&(!wlSigOnly||s.scanner52wl.isSignal)).sort((a,b)=>a.scanner52wl.pctFrom52wLow-b.scanner52wl.pctFrom52wLow)
  const displayed52WL=applyPP(wlBase,ppFilter52WL)

  const weakBase=stocks.filter(s=>s.weakRS.chg1d>=weakThreshold&&s.rs<50&&s.sym.toLowerCase().includes(weakSearch.toLowerCase())&&(!weakSigOnly||s.weakRS.isSignal)).sort((a,b)=>b.weakRS.chg1d-a.weakRS.chg1d)
  const displayedWeak=applyPP(weakBase,ppFilterWeak)

  const tabs=[['rs','📊','RS'],['indices','🗂','Indices'],['breadth','📈','Breadth'],['squeeze','🌀','Squeeze'],['breakout','💥','Breakout'],['52wl','🎯','52WL'],['weak','🚨','Weak'],['portfolio','💼','Portfolio'],['compare','⚖','Compare'],['watchlist','📋','Watchlist'],['settings','⚙','Account']]

  if(authLoading)return(
    <div style={{minHeight:'100vh',background:C.bg,display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div style={{width:32,height:32,border:`3px solid ${C.accent}`,borderTopColor:'transparent',borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>
    </div>
  )
  if(!session && !demoMode){
    if(!showAuth) return <LandingPage
      onEnroll={()=>{setAuthMode('register');setShowAuth(true)}}
      onSignIn={()=>{setAuthMode('login');setShowAuth(true)}}
      onDemo={()=>setDemoMode(true)}
    />
    return <AuthScreen onLogin={s=>setSession(s)} initialMode={authMode} onBack={()=>setShowAuth(false)}/>
  }

  // Active watchlist label
  const activeWlObj=watchlists.find(w=>w.id===activeWl)
  const scanLabel=activeWlObj?`📋 ${activeWlObj.name} (${activeWlObj.stocks.length})`:({all:'All',nifty50:'Nifty 50',midcap:'Midcap',smallcap:'Smallcap'}[indexFilter])

  return(
    <div style={{background:C.bg,minHeight:'100vh',fontFamily:"'Inter','SF Pro Display',sans-serif",
      color:C.text,fontSize:13,display:'flex',flexDirection:'row'}}>

      {/* ── WealthLab-style Icon sidebar ── */}
      {!isMobile&&(
        <div style={{width:52,minWidth:52,background:C.sidebar,
          borderRight:`1px solid ${C.divider}`,
          display:'flex',flexDirection:'column',alignItems:'center',
          position:'sticky',top:0,height:'100vh',zIndex:40}}>

          {/* Logo mark */}
          <div style={{width:'100%',height:52,display:'flex',alignItems:'center',
            justifyContent:'center',borderBottom:`1px solid ${C.divider}`,flexShrink:0}}>
            <div style={{width:28,height:28,background:'linear-gradient(135deg,#4f8ef7,#7c3aed)',
              borderRadius:6,display:'flex',alignItems:'center',justifyContent:'center',
              fontWeight:900,color:'#fff',fontSize:13,letterSpacing:'-0.5px'}}>L</div>
          </div>

          {/* Nav items — top group */}
          <div style={{flex:1,display:'flex',flexDirection:'column',
            alignItems:'center',width:'100%',paddingTop:8,gap:1}}>
            {[
              {id:'rs',       label:'RS Rating', abbr:'RS'},
              {id:'indices',  label:'Indices',   abbr:'IX'},
              {id:'rotation', label:'Sector Rotation', abbr:'RO'},
              {id:'breadth',  label:'Breadth',   abbr:'BR'},
              {id:'squeeze',  label:'Squeeze',   abbr:'SQ'},
              {id:'breakout', label:'Breakout',  abbr:'BO'},
              {id:'52wl',     label:'52WL',      abbr:'WL'},
              {id:'weak',     label:'Weak RS',   abbr:'WK'},
            ].map(({id,label,abbr})=>(
              <div key={id} onClick={()=>setMainTab(id)}
                title={label}
                style={{width:'100%',height:44,display:'flex',alignItems:'center',
                  justifyContent:'center',cursor:'pointer',position:'relative',
                  background:mainTab===id?C.active:'transparent',
                  transition:'background 0.1s'}}>
                {/* Active indicator — left edge bar like WealthLab */}
                {mainTab===id&&<div style={{position:'absolute',left:0,top:'20%',
                  width:3,height:'60%',background:C.accent,borderRadius:'0 2px 2px 0'}}/>}
                <span style={{fontSize:11,fontWeight:mainTab===id?700:500,
                  color:mainTab===id?C.accent:C.muted,
                  letterSpacing:'0.02em'}}>{abbr}</span>
              </div>
            ))}

            <div style={{width:28,height:1,background:C.divider,margin:'4px 0'}}/>

            {[
              {id:'portfolio', label:'Portfolio', abbr:'PF'},
              {id:'compare',   label:'Compare',   abbr:'CMP'},
              {id:'watchlist', label:'Watchlist', abbr:'WL'},
              {id:'alerts',    label:'Alerts',    abbr:'AL'},
            ].map(({id,label,abbr})=>(
              <div key={id} onClick={()=>setMainTab(id)}
                title={label}
                style={{width:'100%',height:44,display:'flex',alignItems:'center',
                  justifyContent:'center',cursor:'pointer',position:'relative',
                  background:mainTab===id?C.active:'transparent',
                  transition:'background 0.1s'}}>
                {mainTab===id&&<div style={{position:'absolute',left:0,top:'20%',
                  width:3,height:'60%',background:C.accent,borderRadius:'0 2px 2px 0'}}/>}
                <span style={{fontSize:11,fontWeight:mainTab===id?700:500,
                  color:mainTab===id?C.accent:C.muted,letterSpacing:'0.02em'}}>{abbr}</span>
              </div>
            ))}
          </div>

          {/* Bottom: market status + account */}
          <div style={{width:'100%',borderTop:`1px solid ${C.divider}`,paddingBottom:4}}>
            <div title={isMarketOpen()?'Market Open — Live':'Market Closed'}
              style={{width:'100%',height:36,display:'flex',alignItems:'center',
                justifyContent:'center',gap:4}}>
              <div style={{width:6,height:6,borderRadius:'50%',
                background:isMarketOpen()?C.green:'#374151',flexShrink:0}}/>
            </div>
            <div onClick={()=>setMainTab('settings')} title="Account"
              style={{width:'100%',height:44,display:'flex',alignItems:'center',
                justifyContent:'center',cursor:'pointer',position:'relative',
                background:mainTab==='settings'?C.active:'transparent'}}>
              {mainTab==='settings'&&<div style={{position:'absolute',left:0,top:'20%',
                width:3,height:'60%',background:C.accent,borderRadius:'0 2px 2px 0'}}/>}
              <span style={{fontSize:11,color:mainTab==='settings'?C.accent:C.muted}}>AC</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Main area ── */}
      <div style={{flex:1,display:'flex',flexDirection:'column',minWidth:0,paddingBottom:isMobile?72:0}}>

        {/* Top bar */}
        <div style={{borderBottom:`1px solid ${C.divider}`,
          padding:'0 16px',height:52,
          display:'flex',alignItems:'center',justifyContent:'space-between',
          background:C.card,position:'sticky',top:0,zIndex:30,gap:10}}>

          {/* Mobile menu + page title */}
          <div style={{display:'flex',alignItems:'center',gap:8,minWidth:0}}>
            {isMobile&&(
              <div style={{width:28,height:28,background:C.accent,borderRadius:7,display:'flex',
                alignItems:'center',justifyContent:'center',fontWeight:900,color:'#000',fontSize:13,flexShrink:0}}>L</div>
            )}
            <div style={{minWidth:0}}>
              <div style={{fontWeight:600,fontSize:14,color:C.text,lineHeight:1}}>
                {mainTab==='rs'?'RS Rating':mainTab==='indices'?'Indices':mainTab==='squeeze'?'Squeeze':
                 mainTab==='breakout'?'Breakout':mainTab==='52wl'?'52WL Crossover':
                 mainTab==='weak'?'Weak RS':mainTab==='alerts'?'Alerts':mainTab==='rotation'?'Sector Rotation':
                 mainTab==='watchlist'?'Watchlist':'Account'}
              </div>
              {!isMobile&&<div style={{fontSize:10,color:C.muted,marginTop:1}}>
                {demoMode?'Sample data — not live':`${session?.user?.email} · ${scanLabel}`}
              </div>}
            </div>
            {demoMode&&(
              <div style={{display:'flex',alignItems:'center',gap:6,marginLeft:6}}>
                <span style={{fontSize:10,fontWeight:700,padding:'3px 8px',borderRadius:20,
                  background:C.yellow+'22',color:C.yellow,border:`1px solid ${C.yellow}44`,whiteSpace:'nowrap'}}>
                  👁 DEMO
                </span>
                <button onClick={()=>{setDemoMode(false);setStocks([]);setAuthMode('register');setShowAuth(true)}}
                  style={{fontSize:10,fontWeight:700,padding:'3px 9px',borderRadius:20,cursor:'pointer',
                    background:C.accent,color:'#000',border:'none',whiteSpace:'nowrap'}}>
                  Sign Up
                </button>
              </div>
            )}
          </div>

          {/* Controls */}
          {mainTab!=='settings'&&mainTab!=='watchlist'&&mainTab!=='alerts'&&mainTab!=='rotation'&&(
            <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap',justifyContent:'flex-end'}}>

              {/* Watchlist OR index selector */}
              {!isMobile&&(activeWl?(
                <button onClick={()=>setActiveWl(null)}
                  style={{padding:'5px 10px',borderRadius:6,border:`1px solid ${C.accent}44`,
                    background:C.accent+'22',color:C.accent,fontSize:11,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap'}}>
                  📋 {activeWlObj?.name} ×
                </button>
              ):(
                <select value={indexFilter} onChange={e=>setIndexFilter(e.target.value)}
                  style={{padding:'5px 8px',background:C.card,border:`1px solid ${C.border}`,
                    borderRadius:6,color:C.text,fontSize:11,outline:'none',cursor:'pointer'}}>
                  <option value="all">All stocks</option>
                  <option value="nifty50">Nifty 50</option>
                  <option value="midcap">Midcap 150</option>
                  <option value="smallcap">Smallcap 250</option>
                  <option value="microcap">Microcap 250</option>
                </select>
              ))}

              {/* History date picker */}
              {!isMobile&&(
                <HistoryCalendarPicker historyDate={historyDate} setHistoryDate={setHistoryDate}
                  availableDates={availableDates} isMobile={false}/>
              )}

              {/* Auto refresh toggle */}
              {lastRefresh&&!isMobile&&(
                <button onClick={()=>setAutoRefresh(v=>!v)}
                  style={{padding:'5px 10px',borderRadius:6,
                    border:`1px solid ${autoRefresh?C.green:C.border}`,
                    background:autoRefresh?C.green+'22':'transparent',
                    color:autoRefresh?C.green:C.muted,fontSize:11,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap'}}>
                  {autoRefresh?'⏸ Auto':'▶ Auto'}
                </button>
              )}

              {/* Export to TradingView */}
              {displayedRS&&displayedRS.length>0&&mainTab==='rs'&&(
                <TVCopyPanel stocks={displayedRS} label={null} compact/>
              )}

              {/* Notification permission toggle */}
              {typeof Notification!=='undefined'&&notifPermission!=='granted'&&(
                <button onClick={()=>Notification.requestPermission().then(p=>setNotifPermission(p))}
                  title="Enable squeeze fire alerts"
                  style={{padding:'5px 10px',borderRadius:6,
                    border:`1px solid ${C.yellow}44`,background:C.yellow+'11',
                    color:C.yellow,fontSize:10,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap'}}>
                  🔔 Enable Alerts
                </button>
              )}
              {notifPermission==='granted'&&(
                <span title="Squeeze fire alerts active"
                  style={{fontSize:10,color:C.green,padding:'5px 8px',
                    border:`1px solid ${C.green}33`,borderRadius:6,whiteSpace:'nowrap'}}>
                  🔔 Alerts ON
                </span>
              )}

              {/* Scan button */}
              <button onClick={()=>demoMode?runScan(true):runDBScan()} disabled={loading}
                style={{padding:'6px 14px',borderRadius:6,border:'none',cursor:'pointer',
                  background:loading?C.border:C.accent,color:loading?C.muted:'#000',
                  fontWeight:700,fontSize:12,whiteSpace:'nowrap'}}>
                {loading?`${progress}%…`:'🚀 Scan'}
              </button>

              {/* Demo */}
              {!isMobile&&(
                <button onClick={()=>runScan(true)} disabled={loading}
                  style={{padding:'6px 10px',borderRadius:6,border:`1px solid ${C.border}`,
                    background:'transparent',color:C.muted,fontWeight:600,fontSize:11,cursor:'pointer'}}>
                  👁 Demo
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── Page content ── */}
        <div style={{padding:isMobile?'10px':'12px 16px',flex:1,overflowY:'auto'}}>

        {/* History mode banner — unmistakable when not viewing live data */}
        {historyDate&&(
          <div style={{background:C.purple+'18',border:`1px solid ${C.purple}55`,borderRadius:10,
            padding:'10px 14px',marginBottom:14,display:'flex',alignItems:'center',
            justifyContent:'space-between',flexWrap:'wrap',gap:8}}>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <span style={{fontSize:16}}>📅</span>
              <span style={{fontWeight:700,color:C.purple,fontSize:13}}>
                Viewing history — {new Date(historyDate).toLocaleDateString('en-IN',{weekday:'long',day:'2-digit',month:'long',year:'numeric'})}
              </span>
              <span style={{fontSize:11,color:C.muted}}>(not live, all scanners frozen as of this day's close)</span>
            </div>
            <button onClick={()=>setHistoryDate(null)}
              style={{padding:'5px 12px',borderRadius:6,border:`1px solid ${C.purple}66`,
                background:'transparent',color:C.purple,fontSize:11,fontWeight:700,cursor:'pointer'}}>
              ← Back to Live
            </button>
          </div>
        )}

        {/* ══ WATCHLIST TAB ══ */}
        {mainTab==='watchlist'&&(
          <div>
            <div style={{marginBottom:16}}>
              <div style={{fontWeight:800,fontSize:16,marginBottom:4}}>📋 Watchlists</div>
              <div style={{fontSize:12,color:C.muted}}>
                Create custom lists, add stocks manually or upload a CSV, then run the scanner on them.
              </div>
            </div>
            <WatchlistManager watchlists={watchlists} activeWl={activeWl} setActiveWl={id=>{setActiveWl(id);setMainTab('rs')}}
              onSave={saveWL} onDelete={deleteWL}
              allKnownStocks={stocks.length>0
                ? stocks.map(s=>({sym:s.sym,sector:s.sector}))
                : [...new Set([...NIFTY50,...MIDCAP,...SMALLCAP])].map(sym=>({sym,sector:null}))}/>
          </div>
        )}

        {/* ══ RS SCANNER ══ */}
        {mainTab==='rs'&&(
          <div style={{display:'flex',gap:0,height:'calc(100vh - 52px)',overflow:'hidden'}}>

          {/* Left pane — stock list */}
          <div style={{flex:1,overflowY:'auto',minWidth:0,
            transition:'padding-right 0.2s, border 0.2s',
            // The chart panel is position:fixed (an overlay, not a flex
            // sibling) so it doesn't naturally shrink this pane's layout
            // at all — it just visually covers whatever's underneath it.
            // Reserving matching right-padding here means the table's
            // own overflowX:'auto' (below) correctly detects less
            // available space and lets you scroll to the columns that
            // would otherwise just be hidden behind the chart with no
            // way to reach them.
            paddingRight:(!isMobile&&chartSym)?(['50%','70%','92%'][chartWide]||'50%'):0,
            borderRight:chartSym?`1px solid ${C.divider}`:'none'}}>
            <LastUpdatedBar
              scanMeta={scanMeta} lastRefresh={lastRefresh} loading={loading}
              autoRefresh={autoRefresh} setAutoRefresh={setAutoRefresh}
              refreshInterval={refreshInterval} setRefreshInterval={setRefreshInterval}
              onRefresh={runDBScan}
            />
            {isMobile&&(
              <div style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap'}}>
                {activeWl?(
                  <button onClick={()=>setActiveWl(null)}
                    style={{padding:'8px 12px',borderRadius:8,border:`1px solid ${C.accent}44`,
                      background:C.accent+'22',color:C.accent,fontSize:12,fontWeight:600,cursor:'pointer'}}>
                    📋 {activeWlObj?.name} ×
                  </button>
                ):(
                  <select value={indexFilter} onChange={e=>setIndexFilter(e.target.value)}
                    style={{padding:'8px',background:C.card,border:`1px solid ${C.border}`,borderRadius:8,color:C.text,fontSize:12,outline:'none'}}>
                    <option value="all">🌐 All</option>
                    <option value="nifty50">⭐ Nifty50</option>
                    <option value="midcap">📊 Midcap</option>
                    <option value="smallcap">📈 Smallcap</option>
                    <option value="microcap">🔬 Microcap</option>
                  </select>
                )}
                <HistoryCalendarPicker historyDate={historyDate} setHistoryDate={setHistoryDate}
                  availableDates={availableDates} isMobile={true}/>
                <button onClick={()=>demoMode?runScan(true):runDBScan()} disabled={loading}
                  style={{flex:1,padding:'12px',borderRadius:8,border:'none',cursor:'pointer',
                    background:loading?C.border:C.accent,color:loading?C.muted:'#000',fontWeight:700,fontSize:13}}>
                  {loading?`${progress}%…`:'🚀 Scan'}
                </button>
                <button onClick={()=>runScan(true)} disabled={loading}
                  style={{padding:'12px 14px',borderRadius:8,border:`1px solid ${C.border}`,
                    background:'transparent',color:C.muted,fontWeight:600,fontSize:12,cursor:'pointer'}}>👁</button>
              </div>
            )}

            {/* RS methodology legend — compact single line */}
            {stocks.length>0&&(
              <details style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,
                padding:'6px 12px',marginBottom:10,fontSize:11,color:C.muted}}>
                <summary style={{cursor:'pointer',fontWeight:600,color:C.text}}>ℹ️ How RS is calculated — two methods</summary>
                <div style={{marginTop:6,lineHeight:1.8}}>
                  <strong style={{color:C.teal}}>RS-TV</strong> = Lakshmi Mata / TradingView formula — benchmark-relative (stock return minus Nifty's return), normalized by this stock's own 252-day min/max. Matches your Pine Script exactly. &nbsp;·&nbsp;
                  <strong style={{color:C.text}}>MID/SML/SEC</strong> = IBD percentile rank vs that index pool — shown for ALL stocks regardless of index membership, so you can compare any stock against each universe. &nbsp;·&nbsp;
                  <span style={{color:C.border}}>—</span> = insufficient data
                </div>
              </details>
            )}

            {/* TV copy for full RS list */}
            {displayedRS.length>0&&<TVCopyPanel stocks={displayedRS} label={`RS Scanner — ${scanLabel}`}/>}

            {stocks.length>0&&<PPFilterBar ppFilter={ppFilterRS} setPpFilter={setPpFilterRS}
              ppCount={rsBase.filter(s=>s.pp.isPP).length} total={displayedRS.length}/>}

            {/* Summary chips */}
            {stocks.length>0&&(
              <div style={{display:'flex',gap:8,marginBottom:12,overflowX:'auto',paddingBottom:4}}>
                {[{label:'All',val:stocks.length,color:C.text,f:'all'},
                  {label:'🚀HT',val:stocks.filter(s=>topVolumeSignal(s)==='ht').length,color:C.orange,f:'ht'},
                  {label:'📊HY',val:stocks.filter(s=>topVolumeSignal(s)==='hy').length,color:C.pink,f:'hy'},
                  {label:'🏛️IBV',val:stocks.filter(s=>topVolumeSignal(s)==='ibv').length,color:C.blue,f:'ibv'},
                  {label:'🔥PP',val:stocks.filter(s=>topVolumeSignal(s)==='pp').length,color:C.green,f:'pp'},
                  {label:'⚡EMA9',val:stocks.filter(s=>s.nearEMA9.isNearEMA9).length,color:C.teal,f:'ema9'},
                  {label:'🎯R1',val:stocks.filter(s=>s.isResistanceBreakout).length,color:C.red,f:'r1breakout'},
                  {label:'↑↑Impr',val:stocks.filter(s=>s.rsTrend.trend==='improving').length,color:C.green,f:'__impr'},
                ].map(({label,val,color,f})=>(
                  <div key={label} onClick={()=>{
                    if(f==='__impr')setRsImprFilter(v=>v==='improving'?'all':'improving')
                    else if(f==='all')setSigFilters([])
                    else setSigFilters(prev=>prev.includes(f)?prev.filter(x=>x!==f):[...prev,f])
                  }} style={{flexShrink:0,padding:'8px 14px',borderRadius:20,cursor:'pointer',
                    background:C.card,border:`1px solid ${((f==='all'&&sigFilters.length===0)||sigFilters.includes(f)||(f==='__impr'&&rsImprFilter==='improving'))?color:C.border}`,textAlign:'center',minWidth:60}}>
                    <div style={{fontWeight:800,fontSize:17,color}}>{val}</div>
                    <div style={{fontSize:10,color:C.muted,marginTop:1}}>{label}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Filters */}
            {stocks.length>0&&(
              <div style={{marginBottom:12}}>
                <div style={{display:'flex',gap:8,marginBottom:8,flexWrap:'wrap'}}>
                  <input placeholder="Search…" value={search} onChange={e=>setSearch(e.target.value)}
                    style={{flex:1,minWidth:100,padding:'8px 12px',background:C.card,border:`1px solid ${C.border}`,borderRadius:8,color:C.text,fontSize:13,outline:'none'}}/>
                  <button onClick={()=>setShowFilters(v=>!v)}
                    style={{padding:'8px 14px',borderRadius:8,border:`1px solid ${showFilters?C.accent:C.border}`,
                      cursor:'pointer',fontSize:12,fontWeight:600,background:showFilters?C.accent+'22':'transparent',
                      color:showFilters?C.accent:C.muted,whiteSpace:'nowrap'}}>⚙ Filters</button>
                </div>
                {sectorFilter!=='all'&&(
                  <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:8}}>
                    <span style={{fontSize:11,color:C.muted}}>Filtering by sector:</span>
                    <span style={{display:'flex',alignItems:'center',gap:6,padding:'3px 10px',borderRadius:20,
                      background:C.accent+'22',border:`1px solid ${C.accent}`,color:C.accent,fontSize:11,fontWeight:700}}>
                      {sectorFilter}
                      <span onClick={()=>setSectorFilter('all')} style={{cursor:'pointer',fontSize:13,lineHeight:1}}>×</span>
                    </span>
                  </div>
                )}
                {showFilters&&(
                  <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:'14px'}}>
                    {/* My Scanners — save/load the current filter combination */}
                    <div style={{marginBottom:14,paddingBottom:14,borderBottom:`1px solid ${C.divider}`}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                        <div style={{fontSize:11,fontWeight:700,color:C.text}}>💾 My Scanners</div>
                        {session?.user?.id?(
                          <button onClick={()=>setShowSaveScannerInput(v=>!v)}
                            style={{fontSize:11,color:C.accent,background:'transparent',border:'none',cursor:'pointer',fontWeight:700}}>
                            + Save current filters
                          </button>
                        ):(
                          <span style={{fontSize:10,color:C.muted}}>Log in to save scanners</span>
                        )}
                      </div>
                      {showSaveScannerInput&&(
                        <div style={{display:'flex',gap:6,marginBottom:10}}>
                          <input type="text" placeholder="Scanner name…" value={scannerNameInput}
                            onChange={e=>setScannerNameInput(e.target.value)}
                            onKeyDown={e=>e.key==='Enter'&&handleSaveScanner()}
                            style={{flex:1,padding:'6px 10px',borderRadius:6,border:`1px solid ${C.border}`,
                              background:C.bg,color:C.text,fontSize:12}}/>
                          <button onClick={handleSaveScanner}
                            style={{padding:'6px 14px',borderRadius:6,border:'none',background:C.accent,
                              color:'#0a0a0f',fontSize:12,fontWeight:700,cursor:'pointer'}}>Save</button>
                        </div>
                      )}
                      {savedScanners.length>0&&(() => {
                        const describeScanner = (sc) => {
                          const f = sc.filters||{}
                          const parts = []
                          if(f.search) parts.push(`"${f.search}"`)
                          if((f.rsMin??0)!==0||(f.rsMax??99)!==99) parts.push(`RS ${f.rsMin??0}-${f.rsMax??99}`)
                          if(f.mcapMin!==''&&f.mcapMin!=null) parts.push(`Mcap ≥${f.mcapMin}Cr`)
                          if(f.mcapMax!==''&&f.mcapMax!=null) parts.push(`Mcap ≤${f.mcapMax}Cr`)
                          if(f.rsImprFilter&&f.rsImprFilter!=='all') parts.push(f.rsImprFilter)
                          if(Array.isArray(f.sigFilters)&&f.sigFilters.length) parts.push(f.sigFilters.map(x=>x.toUpperCase()).join('/'))
                          else if(f.sigFilter&&f.sigFilter!=='all') parts.push(f.sigFilter.toUpperCase())
                          if(f.stageFilter&&f.stageFilter!=='all') parts.push(`Stage ${f.stageFilter}`)
                          if(f.sectorFilter&&f.sectorFilter!=='all') parts.push(f.sectorFilter)
                          if(f.presetFilter&&f.presetFilter!=='all') parts.push(f.presetFilter)
                          return parts.length ? parts.join(' · ') : 'No filters (all stocks)'
                        }
                        return (
                          <div style={{display:'flex',gap:6,alignItems:'center'}}>
                            <select value={selectedScannerId} onChange={e=>{
                                setSelectedScannerId(e.target.value)
                                const sc = savedScanners.find(x=>String(x.id)===e.target.value)
                                if(sc) applyFilterState(sc.filters)
                              }}
                              style={{flex:1,padding:'8px 10px',borderRadius:6,border:`1px solid ${C.border}`,
                                background:C.bg,color:C.text,fontSize:12}}>
                              <option value="">Load a saved scanner…</option>
                              {savedScanners.map(sc=>(
                                <option key={sc.id} value={sc.id}>{sc.name} — {describeScanner(sc)}</option>
                              ))}
                            </select>
                            {selectedScannerId&&(
                              <button onClick={()=>{handleDeleteScanner(selectedScannerId);setSelectedScannerId('')}}
                                style={{padding:'8px 10px',borderRadius:6,border:`1px solid ${C.border}`,
                                  background:'transparent',color:C.muted,fontSize:12,cursor:'pointer'}}>✕</button>
                            )}
                          </div>
                        )
                      })()}
                    </div>
                    <div style={{marginBottom:14}}>
                      <div style={{fontSize:11,fontWeight:700,color:C.text,marginBottom:8}}>
                        RS Range: <span style={{color:C.accent,fontWeight:800}}>{rsMin}–{rsMax}</span>
                        <span style={{color:C.muted}}> ({stocks.filter(s=>s.rs>=rsMin&&s.rs<=rsMax).length})</span>
                      </div>
                      <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:10}}>
                        {[['All',0,99],['90+',90,99],['80+',80,99],['70–79',70,79],['50–69',50,69],['<50',0,49]].map(([l,mn,mx])=>(
                          <button key={l} onClick={()=>{setRsMin(mn);setRsMax(mx)}}
                            style={{padding:'5px 12px',borderRadius:20,border:`1px solid ${rsMin===mn&&rsMax===mx?C.accent:C.border}`,
                              cursor:'pointer',fontSize:12,fontWeight:600,
                              background:rsMin===mn&&rsMax===mx?C.accent+'22':'transparent',
                              color:rsMin===mn&&rsMax===mx?C.accent:C.muted}}>{l}</button>
                        ))}
                      </div>
                      <div style={{position:'relative',height:34}}>
                        <div style={{position:'absolute',top:14,left:0,right:0,height:5,background:C.border,borderRadius:99}}/>
                        <div style={{position:'absolute',top:14,left:`${rsMin}%`,width:`${rsMax-rsMin}%`,height:5,background:C.accent,borderRadius:99}}/>
                        <input type="range" min={0} max={99} value={rsMin} onChange={e=>{const v=+e.target.value;if(v<rsMax)setRsMin(v)}}
                          style={{position:'absolute',top:7,left:0,right:0,width:'100%',appearance:'none',background:'transparent',zIndex:2,margin:0,height:20,cursor:'pointer'}}/>
                        <input type="range" min={0} max={99} value={rsMax} onChange={e=>{const v=+e.target.value;if(v>rsMin)setRsMax(v)}}
                          style={{position:'absolute',top:7,left:0,right:0,width:'100%',appearance:'none',background:'transparent',zIndex:3,margin:0,height:20,cursor:'pointer'}}/>
                      </div>
                    </div>
                    <div style={{marginBottom:14}}>
                      <div style={{fontSize:11,fontWeight:700,color:C.text,marginBottom:8}}>
                        Market Cap (₹ Cr)
                        {(mcapMin!==''||mcapMax!=='')&&<span style={{color:C.muted}}> ({stocks.filter(s=>(mcapMin===''||((s.marketCap??-1)>=+mcapMin))&&(mcapMax===''||((s.marketCap??Infinity)<=+mcapMax))).length})</span>}
                      </div>
                      <div style={{display:'flex',gap:8,alignItems:'center'}}>
                        <input type="number" placeholder="Min" value={mcapMin} onChange={e=>setMcapMin(e.target.value)}
                          style={{flex:1,padding:'7px 10px',borderRadius:6,border:`1px solid ${C.border}`,
                            background:C.bg,color:C.text,fontSize:12}}/>
                        <span style={{color:C.muted,fontSize:11}}>to</span>
                        <input type="number" placeholder="Max" value={mcapMax} onChange={e=>setMcapMax(e.target.value)}
                          style={{flex:1,padding:'7px 10px',borderRadius:6,border:`1px solid ${C.border}`,
                            background:C.bg,color:C.text,fontSize:12}}/>
                        {(mcapMin!==''||mcapMax!=='')&&(
                          <button onClick={()=>{setMcapMin('');setMcapMax('')}}
                            style={{padding:'6px 10px',borderRadius:6,border:`1px solid ${C.border}`,
                              background:'transparent',color:C.muted,fontSize:11,cursor:'pointer'}}>✕</button>
                        )}
                      </div>
                      <div style={{fontSize:9,color:C.muted,marginTop:4}}>
                        Coverage may be incomplete for stocks where fundamentals haven't been fetched yet
                      </div>
                    </div>
                    <div style={{marginBottom:10}}>
                      <div style={{fontSize:11,fontWeight:700,color:C.text,marginBottom:8}}>RS Trend</div>
                      <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                        {[['all','All',C.muted],['improving','↑↑ Improving',C.green],['flat','→ Flat',C.muted],['declining','↓↓ Declining',C.red]].map(([v,label,color])=>(
                          <button key={v} onClick={()=>setRsImprFilter(v)}
                            style={{padding:'6px 13px',borderRadius:20,border:`1px solid ${rsImprFilter===v?color:C.border}`,
                              cursor:'pointer',fontSize:12,fontWeight:600,
                              background:rsImprFilter===v?color+'22':'transparent',color:rsImprFilter===v?color:C.muted}}>{label}</button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div style={{fontSize:11,fontWeight:700,color:C.text,marginBottom:8,display:'flex',alignItems:'center',gap:6}}>
                        Signal <span style={{color:C.muted,fontWeight:400}}>(tap multiple — matches any selected)</span>
                        <button onClick={()=>setShowSignalGlossary(v=>!v)}
                          style={{background:'transparent',border:`1px solid ${C.border}`,color:C.muted,
                            borderRadius:'50%',width:16,height:16,fontSize:10,cursor:'pointer',
                            display:'flex',alignItems:'center',justifyContent:'center',padding:0}}>
                          ℹ
                        </button>
                      </div>
                      {showSignalGlossary&&(
                        <div style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:8,
                          padding:'10px 12px',marginBottom:10,display:'flex',flexDirection:'column',gap:8}}>
                          {SIGNAL_GLOSSARY.map(([label,desc])=>(
                            <div key={label}>
                              <div style={{fontSize:11,fontWeight:700,color:C.text}}>{label}</div>
                              <div style={{fontSize:10.5,color:C.muted,marginTop:2,lineHeight:1.5}}>{desc}</div>
                            </div>
                          ))}
                        </div>
                      )}
                      <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                        <button onClick={()=>setSigFilters([])}
                          style={{padding:'6px 13px',borderRadius:20,border:`1px solid ${sigFilters.length===0?C.muted:C.border}`,
                            cursor:'pointer',fontSize:12,fontWeight:600,
                            background:sigFilters.length===0?C.muted+'22':'transparent',color:sigFilters.length===0?C.text:C.muted}}>All</button>
                        {[['ht','🚀HT',C.orange],['hy','📊HY',C.pink],['ibv','🏛️IBV',C.blue],['pp','🔥PP',C.green],['ppconsec2','🔥PP 2x Consecutive',C.green],['ppgt2','🔥PP >2 in 10d',C.green],['ema9','⚡EMA9',C.teal],['ema21','⚡EMA21',C.teal],['ema50','⚡EMA50',C.teal],['power','⭐Power',C.accent],['r1breakout','🎯R1 Breakout',C.red],['cupbreakout','☕Cup Breakout',C.yellow],['guppy','🐠Guppy Crossover',C.purple],['vcp2t','🌀VCP 2T',C.purple],['vcp3t','🌀VCP 3T',C.purple],['vcp4t','🌀VCP 4T',C.purple]].map(([v,label,color])=>{
                          const active = sigFilters.includes(v)
                          return (
                            <button key={v} onClick={()=>setSigFilters(prev=>active?prev.filter(x=>x!==v):[...prev,v])}
                              style={{padding:'6px 13px',borderRadius:20,border:`1px solid ${active?color:C.border}`,
                                cursor:'pointer',fontSize:12,fontWeight:600,
                                background:active?color+'22':'transparent',color:active?color:C.muted}}>{label}</button>
                          )
                        })}
                      </div>
                    </div>
                    <div style={{marginTop:10}}>
                      <div style={{fontSize:11,fontWeight:700,color:C.text,marginBottom:8}}>Stage</div>
                      <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                        {[['all','All',C.muted],['1','S1 Base',C.yellow],['2','S2 Up',C.green],['3','S3 Top',C.orange],['4','S4 Down',C.red]].map(([v,label,color])=>(
                          <button key={v} onClick={()=>setStageFilter(v)}
                            style={{padding:'6px 13px',borderRadius:20,border:`1px solid ${stageFilter===v?color:C.border}`,
                              cursor:'pointer',fontSize:12,fontWeight:600,
                              background:stageFilter===v?color+'22':'transparent',color:stageFilter===v?color:C.muted}}>{label}</button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {stocks.length===0&&!loading&&(
              <div style={{textAlign:'center',padding:'60px 0',color:C.muted}}>
                <div style={{fontSize:42,marginBottom:12}}>🔍</div>
                <div style={{fontSize:15,fontWeight:700,color:C.text,marginBottom:6}}>No data yet</div>
                <div style={{fontSize:12}}>Tap Scan or Demo above.</div>
              </div>
            )}
            {displayedRS.length>0&&(
              isMobile?displayedRS.map((s,i)=><StockCard key={s.sym} s={s} i={i} onChart={setChartSym}/>):(
                <>
                {chartSym&&(
                  <div style={{fontSize:10,color:C.accent,marginBottom:6,display:'flex',alignItems:'center',gap:6}}>
                    ↔ Table can scroll — drag left/right (or use the scrollbar below) to see all columns while the chart is open
                  </div>
                )}
                <div ref={rsTableDrag.ref} {...rsTableDrag.handlers}
                  style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,overflowX:'auto',...rsTableDrag.style}}>
                  <div style={{display:'grid',gridTemplateColumns:'32px 130px 52px 48px 48px 52px 52px 64px 90px 112px 182px 140px 55px 55px 48px 48px 48px 55px 32px 32px',
                    padding:'7px 14px',borderBottom:`1px solid ${C.border}`,gap:4,
                    fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em'}}>
                    <span style={{textAlign:'center',color:C.muted}}>#</span>
                    <SortableHeader label="Symbol" sortKey="sym" sortBy={sortBy} sortDir={sortDir} onSort={handleSort}/>
                    <SortableHeader label="RS-TV" sortKey="rsTv" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} align="center"/>
                    <div style={{textAlign:'center',cursor:'pointer'}} onClick={()=>handleSort('rsMidcap')}>
                      <div style={{fontSize:9,fontWeight:700,color:sortBy==='rsMidcap'?C.accent:C.muted}}>MID ↕</div>
                      <div style={{fontSize:7,color:C.blue,fontWeight:600}}>Midcap</div>
                    </div>
                    <div style={{textAlign:'center',cursor:'pointer'}} onClick={()=>handleSort('rsSmallcap')}>
                      <div style={{fontSize:9,fontWeight:700,color:sortBy==='rsSmallcap'?C.accent:C.muted}}>SML ↕</div>
                      <div style={{fontSize:7,color:C.yellow,fontWeight:600}}>Small</div>
                    </div>

                    <div style={{textAlign:'center',cursor:'pointer'}} onClick={()=>handleSort('rsSector')}>
                      <div style={{fontSize:9,fontWeight:700,color:sortBy==='rsSector'?C.accent:C.muted}}>SEC ↕</div>
                      <div style={{fontSize:7,color:C.orange,fontWeight:600}}>Sector</div>
                    </div>
                    <SortableHeader label="Trend" sortKey="slope" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} align="center"/>
                    <SortableHeader label="Price" sortKey="last" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} align="right"/>
                    <SortableHeader label="Chg%" sortKey="chg" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} align="center"/>
                    <SortableHeader label="PP 10d" sortKey="pp10" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} align="center"/>
                    <span style={{textAlign:'center',color:C.muted}}>RS Last 7d</span>
                    <span style={{textAlign:'center',color:C.muted}}>Stage/Vol</span>
                    <span style={{textAlign:'right',color:C.muted,fontSize:9}}>MCap</span>
                    <span style={{textAlign:'right',color:C.muted,fontSize:9}}>P/E</span>
                    <span style={{textAlign:'right',color:C.muted,fontSize:9}}>ROE</span>
                    <span style={{textAlign:'right',color:C.muted,fontSize:9}}>D/E</span>
                    <span style={{textAlign:'right',color:C.muted,fontSize:9}}>Prom%</span>
                    <span/>
                    <span style={{textAlign:'center',color:C.muted,fontSize:9}}>TV</span>
                    <span style={{textAlign:'center',color:C.muted,fontSize:9}}>Scr</span>
                  </div>
                  {displayedRS.map((s,i)=><DesktopRow key={s.sym} s={s} i={i} onChart={()=>setChartSym(s.sym)}/>)}
                </div>
                </>
              )
            )}
          </div>
        </div>
        )}


        {/* ══ INDICES DASHBOARD ══ */}
        {mainTab==='indices'&&(
          <div>
            <div style={{marginBottom:12}}>
              <div style={{fontWeight:800,fontSize:16,marginBottom:2}}>🗂 Index Performance Dashboard</div>
              <div style={{fontSize:11,color:C.muted}}>
                Daily · Weekly · Monthly · Quarterly · Yearly performance + RS-TV + Weinstein Stage for each index
              </div>
            </div>

            {indexData.length===0?(
              <div style={{textAlign:'center',padding:'60px 0',color:C.muted}}>
                <div style={{fontSize:36,marginBottom:10}}>🗂</div>
                <div style={{fontSize:14,fontWeight:700,color:C.text}}>No index data yet</div>
                <div style={{fontSize:12,marginTop:6}}>Data populates after the next scan cycle completes</div>
              </div>
            ):(
              <>
                {/* Summary strip */}
                {(()=>{
                  const tiles=[
                    {l:'Stage 2 (Up)',   v:indexData.filter(i=>i.stage===2).length, c:C.green,
                      why:"Indices actively in an uptrend — RS-TV 50+ with a rising trend. These are the sectors currently leading the market. Check here first when deciding where to focus stock-picking — a stock in a Stage 2 sector has the wind at its back, while the same stock in a Stage 4 sector is fighting the current. Tap any 'S2 Up' index below to drill into which stocks are driving that strength right now."},
                    {l:'Stage 1 (Base)', v:indexData.filter(i=>i.stage===1).length, c:C.yellow,
                      why:"Indices building a base — not yet trending either way, RS-TV below 50. These are potential future leaders still consolidating. Worth watching for an eventual breakout into Stage 2, but the momentum isn't there yet to justify aggressive buying — patience here, not urgency."},
                    {l:'Stage 3 (Top)',  v:indexData.filter(i=>i.stage===3).length, c:C.orange,
                      why:"Indices showing signs of topping — still strong (RS-TV 70+) but the trend is flattening or turning down. Be cautious about new buys here even though the RS number looks good — this is often where late-cycle money gets trapped. Better time to tighten stops on existing positions than add fresh ones."},
                    {l:'Stage 4 (Down)', v:indexData.filter(i=>i.stage===4).length, c:C.red,
                      why:"Indices in an active downtrend — weak RS-TV, falling trend. Avoid new long positions here regardless of how cheap individual stocks look — a falling sector tends to drag even good stocks down with it. Stay away or look elsewhere rather than bargain-hunt."},
                    {l:'RS-TV ≥ 70',     v:indexData.filter(i=>(i.rsTv||0)>=70).length,    c:C.accent,
                      why:"Indices outperforming the broader market right now. This is your shortlist for where money is actively rotating into. Cross-reference with the Stage tiles — an index that's both RS-TV≥70 and Stage 2 is the strongest combination, since momentum and trend agree."},
                    {l:'RS-TV < 40',     v:indexData.filter(i=>i.rsTv!=null&&i.rsTv<40).length, c:C.red,
                      why:"Indices lagging the broader market. Generally avoid for new positions, but worth watching for a potential turnaround if the RS Trend column starts improving — early positioning often happens here, before the crowd notices."},
                  ]
                  const expanded = tiles.find(t=>t.l===expandedTileInfo)
                  return <>
                    <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:8}}>
                      {tiles.map(({l,v,c})=>(
                        <div key={l} style={{background:C.card,border:`1px solid ${c}33`,
                          borderRadius:8,padding:'8px 14px',textAlign:'center',minWidth:80,position:'relative'}}>
                          <button onClick={()=>setExpandedTileInfo(expandedTileInfo===l?null:l)}
                            style={{position:'absolute',top:3,right:3,width:14,height:14,borderRadius:'50%',
                              border:`1px solid ${C.muted}`,background:'transparent',color:C.muted,
                              fontSize:9,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',padding:0,lineHeight:1}}>
                            i
                          </button>
                          <div style={{fontWeight:800,fontSize:20,color:c}}>{v}</div>
                          <div style={{fontSize:9,color:C.muted,marginTop:2}}>{l}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{marginBottom:14}}>
                      {expanded&&(
                        <div style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:8,
                          padding:'10px 12px',fontSize:11,color:C.muted,lineHeight:1.6}}>
                          <strong style={{color:C.text}}>{expanded.l} — how to use this:</strong> {expanded.why}
                        </div>
                      )}
                    </div>
                  </>
                })()}

                {/* Indices + Sectors side by side on desktop, stacked on
                    mobile. Each table scrolls horizontally independently.
                    All column headers are click-to-sort (click again to
                    flip direction). */}
                <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'1fr 1fr',gap:12,alignItems:'start'}}>
                <div>
                <div style={{fontWeight:800,fontSize:14,margin:'0 0 8px'}}>📊 Indices</div>
                <div ref={idxTableDrag.ref} {...idxTableDrag.handlers} style={{overflowX:'auto',overflowY:'auto',maxHeight:520,border:`1px solid ${C.border}`,borderRadius:12,...idxTableDrag.style}}>
                  <div style={{minWidth:820}}>
                    {/* Header row — click to sort */}
                    <div style={{display:'grid',
                      gridTemplateColumns:'150px 90px 60px 90px 70px 70px 70px 60px 60px',
                      gap:4,padding:'10px 12px',background:C.bg,
                      borderBottom:`1px solid ${C.border}`,position:'sticky',top:0}}>
                      {[['Index','name'],['Price','lastPrice'],['RS-TV','rsTv'],['Stage','stage'],
                        ['1D','chgD'],['1W','chgW'],['1M','chgM'],['3M','chgQ'],['1Y','chgY']].map(([h,key],hi)=>(
                        <div key={h} onClick={()=>setIdxSort(s=>({key,dir:s.key===key?-s.dir:-1}))}
                          title={IDX_COLUMN_TOOLTIPS[key]}
                          style={{fontSize:10,fontWeight:700,cursor:'pointer',userSelect:'none',
                            color:idxSort.key===key?C.accent:C.muted,textTransform:'uppercase',
                            ...(hi===0?{position:'sticky',left:0,background:C.bg,zIndex:2,paddingRight:8}:{})}}>
                          {h}{idxSort.key===key?(idxSort.dir===-1?' ↓':' ↑'):''}
                        </div>
                      ))}
                    </div>
                    {(()=>{
                      const maxAbs = f => Math.max(...indexData.map(x=>Math.abs(x[f]??0)), 0.01)
                      const colMax = {d:maxAbs('chgD'), w:maxAbs('chgW'), m:maxAbs('chgM'), q:maxAbs('chgQ'), y:maxAbs('chgY')}
                      const sortVal = x => idxSort.key==='name'?(x.name||''):(x[idxSort.key]??-Infinity)
                      const sorted = [...indexData].sort((a,b)=>{
                        const av=sortVal(a), bv=sortVal(b)
                        return (typeof av==='string' ? av.localeCompare(bv) : av-bv) * -idxSort.dir * -1
                      })
                      return sorted.map((idx,i)=>{
                      const stageColor={1:C.yellow,2:C.green,3:C.orange,4:C.red}[idx.stage]||C.muted
                      const rsc = idx.rsTv!=null?rsColor(idx.rsTv):C.muted
                      const cellStyle = {display:'flex',flexDirection:'column',justifyContent:'center'}
                      const isExpanded = expandedIndex===idx.name
                      return (
                      <div key={idx.name}>
                        <div onClick={()=>setExpandedIndex(isExpanded?null:idx.name)}
                          style={{display:'grid',
                          gridTemplateColumns:'150px 90px 60px 90px 70px 70px 70px 60px 60px',
                          gap:4,padding:'10px 12px',alignItems:'center',cursor:'pointer',
                          background:isExpanded?C.active:(i%2===0?'transparent':C.bg+'55'),
                          borderBottom:`1px solid ${C.border}33`}}>
                          <div style={{...cellStyle,position:'sticky',left:0,
                            background:isExpanded?C.active:(i%2===0?C.card:C.bg),zIndex:1,paddingRight:8}}>
                            <div style={{fontWeight:700,fontSize:12,color:C.text,display:'flex',alignItems:'center',gap:4}}>{idx.name} <span style={{fontSize:9,color:C.muted}}>{isExpanded?'▲':'▼'}</span></div>
                          </div>
                          <div style={cellStyle}>
                            <div style={{fontSize:11,color:C.muted}}>₹{idx.lastPrice?.toLocaleString('en-IN')}</div>
                          </div>
                          <div style={cellStyle}>
                            <div style={{fontWeight:800,fontSize:13,color:rsc}}>{idx.rsTv??'—'}</div>
                          </div>
                          <div style={cellStyle}>
                            <div style={{display:'inline-block',padding:'2px 6px',borderRadius:5,fontSize:9,fontWeight:700,
                              background:stageColor+'22',color:stageColor,width:'fit-content'}}>
                              {idx.stageLabel}
                            </div>
                          </div>
                          {[
                            [idx.chgD, idx.rankD, null, colMax.d],
                            [idx.chgW, idx.rankW, idx.rankWChange, colMax.w],
                            [idx.chgM, idx.rankM, null, colMax.m],
                          ].map(([val,rank,rankChange,cmax],j)=>(
                            <div key={j} style={cellStyle}>
                              <div style={{fontWeight:700,fontSize:11,color:val!=null?chgColor(val):C.muted}}>
                                {fmtChg(val)}
                              </div>
                              {val!=null&&(
                                <div style={{width:'100%',height:3,background:C.border+'55',borderRadius:2,marginTop:2,overflow:'hidden'}}>
                                  <div style={{width:`${Math.min(100,Math.abs(val)/cmax*100)}%`,height:'100%',
                                    background:val>=0?C.green:C.red,borderRadius:2}}/>
                                </div>
                              )}
                              {rank!=null&&idx.totalIndices&&(
                                <div style={{fontSize:8,fontWeight:700,
                                  color:rank<=3?C.green:rank>=idx.totalIndices-2?C.red:C.muted}}>
                                  #{rank}/{idx.totalIndices}
                                </div>
                              )}
                              {rankChange!=null&&rankChange!==0&&(
                                <div style={{fontSize:8,fontWeight:700,whiteSpace:'nowrap',
                                  color:rankChange>0?C.green:C.red}}>
                                  {rankChange>0?'▲':'▼'}{Math.abs(rankChange)} wk
                                </div>
                              )}
                            </div>
                          ))}
                          {[[idx.chgQ,colMax.q],[idx.chgY,colMax.y]].map(([val,cmax],j)=>(
                            <div key={j} style={cellStyle}>
                              <div style={{fontWeight:700,fontSize:11,color:val!=null?chgColor(val):C.muted}}>
                                {fmtChg(val)}
                              </div>
                              {val!=null&&(
                                <div style={{width:'100%',height:3,background:C.border+'55',borderRadius:2,marginTop:2,overflow:'hidden'}}>
                                  <div style={{width:`${Math.min(100,Math.abs(val)/cmax*100)}%`,height:'100%',
                                    background:val>=0?C.green:C.red,borderRadius:2}}/>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                        {isExpanded && (() => {
                          const constituents = getIndexConstituents(idx.name, stocks)
                          const rankStreak = idx.rankD<=3 && idx.rankW<=3 && idx.rankM<=3
                          return (
                            <div style={{padding:'12px 14px',background:C.bg,borderBottom:`1px solid ${C.border}`,position:'sticky',left:0,width:'calc(100vw - 60px)',maxWidth:900}}>
                              <div style={{display:'flex',justifyContent:'flex-end',marginBottom:constituents?8:0}}>
                                <button onClick={()=>setShowRowGuidance(v=>!v)}
                                  style={{width:18,height:18,borderRadius:'50%',border:`1px solid ${C.muted}`,
                                    background:showRowGuidance?C.accent+'22':'transparent',
                                    color:showRowGuidance?C.accent:C.muted,fontSize:10,cursor:'pointer',
                                    display:'flex',alignItems:'center',justifyContent:'center',padding:0}}>
                                  i
                                </button>
                              </div>
                              {showRowGuidance&&(
                                <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,
                                  padding:'10px 12px',marginBottom:12,fontSize:11,color:C.muted,lineHeight:1.6}}>
                                  <strong style={{color:C.text}}>How to read this:</strong> RS-TV above 70 with
                                  a rising Stage (2 or 3) means money is actively rotating into {idx.name} right
                                  now, not just a one-day blip. {rankStreak
                                    ? <span style={{color:C.green}}> This index is currently ranked in the top 3 across 1D, 1W, and 1M — sustained leadership, not a fluke spike.</span>
                                    : <span> Compare the 1D rank against 1W/1M — a strong single day with a weak longer trend usually means chasing a spike, not real leadership.</span>}{' '}
                                  Tap any stock below to open its chart and check if it's actually participating
                                  in the move, or just riding the index's headline number.
                                </div>
                              )}
                              {constituents===null ? (
                                <div style={{fontSize:11,color:C.muted,textAlign:'center',padding:10}}>
                                  Constituent list not available for {idx.name} yet — this index doesn't
                                  have a matching sector bucket in our data.
                                </div>
                              ) : (
                                <>
                                  <div style={{fontSize:11,fontWeight:700,color:C.muted,marginBottom:8,textTransform:'uppercase'}}>
                                    {idx.name} constituents ({constituents.length})
                                  </div>
                                  <SimpleStockTable stocks={constituents.sort((a,b)=>b.rs-a.rs)} isMobile={isMobile} onChart={setChartSym}/>
                                </>
                              )}
                            </div>
                          )
                        })()}
                      </div>
                      )
                    })
                    })()}
                  </div>
                </div>
                </div>

                {/* Sectors table — second column of the grid, sortable */}
                <div>
                {sectorData.length>0&&(
                  <>
                    <div style={{fontWeight:800,fontSize:14,margin:'0 0 8px'}}>🏭 Sectors</div>
                    <div ref={secTableDrag.ref} {...secTableDrag.handlers} style={{overflowX:'auto',overflowY:'auto',maxHeight:520,border:`1px solid ${C.border}`,borderRadius:12,...secTableDrag.style}}>
                      <div style={{minWidth:760}}>
                        <div style={{display:'grid',
                          gridTemplateColumns:'170px 70px 60px 60px 70px 70px 90px 90px 90px',
                          gap:4,padding:'10px 12px',background:C.bg,
                          borderBottom:`1px solid ${C.border}`,position:'sticky',top:0,zIndex:1}}>
                          {[['Sector','sector'],['Rank','rank'],['Avg RS','avgRS'],['Stocks','count'],
                            ['PP Today','ppCount'],['Improving','improving'],
                            ['Adv 1D','advancesD'],['Adv 1W','advancesW'],['Adv 1M','advancesM']].map(([h,key],hi)=>(
                            <div key={h} onClick={()=>setSecSort(s=>({key,dir:s.key===key?-s.dir:-1}))}
                              title={SEC_COLUMN_TOOLTIPS[key]}
                              style={{fontSize:10,fontWeight:700,cursor:'pointer',userSelect:'none',
                                color:secSort.key===key?C.accent:C.muted,textTransform:'uppercase',
                                ...(hi===0?{position:'sticky',left:0,background:C.bg,zIndex:2,paddingRight:8}:{})}}>
                              {h}{secSort.key===key?(secSort.dir===-1?' ↓':' ↑'):''}
                            </div>
                          ))}
                        </div>
                        {(()=>{
                          const sortVal = x => secSort.key==='sector'?(x.sector||''):(x[secSort.key]??-Infinity)
                          const dir = secSort.key==='rank' ? -secSort.dir : secSort.dir
                          return [...sectorData].sort((a,b)=>{
                            const av=sortVal(a), bv=sortVal(b)
                            return (typeof av==='string' ? av.localeCompare(bv) : av-bv) * dir
                          })
                        })().map((sec,i)=>{
                          const isExp = expandedIndex==='sector:'+sec.sector
                          const cellStyle = {display:'flex',flexDirection:'column',justifyContent:'center'}
                          const advCell = (val)=>(
                            <div style={cellStyle}>
                              <div style={{fontWeight:700,fontSize:11,color:val!=null?(val>=50?C.green:C.red):C.muted}}>
                                {val!=null?`${val.toFixed(0)}%`:'—'}
                              </div>
                              {val!=null&&(
                                <div style={{width:'100%',height:3,background:C.border+'55',borderRadius:2,marginTop:2,overflow:'hidden'}}>
                                  <div style={{width:`${Math.min(100,val)}%`,height:'100%',
                                    background:val>=50?C.green:C.red,borderRadius:2}}/>
                                </div>
                              )}
                            </div>
                          )
                          return (
                            <div key={sec.sector}>
                              <div onClick={()=>setExpandedIndex(isExp?null:'sector:'+sec.sector)}
                                style={{display:'grid',
                                gridTemplateColumns:'170px 70px 60px 60px 70px 70px 90px 90px 90px',
                                gap:4,padding:'10px 12px',alignItems:'center',cursor:'pointer',
                                background:isExp?C.active:(i%2===0?'transparent':C.bg+'55'),
                                borderBottom:`1px solid ${C.border}33`}}>
                                <div style={{...cellStyle,position:'sticky',left:0,
                                  background:isExp?C.active:(i%2===0?C.card:C.bg),zIndex:1,paddingRight:8}}>
                                  <div style={{fontWeight:700,fontSize:12,color:C.text,display:'flex',alignItems:'center',gap:4}}>{sec.sector} <span style={{fontSize:9,color:C.muted}}>{isExp?'▲':'▼'}</span></div>
                                </div>
                                <div style={cellStyle}>
                                  <div style={{fontWeight:700,fontSize:12,color:C.text}}>#{sec.rank}</div>
                                  {sec.rankChange!=null&&sec.rankChange!==0&&(
                                    <div style={{fontSize:8,fontWeight:700,color:sec.rankChange>0?C.green:C.red}}>
                                      {sec.rankChange>0?'▲':'▼'}{Math.abs(sec.rankChange)} wk
                                    </div>
                                  )}
                                </div>
                                <div style={cellStyle}>
                                  <div style={{fontWeight:800,fontSize:13,color:rsColor(sec.avgRS)}}>{sec.avgRS}</div>
                                </div>
                                <div style={cellStyle}>
                                  <div style={{fontSize:11,color:C.muted}}>{sec.count}</div>
                                </div>
                                <div style={cellStyle}>
                                  <div style={{fontSize:11,color:sec.ppCount>0?C.orange:C.muted,fontWeight:700}}>
                                    {sec.ppCount>0?`🔥${sec.ppCount}`:'—'}
                                  </div>
                                </div>
                                <div style={cellStyle}>
                                  <div style={{fontSize:11,color:sec.improving>0?C.green:C.muted,fontWeight:700}}>
                                    {sec.improving}
                                  </div>
                                </div>
                                {advCell(sec.advancesD)}
                                {advCell(sec.advancesW)}
                                {advCell(sec.advancesM)}
                              </div>
                              {isExp&&(()=>{
                                const secStocks = (stocks||[]).filter(s=>s.sector===sec.sector).sort((a,b)=>b.rs-a.rs)
                                const strong = sec.rank<=3 && sec.count>0 && (sec.improving/sec.count)>=0.5
                                return (
                                  <div style={{padding:'12px 14px',background:C.bg,borderBottom:`1px solid ${C.border}`,position:'sticky',left:0,width:'calc(100vw - 60px)',maxWidth:900}}>
                                    <div style={{display:'flex',justifyContent:'flex-end',marginBottom:8}}>
                                      <button onClick={()=>setShowRowGuidance(v=>!v)}
                                        style={{width:18,height:18,borderRadius:'50%',border:`1px solid ${C.muted}`,
                                          background:showRowGuidance?C.accent+'22':'transparent',
                                          color:showRowGuidance?C.accent:C.muted,fontSize:10,cursor:'pointer',
                                          display:'flex',alignItems:'center',justifyContent:'center',padding:0}}>
                                        i
                                      </button>
                                    </div>
                                    {showRowGuidance&&(
                                      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,
                                        padding:'10px 12px',marginBottom:12,fontSize:11,color:C.muted,lineHeight:1.6}}>
                                        <strong style={{color:C.text}}>How to read this:</strong> A high sector
                                        rank alone can be a few large stocks pulling the average up — check the
                                        "Improving" count too, since that's how many stocks in {sec.sector} are
                                        genuinely broadening the move, not just riding one or two leaders.{' '}
                                        {strong
                                          ? <span style={{color:C.green}}>This sector is top-3 ranked with over half its stocks improving ({sec.improving}/{sec.count}) — real breadth, not a narrow rally.</span>
                                          : <span>Sort the stock list below by RS to see which specific names are actually driving this sector's number right now.</span>}
                                      </div>
                                    )}
                                    <div style={{fontSize:11,fontWeight:700,color:C.muted,marginBottom:8,textTransform:'uppercase'}}>
                                      {sec.sector} stocks ({secStocks.length})
                                    </div>
                                    <SimpleStockTable stocks={secStocks} isMobile={isMobile} onChart={setChartSym}/>
                                  </div>
                                )
                              })()}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </>
                )}
                </div>
                </div>

                {/* Industries table — finer-grained than sectors (like
                    Chartink's segment breakdown). Aggregated client-side
                    from each stock's industry field (populated via the
                    static sector/industry lookup + live Upstox/Screener
                    fetch). Real NSE industry categories are genuinely
                    granular — many have just 1-2 listed stocks — so
                    below MIN_INDUSTRY_STOCKS they're hidden rather than
                    shown as noise; the header notes how many were
                    hidden so this doesn't look like data is missing. */}
                {(()=>{
                  const MIN_INDUSTRY_STOCKS = 3
                  const groups = {}
                  for(const s of stocks){
                    if(!s.industry) continue
                    ;(groups[s.industry] = groups[s.industry] || []).push(s)
                  }
                  const allRows = Object.entries(groups).map(([name,members])=>{
                    const advPct = f => {
                      const vals = members.map(m=>m[f]).filter(v=>v!=null)
                      return vals.length ? vals.filter(v=>v>0).length/vals.length*100 : null
                    }
                    return {
                      name, count: members.length,
                      avgRS: Math.round(members.reduce((a,m)=>a+(m.rs||0),0)/members.length),
                      ppCount: members.filter(m=>m.pp?.isPP).length,
                      improving: members.filter(m=>m.rsTrend?.trend==='improving').length,
                      advD: advPct('chg'), advW: advPct('chgW'), advM: advPct('chgM'),
                      members,
                    }
                  }).sort((a,b)=>b.avgRS-a.avgRS)
                  const rows = allRows.filter(r=>r.count>=MIN_INDUSTRY_STOCKS)
                  const hiddenCount = allRows.length - rows.length
                  if(rows.length===0) return null
                  return (
                    <>
                      <div style={{fontWeight:800,fontSize:14,margin:'18px 0 8px'}}>
                        🏗 Industries ({rows.length})
                        {hiddenCount>0&&(
                          <span style={{fontWeight:500,fontSize:11,color:C.muted,marginLeft:8}}>
                            · {hiddenCount} more hidden (&lt;{MIN_INDUSTRY_STOCKS} stocks each)
                          </span>
                        )}
                      </div>
                      <div ref={indTableDrag.ref} {...indTableDrag.handlers} style={{overflowX:'auto',border:`1px solid ${C.border}`,borderRadius:12,maxHeight:520,overflowY:'auto',...indTableDrag.style}}>
                        <div style={{minWidth:760}}>
                          <div style={{display:'grid',
                            gridTemplateColumns:'220px 60px 60px 60px 70px 70px 90px 90px 90px',
                            gap:4,padding:'10px 12px',background:C.bg,
                            borderBottom:`1px solid ${C.border}`,position:'sticky',top:0,zIndex:1}}>
                            {['Industry','Rank','Avg RS','Stocks','PP Today','Improving','Adv 1D','Adv 1W','Adv 1M'].map((h,hi)=>(
                              <div key={h} title={SEC_COLUMN_TOOLTIPS[{Industry:'sector',Rank:'rank','Avg RS':'avgRS',Stocks:'count','PP Today':'ppCount',Improving:'improving','Adv 1D':'advancesD','Adv 1W':'advancesW','Adv 1M':'advancesM'}[h]]}
                                style={{fontSize:10,fontWeight:700,color:C.muted,textTransform:'uppercase',
                                  ...(hi===0?{position:'sticky',left:0,background:C.bg,zIndex:2,paddingRight:8}:{})}}>{h}</div>
                            ))}
                          </div>
                          {rows.map((ind,i)=>{
                            const isExp = expandedIndex==='industry:'+ind.name
                            const cellStyle = {display:'flex',flexDirection:'column',justifyContent:'center'}
                            const advCell = (val)=>(
                              <div style={cellStyle}>
                                <div style={{fontWeight:700,fontSize:11,color:val!=null?(val>=50?C.green:C.red):C.muted}}>
                                  {val!=null?`${val.toFixed(0)}%`:'—'}
                                </div>
                                {val!=null&&(
                                  <div style={{width:'100%',height:3,background:C.border+'55',borderRadius:2,marginTop:2,overflow:'hidden'}}>
                                    <div style={{width:`${Math.min(100,val)}%`,height:'100%',
                                      background:val>=50?C.green:C.red,borderRadius:2}}/>
                                  </div>
                                )}
                              </div>
                            )
                            return (
                              <div key={ind.name}>
                                <div onClick={()=>setExpandedIndex(isExp?null:'industry:'+ind.name)}
                                  style={{display:'grid',
                                  gridTemplateColumns:'220px 60px 60px 60px 70px 70px 90px 90px 90px',
                                  gap:4,padding:'9px 12px',alignItems:'center',cursor:'pointer',
                                  background:isExp?C.active:(i%2===0?'transparent':C.bg+'55'),
                                  borderBottom:`1px solid ${C.border}33`}}>
                                  <div style={{...cellStyle,position:'sticky',left:0,
                                    background:isExp?C.active:(i%2===0?C.card:C.bg),zIndex:1,paddingRight:8}}>
                                    <div style={{fontWeight:700,fontSize:11,color:C.text,display:'flex',alignItems:'center',gap:4}}>{ind.name} <span style={{fontSize:9,color:C.muted}}>{isExp?'▲':'▼'}</span></div>
                                  </div>
                                  <div style={cellStyle}><div style={{fontWeight:700,fontSize:11,color:C.muted}}>#{i+1}</div></div>
                                  <div style={cellStyle}><div style={{fontWeight:800,fontSize:12,color:rsColor(ind.avgRS)}}>{ind.avgRS}</div></div>
                                  <div style={cellStyle}><div style={{fontSize:11,color:C.muted}}>{ind.count}</div></div>
                                  <div style={cellStyle}>
                                    <div style={{fontSize:11,color:ind.ppCount>0?C.orange:C.muted,fontWeight:700}}>
                                      {ind.ppCount>0?`🔥${ind.ppCount}`:'—'}
                                    </div>
                                  </div>
                                  <div style={cellStyle}>
                                    <div style={{fontSize:11,color:ind.improving>0?C.green:C.muted,fontWeight:700}}>
                                      {ind.improving}
                                    </div>
                                  </div>
                                  {advCell(ind.advD)}
                                  {advCell(ind.advW)}
                                  {advCell(ind.advM)}
                                </div>
                                {isExp&&(
                                  <div style={{padding:'12px 14px',background:C.bg,borderBottom:`1px solid ${C.border}`,position:'sticky',left:0,width:'calc(100vw - 60px)',maxWidth:900}}>
                                    <SimpleStockTable stocks={[...ind.members].sort((a,b)=>b.rs-a.rs)} isMobile={isMobile} onChart={setChartSym}/>
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                      <div style={{fontSize:9,color:C.muted,marginTop:4}}>
                        Industry data comes from Upstox company profiles and fills in gradually — stocks without it yet aren't shown here.
                      </div>

                      {(()=>{
                        const days = {'1M':21,'3M':63,'6M':126,'1Y':252,'2Y':504}[breadthRange]
                        const breadthSlice = breadthHistory.slice(-days)
                        const emaSlice = emaBreadthHistory.slice(-days)
                        return <>
                          <BreadthChart data={breadthSlice} isMobile={isMobile}
                            breadthRange={breadthRange} setBreadthRange={setBreadthRange}/>

                          <EmaBreadthTable data={emaSlice} isMobile={isMobile} dragProps={emaBreadthTableDrag} rangeLabel={{'1M':'Last Month','3M':'Last 3 Months','6M':'Last 6 Months','1Y':'Last Year','2Y':'Last 2 Years'}[breadthRange]}/>
                        </>
                      })()}
                    </>
                  )
                })()}
              </>
            )}
          </div>
        )}


        {/* ══ MARKET BREADTH ══ */}
        {mainTab==='breadth'&&(
          <div style={{padding:'0 0 20px'}}>
            <div style={{marginBottom:14}}>
              <div style={{fontWeight:700,fontSize:16,color:C.text}}>Market Breadth</div>
              <div style={{fontSize:11,color:C.muted}}>Daily market health indicators for NSE</div>
            </div>

            {/* Today's snapshot from stocks already loaded */}
            {stocks.length>0&&(()=>{
              const tot = stocks.length
              const adv = stocks.filter(s=>s.chg>0).length
              const dec = stocks.filter(s=>s.chg<0).length
              const s2  = stocks.filter(s=>s.rs>=70&&s.chg>=0).length
              const pp  = stocks.filter(s=>s.pp?.isPP).length
              const rsi = stocks.filter(s=>s.rsTrend?.trend==='improving').length
              const rsd = stocks.filter(s=>s.rsTrend?.trend==='declining').length
              const rvs = stocks.filter(s=>s.rvol>=2).length
              const rln = stocks.filter(s=>s.rsLineNewHigh).length

              const Stat=({label,value,total,color,sub})=>(
                <div style={{background:C.card,border:`1px solid ${C.divider}`,borderRadius:10,padding:'14px'}}>
                  <div style={{fontSize:11,color:C.muted,marginBottom:6}}>{label}</div>
                  <div style={{fontWeight:700,fontSize:26,color:color||C.text}}>{value}</div>
                  {total&&<div style={{fontSize:10,color:C.muted,marginTop:3}}>{((value/total)*100).toFixed(1)}% of {total}</div>}
                  {sub&&<div style={{fontSize:10,color:C.muted,marginTop:3}}>{sub}</div>}
                </div>
              )

              const adRatio = dec>0?(adv/dec).toFixed(2):adv>0?'∞':'0'
              const breadthHealthy = adv > dec && s2 > tot*0.3

              return(
                <>
                  {/* Health indicator */}
                  <div style={{background:breadthHealthy?C.green+'11':C.red+'11',
                    border:`1px solid ${breadthHealthy?C.green:C.red}44`,
                    borderRadius:10,padding:'12px 16px',marginBottom:14,
                    display:'flex',alignItems:'center',gap:10}}>
                    <div style={{width:10,height:10,borderRadius:'50%',
                      background:breadthHealthy?C.green:C.red,flexShrink:0}}/>
                    <span style={{fontWeight:700,fontSize:13,
                      color:breadthHealthy?C.green:C.red}}>
                      Market is {breadthHealthy?'Healthy — Broad participation':'Weak — Limited breadth'}
                    </span>
                    <span style={{fontSize:11,color:C.muted,marginLeft:'auto'}}>
                      A/D Ratio: {adRatio}
                    </span>
                  </div>

                  {/* Stats grid */}
                  <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10,marginBottom:14}}>
                    <Stat label="Advancing" value={adv} total={tot} color={C.green}/>
                    <Stat label="Declining"  value={dec} total={tot} color={C.red}/>
                    <Stat label="RS Improving" value={rsi} total={tot} color={C.accent}/>
                    <Stat label="RS Declining" value={rsd} total={tot} color={C.orange}/>
                    <Stat label="PP Today" value={pp} total={tot} color={C.yellow}/>
                    <Stat label="Vol Surge (RVOL>2)" value={rvs} total={tot} color={C.purple}/>
                    <Stat label="RS Line New High" value={rln} total={tot} color={C.teal}/>
                    <Stat label="RS ≥ 70" value={s2} total={tot} color={C.green}/>
                  </div>

                  {/* RS Line New Highs — early leaders */}
                  {rln>0&&(
                    <div style={{background:C.card,border:`1px solid ${C.teal}33`,borderRadius:10,padding:'14px',marginBottom:12}}>
                      <div style={{fontWeight:700,fontSize:13,color:C.teal,marginBottom:8}}>
                        RS Line New Highs — Early Leaders ({rln})
                      </div>
                      <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                        {stocks.filter(s=>s.rsLineNewHigh).sort((a,b)=>(b.rsTv||b.rs)-(a.rsTv||a.rs)).slice(0,20).map(s=>(
                          <div key={s.sym} onClick={()=>setChartSym(s.sym)}
                            style={{padding:'4px 10px',borderRadius:6,background:C.teal+'18',
                              border:`1px solid ${C.teal}33`,cursor:'pointer',fontSize:11,fontWeight:600,
                              color:C.teal}}>
                            {s.sym} <span style={{color:C.muted,fontSize:10}}>{s.rsTv||s.rs}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* New Stage 2 entries */}
                  {stocks.filter(s=>s.isS2NewEntry).length>0&&(
                    <div style={{background:C.card,border:`1px solid ${C.green}33`,borderRadius:10,padding:'14px',marginBottom:12}}>
                      <div style={{fontWeight:700,fontSize:13,color:C.green,marginBottom:8}}>
                        New Stage 2 Entries Today ({stocks.filter(s=>s.isS2NewEntry).length})
                      </div>
                      <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                        {stocks.filter(s=>s.isS2NewEntry).sort((a,b)=>(b.rsTv||b.rs)-(a.rsTv||a.rs)).map(s=>(
                          <div key={s.sym} onClick={()=>setChartSym(s.sym)}
                            style={{padding:'4px 10px',borderRadius:6,background:C.green+'18',
                              border:`1px solid ${C.green}33`,cursor:'pointer',fontSize:11,fontWeight:600,color:C.green}}>
                            {s.sym} <span style={{color:C.muted,fontSize:10}}>{s.rsTv||s.rs}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )
            })()}
          </div>
        )}

        {/* ══ PORTFOLIO TRACKER ══ */}
        {mainTab==='portfolio'&&(
          <div style={{padding:'0 0 20px'}}>
            <div style={{marginBottom:14,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <div>
                <div style={{fontWeight:700,fontSize:16}}>Portfolio Tracker</div>
                <div style={{fontSize:11,color:C.muted}}>Track your holdings — RS, Stage, exit signals &amp; trade journal</div>
              </div>
              <button onClick={()=>{
                const sym=prompt('Enter stock symbol (e.g. RELIANCE):')?.toUpperCase().trim()
                if(!sym) return
                const entryPriceRaw=prompt('Entry price (optional — leave blank to skip):')
                const qtyRaw=prompt('Quantity (optional — leave blank to skip):')
                const entryPrice=entryPriceRaw&&!isNaN(+entryPriceRaw)?+entryPriceRaw:null
                const qty=qtyRaw&&!isNaN(+qtyRaw)?+qtyRaw:null
                const note=prompt('Why this trade? (optional — first journal entry):')
                setPortfolioHoldings(h=>[...h.filter(x=>x.sym!==sym),{
                  sym,addedAt:new Date().toISOString(),entryPrice,qty,
                  journal:note?[{ts:new Date().toISOString(),note}]:[],
                }])
              }}
                style={{padding:'7px 14px',borderRadius:7,border:'none',
                  background:C.accent,color:'#000',fontWeight:700,fontSize:12,cursor:'pointer'}}>
                + Add Stock
              </button>
            </div>

            {portfolioHoldings.length===0?(
              <div style={{textAlign:'center',padding:'60px 20px',color:C.muted}}>
                <div style={{fontSize:36,marginBottom:10}}>💼</div>
                <div style={{fontSize:14,fontWeight:700,color:C.text}}>No holdings yet</div>
                <div style={{fontSize:12,marginTop:6}}>Click "+ Add Stock" to track your positions</div>
              </div>
            ):(
              <div style={{display:'flex',flexDirection:'column',gap:8}}>
                {portfolioHoldings.map(h=>{
                  const s=stocks.find(x=>x.sym===h.sym)
                  const stage=s?calcWeinsteinStage(s):null
                  const dangerZone=stage&&(stage.stage===3||stage.stage===4)
                  const pnlPct=(h.entryPrice&&s?.last)?((s.last-h.entryPrice)/h.entryPrice*100):null
                  const journalOpen=journalOpenSym===h.sym
                  const journal=h.journal||[]
                  return(
                    <div key={h.sym} style={{background:C.card,
                      border:`1px solid ${dangerZone?C.red+'55':C.divider}`,
                      borderRadius:10,padding:'12px 16px'}}>
                      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12}}>
                        <div style={{display:'flex',alignItems:'center',gap:12,flex:1,minWidth:0}}>
                          <div>
                            <div style={{fontWeight:700,fontSize:14,color:C.accent,
                              cursor:'pointer'}}
                              onClick={()=>s&&setChartSym(s.sym)}>{h.sym}</div>
                            <div style={{fontSize:10,color:C.muted,marginTop:2}}>
                              {s?.sector||'—'}{h.entryPrice?` · Entry ${fmtP(h.entryPrice)}${h.qty?` × ${h.qty}`:''}`:''}
                            </div>
                          </div>
                          {s?(
                            <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
                              <div style={{textAlign:'center'}}>
                                <div style={{fontWeight:700,fontSize:16,color:rsColor(s.rsTv||s.rs)}}>{s.rsTv||s.rs}</div>
                                <div style={{fontSize:8,color:C.muted}}>RS-TV</div>
                              </div>
                              {stage&&<StageBadge stage={stage}/>}
                              {topVolumeSignal(s)==='pp'&&<Badge color={C.green}>PP</Badge>}
                              {pnlPct!=null&&(
                                <Badge color={pnlPct>=0?C.green:C.red}>
                                  {pnlPct>=0?'+':''}{pnlPct.toFixed(1)}% P&amp;L
                                </Badge>
                              )}
                              {dangerZone&&(
                                <div style={{padding:'3px 8px',borderRadius:5,fontSize:10,fontWeight:700,
                                  background:C.red+'22',color:C.red,border:`1px solid ${C.red}44`}}>
                                  ⚠️ EXIT SIGNAL
                                </div>
                              )}
                            </div>
                          ):<span style={{color:C.muted,fontSize:11}}>No data</span>}
                        </div>
                        <div style={{display:'flex',gap:8,alignItems:'center'}}>
                          {s&&<span style={{fontWeight:600,fontSize:13}}>{fmtP(s.last)}</span>}
                          {s&&<span style={{fontWeight:700,fontSize:12,color:s.chg>=0?C.green:C.red}}>
                            {s.chg>=0?'+':''}{s.chg?.toFixed(2)}%
                          </span>}
                          <button onClick={()=>setJournalOpenSym(journalOpen?null:h.sym)}
                            title="Trade journal"
                            style={{background:journalOpen?C.accent+'22':'transparent',
                              border:`1px solid ${journalOpen?C.accent:C.border}`,
                              color:journalOpen?C.accent:C.muted,fontSize:12,padding:'3px 8px',
                              borderRadius:5,cursor:'pointer'}}>
                            📝{journal.length>0?` ${journal.length}`:''}
                          </button>
                          <button onClick={()=>setPortfolioHoldings(h2=>h2.filter(x=>x.sym!==h.sym))}
                            style={{background:'transparent',border:`1px solid ${C.border}`,
                              color:C.muted,fontSize:12,padding:'3px 8px',borderRadius:5,cursor:'pointer'}}>
                            ×
                          </button>
                        </div>
                      </div>

                      {journalOpen&&(
                        <div style={{marginTop:12,paddingTop:12,borderTop:`1px solid ${C.divider}`}}>
                          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                            <div style={{fontSize:11,fontWeight:700,color:C.muted}}>TRADE JOURNAL</div>
                            <button onClick={()=>{
                              const note=prompt('Journal note:')
                              if(note?.trim()){
                                setPortfolioHoldings(hs=>hs.map(x=>x.sym===h.sym
                                  ?{...x,journal:[...(x.journal||[]),{ts:new Date().toISOString(),note:note.trim()}]}
                                  :x))
                              }
                            }}
                              style={{padding:'4px 10px',borderRadius:6,border:`1px solid ${C.accent}44`,
                                background:C.accent+'18',color:C.accent,fontSize:11,fontWeight:600,cursor:'pointer'}}>
                              + Add Note
                            </button>
                          </div>
                          {journal.length===0?(
                            <div style={{fontSize:11,color:C.muted,padding:'8px 0'}}>
                              No notes yet — record why you entered, what you're watching for, or your exit plan.
                            </div>
                          ):(
                            <div style={{display:'flex',flexDirection:'column',gap:6}}>
                              {[...journal].reverse().map((j,ji)=>(
                                <div key={ji} style={{background:C.bg,borderRadius:7,padding:'8px 10px',
                                  display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8}}>
                                  <div style={{minWidth:0}}>
                                    <div style={{fontSize:9,color:C.muted,marginBottom:2}}>
                                      {new Date(j.ts).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}
                                      {' · '}
                                      {new Date(j.ts).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}
                                    </div>
                                    <div style={{fontSize:12,color:C.text,wordBreak:'break-word'}}>{j.note}</div>
                                  </div>
                                  <button onClick={()=>{
                                    setPortfolioHoldings(hs=>hs.map(x=>x.sym===h.sym
                                      ?{...x,journal:(x.journal||[]).filter(jj=>jj.ts!==j.ts)}
                                      :x))
                                  }}
                                    style={{background:'transparent',border:'none',color:C.muted,
                                      fontSize:12,cursor:'pointer',flexShrink:0,padding:'0 2px'}}>×</button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ══ STOCK COMPARE ══ */}
        {mainTab==='compare'&&(
          <div style={{padding:'0 0 20px'}}>
            <div style={{marginBottom:14}}>
              <div style={{fontWeight:700,fontSize:16}}>Stock Comparison</div>
              <div style={{fontSize:11,color:C.muted}}>Compare up to 4 stocks side by side</div>
            </div>
            <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap'}}>
              <input value={compareInput} onChange={e=>setCompareInput(e.target.value.toUpperCase())}
                onKeyDown={e=>{
                  if(e.key==='Enter'&&compareInput.trim()&&compareSyms.length<4){
                    setCompareSyms(s=>[...new Set([...s,compareInput.trim()])])
                    setCompareInput('')
                  }
                }}
                placeholder="Type symbol + Enter (e.g. RELIANCE)"
                style={{flex:1,padding:'8px 12px',background:C.card,border:`1px solid ${C.border}`,
                  borderRadius:7,color:C.text,fontSize:12,outline:'none',minWidth:200}}/>
              <button onClick={()=>setCompareSyms([])}
                style={{padding:'8px 14px',borderRadius:7,border:`1px solid ${C.border}`,
                  background:'transparent',color:C.muted,fontSize:12,cursor:'pointer'}}>
                Clear
              </button>
            </div>

            {compareSyms.length===0?(
              <div style={{textAlign:'center',padding:'60px 20px',color:C.muted}}>
                <div style={{fontSize:36,marginBottom:10}}>⚖️</div>
                <div style={{fontSize:14,fontWeight:700,color:C.text}}>Type a symbol and press Enter</div>
                <div style={{fontSize:12,marginTop:6}}>Add up to 4 stocks to compare</div>
              </div>
            ):(
              <div style={{display:'grid',gridTemplateColumns:`repeat(${Math.min(compareSyms.length,4)},1fr)`,gap:10}}>
                {compareSyms.map(sym=>{
                  const s=stocks.find(x=>x.sym===sym)
                  const stage=s?calcWeinsteinStage(s):null
                  return(
                    <div key={sym} style={{background:C.card,border:`1px solid ${C.divider}`,borderRadius:12,overflow:'hidden'}}>
                      <div style={{padding:'12px 14px',borderBottom:`1px solid ${C.divider}`,
                        display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                        <span style={{fontWeight:700,fontSize:14,color:C.accent,cursor:'pointer'}}
                          onClick={()=>setChartSym(sym)}>{sym}</span>
                        <button onClick={()=>setCompareSyms(s=>s.filter(x=>x!==sym))}
                          style={{background:'transparent',border:'none',color:C.muted,
                            fontSize:14,cursor:'pointer'}}>×</button>
                      </div>
                      {s?(
                        <div style={{padding:'12px 14px'}}>
                          <div style={{display:'flex',justifyContent:'space-between',marginBottom:12}}>
                            <div>
                              <div style={{fontWeight:700,fontSize:22,color:rsColor(s.rsTv||s.rs)}}>{s.rsTv||s.rs}</div>
                              <div style={{fontSize:9,color:C.teal}}>RS-TV</div>
                            </div>
                            {stage&&<StageBadge stage={stage}/>}
                          </div>
                          {[
                            ['Price',   fmtP(s.last),                      C.text],
                            ['Chg%',    `${s.chg>=0?'+':''}${s.chg?.toFixed(2)}%`, s.chg>=0?C.green:C.red],
                            ['MID RS',  s.rsMidcap??'—',                   s.rsMidcap?rsColor(s.rsMidcap):C.muted],
                            ['SML RS',  s.rsSmallcap??'—',                 s.rsSmallcap?rsColor(s.rsSmallcap):C.muted],
                            ['Sector',  s.rsSector??'—',                   s.rsSector?rsColor(s.rsSector):C.muted],
                            ['Market Cap', s.marketCap?`${s.marketCap>=100000?(s.marketCap/100000).toFixed(1)+'L':s.marketCap>=1000?(s.marketCap/1000).toFixed(1)+'K':s.marketCap} Cr`:'—', C.text],
                            ['P/E',     s.pe?.toFixed(1)??'—',             s.pe?s.pe<25?C.green:s.pe<50?C.yellow:C.red:C.muted],
                            ['ROE',     s.roe?`${s.roe.toFixed(1)}%`:'—',  s.roe?s.roe>20?C.green:s.roe>10?C.yellow:C.red:C.muted],
                            ['Promoter',s.promoter?`${s.promoter.toFixed(1)}%`:'—', s.promoter?s.promoter>55?C.green:C.yellow:C.muted],
                            ['RVOL',    s.rvol?.toFixed(2)??'—',           s.rvol?s.rvol>=2?C.orange:s.rvol>=1.5?C.yellow:C.muted:C.muted],
                            ['PP 10d',  `${s.pp?.ppCount10d||0}×`,         s.pp?.ppCount10d>0?C.orange:C.muted],
                            ['Sector',  s.sector,                          C.muted],
                          ].map(([k,v,c])=>(
                            <div key={k} style={{display:'flex',justifyContent:'space-between',
                              padding:'5px 0',borderBottom:`1px solid ${C.divider}`,fontSize:12}}>
                              <span style={{color:C.muted}}>{k}</span>
                              <span style={{fontWeight:600,color:c}}>{v}</span>
                            </div>
                          ))}
                          <div style={{marginTop:10}}>
                            <div style={{fontSize:10,color:C.muted,marginBottom:4}}>RS Last 7 Days</div>
                            <div style={{display:'flex',gap:2}}>
                              {s.hist.slice(-7).map((v,i)=>{
                                const color=v===null?C.border:v>=90?C.green:v>=70?C.accent:v>=50?C.yellow:C.red
                                return<div key={i} style={{flex:1,height:20,borderRadius:3,
                                  background:color+'28',border:`1px solid ${color}44`,
                                  display:'flex',alignItems:'center',justifyContent:'center',
                                  fontSize:8,fontWeight:700,color}}>{v??'—'}</div>
                              })}
                            </div>
                          </div>
                        </div>
                      ):(
                        <div style={{padding:'20px',textAlign:'center',color:C.muted,fontSize:12}}>
                          Symbol not found in current scan
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ══ SQUEEZE ══ */}
        {mainTab==='squeeze'&&(
          <div>
            <LastUpdatedBar
              scanMeta={scanMeta} lastRefresh={lastRefresh} loading={loading}
              autoRefresh={autoRefresh} setAutoRefresh={setAutoRefresh}
              refreshInterval={refreshInterval} setRefreshInterval={setRefreshInterval}
              onRefresh={runDBScan}
            />
            <div style={{background:C.card,border:`1px solid ${C.teal}44`,borderRadius:12,padding:'14px',marginBottom:14}}>
              <div style={{fontWeight:800,fontSize:15,color:C.teal,marginBottom:6}}>🌀 Squeeze Scanner</div>
              <div style={{fontSize:12,color:C.muted,marginBottom:12}}>
                Bollinger Band Squeeze (volatility contraction) + VCP (Volatility Contraction Pattern, Minervini style)
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:8}}>
                {[
                  {l:'🔵 BB In Squeeze',v:stocks.filter(s=>s.squeeze?.inSqueeze).length,c:C.blue},
                  {l:'🟢 BB Fired',v:stocks.filter(s=>s.squeeze?.squeezeFired).length,c:C.green},
                  {l:'📐 VCP Forming',v:stocks.filter(s=>s.vcp?.isVCP).length,c:C.purple},
                  {l:'🚀 VCP Fired',v:stocks.filter(s=>s.vcp?.vcpFired).length,c:C.accent},
                ].map(({l,v,c})=>(
                  <div key={l} style={{background:C.bg,borderRadius:8,padding:'12px',textAlign:'center'}}>
                    <div style={{fontSize:24,fontWeight:900,color:c}}>{v}</div>
                    <div style={{fontSize:10,color:C.muted,marginTop:3}}>{l}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Section 1: Currently in squeeze (coiled) */}
            <div style={{marginBottom:20}}>
              <div style={{fontWeight:800,fontSize:14,color:C.blue,marginBottom:4,display:'flex',alignItems:'center',gap:6}}>
                🔵 In Squeeze — Coiled, Waiting to Fire
              </div>
              <div style={{fontSize:11,color:C.muted,marginBottom:10}}>
                Low volatility, BB inside Keltner Channel — often precedes a big move
              </div>
              {(()=>{
                const inSqueeze = stocks.filter(s=>s.squeeze?.inSqueeze || s.vcp?.isVCP).sort((a,b)=>b.rs-a.rs)
                if(inSqueeze.length===0) return(
                  <div style={{textAlign:'center',padding:'30px 0',color:C.muted,fontSize:12}}>
                    No stocks currently in squeeze
                  </div>
                )
                return(
                  <>
                    <TVCopyPanel stocks={inSqueeze} label="In Squeeze"/>
                    <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'1fr 1fr',gap:8}}>
                      {inSqueeze.slice(0,30).map(s=>(
                        <div key={s.sym} style={{background:C.card,border:`1px solid ${C.blue}33`,
                          borderRadius:10,padding:'12px'}}>
                          <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
                            <div>
                              <div style={{fontWeight:800,fontSize:13}}>{s.sym}</div>
                              <div style={{fontSize:10,color:C.muted}}>{s.sector}</div>
                            </div>
                            <div style={{textAlign:'right'}}>
                              <div style={{fontWeight:800,fontSize:16,color:rsColor(s.rs)}}>{s.rs}</div>
                              <div style={{fontSize:10,color:s.chg>=0?C.green:C.red}}>{s.chg>=0?'+':''}{s.chg?.toFixed(1)}%</div>
                            </div>
                          </div>
                          <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
                            {s.squeeze?.inSqueeze&&(
                              <div style={{padding:'2px 7px',borderRadius:5,fontSize:9,fontWeight:700,
                                background:C.blue+'22',color:C.blue}}>
                                BB {s.squeeze.squeezeDays}d · {s.squeeze.bbWidthPct}%
                              </div>
                            )}
                            {s.vcp?.isVCP&&(
                              <div style={{padding:'2px 7px',borderRadius:5,fontSize:9,fontWeight:700,
                                background:C.purple+'22',color:C.purple}}>
                                VCP {s.vcp.vcpStage} contractions
                              </div>
                            )}
                          </div>
                          {s.vcp?.contractions?.length>0&&(
                            <div style={{fontSize:9,color:C.muted,marginTop:4}}>
                              Pullbacks: {s.vcp.contractions.map(c=>`${c}%`).join(' → ')}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                )
              })()}
            </div>

            {/* Section 2: Just fired (breaking out) */}
            <div>
              <div style={{fontWeight:800,fontSize:14,color:C.green,marginBottom:4,display:'flex',alignItems:'center',gap:6}}>
                🟢 Firing Now — Breaking Out of Squeeze
              </div>
              <div style={{fontSize:11,color:C.muted,marginBottom:10}}>
                Was in squeeze, now expanding with volume — the move is starting
              </div>
              {(()=>{
                const fired = stocks.filter(s=>s.squeeze?.squeezeFired || s.vcp?.vcpFired).sort((a,b)=>b.rs-a.rs)
                if(fired.length===0) return(
                  <div style={{textAlign:'center',padding:'40px 0',color:C.muted}}>
                    <div style={{fontSize:36,marginBottom:10}}>🌀</div>
                    <div style={{fontSize:13,fontWeight:700,color:C.text}}>No squeeze fires yet</div>
                    <div style={{fontSize:11,marginTop:4}}>Check back after market activity</div>
                  </div>
                )
                return(
                  <>
                    <TVCopyPanel stocks={fired} label="Squeeze Fired"/>
                    {fired.map(s=>(
                      <div key={s.sym} style={{background:C.card,border:`2px solid ${C.green}44`,
                        borderRadius:12,marginBottom:10,padding:'14px'}}>
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8}}>
                          <div>
                            <div style={{fontWeight:800,fontSize:16}}>{s.sym}</div>
                            <div style={{fontSize:11,color:C.muted}}>{s.sector}</div>
                            <div style={{display:'flex',gap:4,marginTop:6,flexWrap:'wrap'}}>
                              {s.squeeze?.squeezeFired&&<Badge color={C.green} glow>🟢 BB Fired</Badge>}
                              {s.vcp?.vcpFired&&<Badge color={C.accent} glow>🚀 VCP Fired</Badge>}
                              {topVolumeSignal(s)==='pp'&&<Badge color={C.green}>🔥PP</Badge>}
                            </div>
                          </div>
                          <div style={{textAlign:'right'}}>
                            <div style={{fontWeight:900,fontSize:20,color:rsColor(s.rs)}}>{s.rs}</div>
                            <div style={{fontWeight:700,fontSize:13,color:s.chg>=0?C.green:C.red}}>
                              {s.chg>=0?'+':''}{s.chg?.toFixed(2)}%</div>
                            <div style={{fontSize:11,color:C.muted}}>{fmtP(s.last)}</div>
                          </div>
                        </div>
                        {s.vcp?.contractions?.length>0&&(
                          <div style={{fontSize:10,color:C.muted}}>
                            VCP pullbacks: {s.vcp.contractions.map(c=>`${c}%`).join(' → ')} (contracting)
                          </div>
                        )}
                      </div>
                    ))}
                  </>
                )
              })()}
            </div>
          </div>
        )}

        {/* ══ BREAKOUT ══ */}
        {mainTab==='breakout'&&(
          <div>
            <LastUpdatedBar
              scanMeta={scanMeta} lastRefresh={lastRefresh} loading={loading}
              autoRefresh={autoRefresh} setAutoRefresh={setAutoRefresh}
              refreshInterval={refreshInterval} setRefreshInterval={setRefreshInterval}
              onRefresh={runDBScan}
            />
            {/* Stats */}
            <div style={{background:C.card,border:`1px solid ${C.accent}44`,borderRadius:12,padding:'14px',marginBottom:14}}>
              <div style={{fontWeight:800,fontSize:15,color:C.accent,marginBottom:6}}>💥 HY/HT Breakout Scanner</div>
              <div style={{fontSize:12,color:C.muted,marginBottom:12}}>
                Stocks that had High Year (HY) or High Time (HT) volume in last 5 days and are breaking out today
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8}}>
                {[
                  {l:'🚀 Power Break',v:stocks.filter(s=>calcHYHTBreakout(s).isBreakout&&passesMcap(s)&&s.rs>=80&&s.chg>=3).length,c:C.accent},
                  {l:'⭐ Strong Break',v:stocks.filter(s=>calcHYHTBreakout(s).isBreakout&&passesMcap(s)&&s.rs>=70&&s.chg>=2).length,c:C.green},
                  {l:'✅ All Breakouts',v:stocks.filter(s=>calcHYHTBreakout(s).isBreakout&&passesMcap(s)).length,c:C.teal},
                  {l:'🏛️ IBV Signals',v:stocks.filter(s=>calcIBV(s).isIBV&&passesMcap(s)).length,c:C.purple},
                  {l:'🔥 PP + Break',v:stocks.filter(s=>s.pp?.isPP&&calcHYHTBreakout(s).isBreakout&&passesMcap(s)).length,c:C.orange},
                  {l:'👑 RS 90+ Break',v:stocks.filter(s=>s.rs>=90&&calcHYHTBreakout(s).isBreakout&&passesMcap(s)).length,c:C.yellow},
                  {l:'🎯 R1 Breakout',v:stocks.filter(s=>s.isResistanceBreakout&&passesMcap(s)).length,c:C.red},
                  {l:'☕ Cup Breakout',v:stocks.filter(s=>s.isCupHandleBreakout&&passesMcap(s)).length,c:C.yellow},
                  {l:'🐠 Guppy Crossover',v:stocks.filter(s=>s.isGuppyBullishCrossover&&passesMcap(s)).length,c:C.green},
                ].map(({l,v,c})=>(
                  <div key={l} style={{background:C.bg,borderRadius:8,padding:'10px',textAlign:'center'}}>
                    <div style={{fontSize:22,fontWeight:900,color:c}}>{v}</div>
                    <div style={{fontSize:10,color:C.muted,marginTop:3}}>{l}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* IBV Section */}
            <div style={{background:C.card,border:`1px solid ${C.purple}44`,borderRadius:12,padding:'14px',marginBottom:14}}>
              <div style={{fontWeight:800,fontSize:14,color:C.purple,marginBottom:4}}>🏛️ IBV — Institutional Buying Volume</div>
              <div style={{fontSize:11,color:C.muted,marginBottom:10}}>
                Stocks with 2+ Pocket Pivot days in last 10 days = institutional accumulation
              </div>
              <TVCopyPanel stocks={stocks.filter(s=>calcIBV(s).isIBV&&passesMcap(s))} label="IBV Stocks"/>
              <div style={{display:'flex',flexDirection:'column',gap:8,maxHeight:300,overflowY:'auto'}}>
                {stocks.filter(s=>calcIBV(s).isIBV&&passesMcap(s)).slice(0,20).map(s=>{
                  const ibv=calcIBV(s)
                  return(
                    <div key={s.sym} onClick={()=>setChartSym(s.sym)} style={{background:C.bg,borderRadius:8,padding:'10px 12px',
                      display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer'}}>
                      <div>
                        <div style={{fontWeight:800,fontSize:13}}>{s.sym}</div>
                        <div style={{fontSize:10,color:C.muted}}>{s.sector} · {ibv.ppCount} PP days · score {ibv.ibvScore}/7</div>
                      </div>
                      <div style={{textAlign:'right'}}>
                        <div style={{fontWeight:800,fontSize:16,color:rsColor(s.rs)}}>{s.rs}</div>
                        <div style={{fontSize:10,color:s.chg>=0?C.green:C.red}}>{s.chg>=0?'+':''}{s.chg?.toFixed(2)}%</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Resistance Breakout (R1) Section */}
            <div style={{background:C.card,border:`1px solid ${C.red}44`,borderRadius:12,padding:'14px',marginBottom:14}}>
              <div style={{fontWeight:800,fontSize:14,color:C.red,marginBottom:4}}>🎯 Resistance Breakout (R1)</div>
              <div style={{fontSize:11,color:C.muted,marginBottom:10}}>
                Stocks whose price just crossed above a significant recent resistance level
              </div>
              <TVCopyPanel stocks={stocks.filter(s=>s.isResistanceBreakout&&passesMcap(s))} label="R1 Breakouts"/>
              <div style={{display:'flex',flexDirection:'column',gap:8,maxHeight:300,overflowY:'auto'}}>
                {stocks.filter(s=>s.isResistanceBreakout&&passesMcap(s)).length===0?(
                  <div style={{textAlign:'center',padding:'20px 0',color:C.muted,fontSize:12}}>
                    No resistance breakouts right now.
                  </div>
                ):stocks.filter(s=>s.isResistanceBreakout&&passesMcap(s)).sort((a,b)=>b.rs-a.rs).slice(0,20).map(s=>(
                  <div key={s.sym} onClick={()=>setChartSym(s.sym)} style={{background:C.bg,borderRadius:8,padding:'10px 12px',
                    display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer'}}>
                    <div>
                      <div style={{fontWeight:800,fontSize:13}}>{s.sym}</div>
                      <div style={{fontSize:10,color:C.muted}}>{s.sector} · R1 @ {s.resistanceR1?fmtP(s.resistanceR1):'—'}</div>
                    </div>
                    <div style={{textAlign:'right'}}>
                      <div style={{fontWeight:800,fontSize:16,color:rsColor(s.rs)}}>{s.rs}</div>
                      <div style={{fontSize:10,color:s.chg>=0?C.green:C.red}}>{s.chg>=0?'+':''}{s.chg?.toFixed(2)}%</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 52-Week High Breakout Section */}
            <div style={{background:C.card,border:`1px solid ${C.yellow}44`,borderRadius:12,padding:'14px',marginBottom:14}}>
              <div style={{fontWeight:800,fontSize:14,color:C.yellow,marginBottom:4}}>🏆 52-Week High Breakout</div>
              <div style={{fontSize:11,color:C.muted,marginBottom:10}}>
                Stocks that just crossed above their prior 52-week high — a fresh new high today, not one from days ago
              </div>
              <TVCopyPanel stocks={stocks.filter(s=>s.is52whBreakout&&passesMcap(s))} label="52W High Breakouts"/>
              <div style={{display:'flex',flexDirection:'column',gap:8,maxHeight:300,overflowY:'auto'}}>
                {stocks.filter(s=>s.is52whBreakout&&passesMcap(s)).length===0?(
                  <div style={{textAlign:'center',padding:'20px 0',color:C.muted,fontSize:12}}>
                    No 52-week high breakouts right now.
                  </div>
                ):stocks.filter(s=>s.is52whBreakout&&passesMcap(s)).sort((a,b)=>b.rs-a.rs).slice(0,20).map(s=>(
                  <div key={s.sym} onClick={()=>setChartSym(s.sym)} style={{background:C.bg,borderRadius:8,padding:'10px 12px',
                    display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer'}}>
                    <div>
                      <div style={{fontWeight:800,fontSize:13}}>{s.sym}</div>
                      <div style={{fontSize:10,color:C.muted}}>{s.sector} · ₹{s.lastPrice?.toLocaleString('en-IN')}</div>
                    </div>
                    <div style={{textAlign:'right'}}>
                      <div style={{fontWeight:800,fontSize:16,color:rsColor(s.rs)}}>{s.rs}</div>
                      <div style={{fontSize:10,color:s.chg>=0?C.green:C.red}}>{s.chg>=0?'+':''}{s.chg?.toFixed(2)}%</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Weekly Breakout Stocks Section — top gainers by 1-week %
                change, doesn't need a dedicated backend field since chgW
                is already computed per stock. */}
            <div style={{background:C.card,border:`1px solid ${C.green}44`,borderRadius:12,padding:'14px',marginBottom:14}}>
              <div style={{fontWeight:800,fontSize:14,color:C.green,marginBottom:4}}>📅 Weekly Breakout Stocks</div>
              <div style={{fontSize:11,color:C.muted,marginBottom:10}}>
                Biggest gainers over the last week
              </div>
              <TVCopyPanel stocks={[...stocks].filter(s=>s.chgW>0&&passesMcap(s)).sort((a,b)=>b.chgW-a.chgW).slice(0,20)} label="Weekly Gainers"/>
              <div style={{display:'flex',flexDirection:'column',gap:8,maxHeight:300,overflowY:'auto'}}>
                {[...stocks].filter(s=>s.chgW>0&&passesMcap(s)).length===0?(
                  <div style={{textAlign:'center',padding:'20px 0',color:C.muted,fontSize:12}}>
                    No weekly gainers right now.
                  </div>
                ):[...stocks].filter(s=>s.chgW>0&&passesMcap(s)).sort((a,b)=>b.chgW-a.chgW).slice(0,20).map(s=>(
                  <div key={s.sym} onClick={()=>setChartSym(s.sym)} style={{background:C.bg,borderRadius:8,padding:'10px 12px',
                    display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer'}}>
                    <div>
                      <div style={{fontWeight:800,fontSize:13}}>{s.sym}</div>
                      <div style={{fontSize:10,color:C.muted}}>{s.sector} · ₹{s.lastPrice?.toLocaleString('en-IN')}</div>
                    </div>
                    <div style={{textAlign:'right'}}>
                      <div style={{fontWeight:800,fontSize:16,color:C.green}}>+{s.chgW?.toFixed(2)}%</div>
                      <div style={{fontSize:10,color:C.muted}}>RS {s.rs}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Cup & Handle Breakout Section */}
            <div style={{background:C.card,border:`1px solid ${C.yellow}44`,borderRadius:12,padding:'14px',marginBottom:14}}>
              <div style={{fontWeight:800,fontSize:14,color:C.yellow,marginBottom:4}}>☕ Cup & Handle Breakout</div>
              <div style={{fontSize:11,color:C.muted,marginBottom:10}}>
                Stocks breaking out above a cup-and-handle formation today — algorithmic approximation, use as a visual aid
              </div>
              <TVCopyPanel stocks={stocks.filter(s=>s.isCupHandleBreakout&&passesMcap(s))} label="Cup Breakouts"/>
              <div style={{display:'flex',flexDirection:'column',gap:8,maxHeight:300,overflowY:'auto'}}>
                {stocks.filter(s=>s.isCupHandleBreakout&&passesMcap(s)).length===0?(
                  <div style={{textAlign:'center',padding:'20px 0',color:C.muted,fontSize:12}}>
                    No cup & handle breakouts right now.
                  </div>
                ):stocks.filter(s=>s.isCupHandleBreakout&&passesMcap(s)).sort((a,b)=>b.rs-a.rs).slice(0,20).map(s=>(
                  <div key={s.sym} onClick={()=>setChartSym(s.sym)} style={{background:C.bg,borderRadius:8,padding:'10px 12px',
                    display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer'}}>
                    <div>
                      <div style={{fontWeight:800,fontSize:13}}>{s.sym}</div>
                      <div style={{fontSize:10,color:C.muted}}>{s.sector} · Cup depth {s.cupDepthPct??'—'}%</div>
                    </div>
                    <div style={{textAlign:'right'}}>
                      <div style={{fontWeight:800,fontSize:16,color:rsColor(s.rs)}}>{s.rs}</div>
                      <div style={{fontSize:10,color:s.chg>=0?C.green:C.red}}>{s.chg>=0?'+':''}{s.chg?.toFixed(2)}%</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Guppy (GMMA) Crossover Section */}
            <div style={{background:C.card,border:`1px solid ${C.green}44`,borderRadius:12,padding:'14px',marginBottom:14}}>
              <div style={{fontWeight:800,fontSize:14,color:C.green,marginBottom:4}}>🐠 Guppy (GMMA) Crossover</div>
              <div style={{fontSize:11,color:C.muted,marginBottom:10}}>
                Short-term EMA group just crossed above the long-term EMA group — short-term momentum picking up ahead of the longer trend
              </div>
              <TVCopyPanel stocks={stocks.filter(s=>s.isGuppyBullishCrossover&&passesMcap(s))} label="Guppy Crossovers"/>
              <div style={{display:'flex',flexDirection:'column',gap:8,maxHeight:300,overflowY:'auto'}}>
                {stocks.filter(s=>s.isGuppyBullishCrossover&&passesMcap(s)).length===0?(
                  <div style={{textAlign:'center',padding:'20px 0',color:C.muted,fontSize:12}}>
                    No Guppy crossovers right now.
                  </div>
                ):stocks.filter(s=>s.isGuppyBullishCrossover&&passesMcap(s)).sort((a,b)=>b.rs-a.rs).slice(0,20).map(s=>(
                  <div key={s.sym} onClick={()=>setChartSym(s.sym)} style={{background:C.bg,borderRadius:8,padding:'10px 12px',
                    display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer'}}>
                    <div>
                      <div style={{fontWeight:800,fontSize:13}}>{s.sym}</div>
                      <div style={{fontSize:10,color:C.muted}}>{s.sector}</div>
                    </div>
                    <div style={{textAlign:'right'}}>
                      <div style={{fontWeight:800,fontSize:16,color:rsColor(s.rs)}}>{s.rs}</div>
                      <div style={{fontSize:10,color:s.chg>=0?C.green:C.red}}>{s.chg>=0?'+':''}{s.chg?.toFixed(2)}%</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* HY/HT Breakout list */}
            <TVCopyPanel stocks={stocks.filter(s=>calcHYHTBreakout(s).isBreakout&&passesMcap(s))} label="HY/HT Breakouts"/>
            {stocks.filter(s=>calcHYHTBreakout(s).isBreakout&&passesMcap(s)).length===0?(
              <div style={{textAlign:'center',padding:'60px 0',color:C.muted}}>
                <div style={{fontSize:42,marginBottom:12}}>💥</div>
                <div style={{fontSize:14,fontWeight:700,color:C.text}}>No breakouts today</div>
                <div style={{fontSize:12,marginTop:6,color:C.muted}}>
                  Stocks need HY/HT volume in last 5 days + price up &gt;1% today
                </div>
              </div>
            ):stocks.filter(s=>calcHYHTBreakout(s).isBreakout&&passesMcap(s))
              .sort((a,b)=>b.rs-a.rs)
              .map((s,i)=>{
                const bo=calcHYHTBreakout(s)
                const ibv=calcIBV(s)
                const stage=calcWeinsteinStage(s)
                return(
                  <div key={s.sym} onClick={()=>setChartSym(s.sym)} style={{background:C.card,
                    border:`2px solid ${bo.color}55`,cursor:'pointer',
                    borderRadius:12,marginBottom:10,padding:'14px'}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8}}>
                      <div>
                        <div style={{fontWeight:800,fontSize:16}}>{s.sym}</div>
                        <div style={{fontSize:11,color:C.muted}}>{s.sector}</div>
                        <div style={{display:'flex',gap:4,marginTop:6,flexWrap:'wrap'}}>
                          <div style={{padding:'3px 8px',borderRadius:6,fontSize:10,fontWeight:800,
                            background:bo.color+'22',color:bo.color}}>{bo.strength}</div>
                          <StageBadge stage={stage}/>
                          {(()=>{
                            const top = topVolumeSignal(s)
                            return <>
                              {top==='ht'&&<Badge color={C.orange}>🎯HT</Badge>}
                              {top==='hy'&&<Badge color={C.pink}>📊HY</Badge>}
                              {top==='ibv'&&<div style={{padding:'3px 8px',borderRadius:6,fontSize:10,fontWeight:700,
                                background:C.blue+'22',color:C.blue}}>🏛️ IBV {ibv.ppCount}d</div>}
                              {top==='pp'&&<Badge color={C.green}>🔥PP</Badge>}
                            </>
                          })()}
                        </div>
                      </div>
                      <div style={{textAlign:'right'}}>
                        <div style={{fontWeight:900,fontSize:22,color:rsColor(s.rs)}}>{s.rs}</div>
                        <div style={{fontWeight:700,fontSize:14,color:C.green}}>+{bo.chg}%</div>
                        <div style={{fontSize:11,color:C.muted}}>{fmtP(s.last)}</div>
                      </div>
                    </div>
                    <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:6}}>
                      {[
                        ['RS',s.rs,rsColor(s.rs)],
                        ['Chg',`+${bo.chg}%`,C.green],
                        ['PP 5d',`${bo.recentPPCount}×`,C.orange],
                        ['Trend',trendIcon(s.rsTrend?.trend||'flat'),trendColor(s.rsTrend?.trend||'flat')],
                      ].map(([k,v,c])=>(
                        <div key={k} style={{background:C.bg,borderRadius:7,padding:'8px',textAlign:'center'}}>
                          <div style={{fontSize:9,color:C.muted,marginBottom:2}}>{k}</div>
                          <div style={{fontWeight:800,fontSize:13,color:c}}>{v}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{marginTop:8}}>
                      <TopSignalDots s={s} withCount={false}/>
                    </div>
                  </div>
                )
              })
            }
          </div>
        )}

        {/* ══ 52WL ══ */}
        {mainTab==='52wl'&&(
          <div>
            <LastUpdatedBar
              scanMeta={scanMeta} lastRefresh={lastRefresh} loading={loading}
              autoRefresh={autoRefresh} setAutoRefresh={setAutoRefresh}
              refreshInterval={refreshInterval} setRefreshInterval={setRefreshInterval}
              onRefresh={runDBScan}
            />

            {displayed52WL.length>0&&<TVCopyPanel stocks={displayed52WL} label="52WL Crossover"/>}
            <div style={{background:C.card,border:`1px solid ${C.pink}44`,borderRadius:12,padding:'14px',marginBottom:14}}>
              <div style={{fontWeight:800,fontSize:15,color:C.pink,marginBottom:6}}>🎯 52-Week Low Crossover</div>
              <div style={{fontSize:12,color:C.muted,marginBottom:12}}>Within 15% of 52W low · crossed 5-EMA · PP-style volume</div>
              <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                {[{l:'Near 52WL',v:stocks.filter(s=>s.scanner52wl.near52wLow).length,c:C.yellow},
                  {l:'🎯 Full Signal',v:stocks.filter(s=>s.scanner52wl.isSignal).length,c:C.pink},
                  {l:'EMA5 ✅',v:stocks.filter(s=>s.scanner52wl.crossedAboveEMA5).length,c:C.green},
                  {l:'PP Vol ✅',v:stocks.filter(s=>s.scanner52wl.ppVolume).length,c:C.orange}].map(({l,v,c})=>(
                  <div key={l} style={{flex:'1 1 80px',background:C.bg,borderRadius:8,padding:'10px 12px',textAlign:'center'}}>
                    <div style={{fontSize:20,fontWeight:800,color:c}}>{v}</div>
                    <div style={{fontSize:10,color:C.muted,marginTop:2}}>{l}</div>
                  </div>
                ))}
              </div>
            </div>
            {wlBase.length>0&&(
              <>
                <PPFilterBar ppFilter={ppFilter52WL} setPpFilter={setPpFilter52WL}
                  ppCount={wlBase.filter(s=>s.pp.isPP).length} total={displayed52WL.length}/>
                <div style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap'}}>
                  <button onClick={()=>setWlSigOnly(v=>!v)}
                    style={{padding:'8px 14px',borderRadius:20,border:`1px solid ${wlSigOnly?C.pink:C.border}`,
                      cursor:'pointer',fontSize:12,fontWeight:600,
                      background:wlSigOnly?C.pink+'22':'transparent',color:wlSigOnly?C.pink:C.muted}}>
                    🎯 Full Signal Only
                  </button>
                  <input placeholder="Search…" value={wlSearch} onChange={e=>setWlSearch(e.target.value)}
                    style={{flex:1,minWidth:100,padding:'8px 12px',background:C.card,border:`1px solid ${C.border}`,borderRadius:8,color:C.text,fontSize:13,outline:'none'}}/>
                </div>
              </>
            )}
            {displayed52WL.length>0?displayed52WL.map((s,i)=>(
              <div key={s.sym} style={{background:C.card,border:`1px solid ${s.scanner52wl.isSignal?C.pink+'88':C.border}`,
                borderRadius:12,marginBottom:10,padding:'14px'}}>
                <div style={{display:'flex',justifyContent:'space-between',marginBottom:8}}>
                  <div>
                    <div style={{fontWeight:800,fontSize:16}}>{s.sym}</div>
                    <div style={{fontSize:11,color:C.muted}}>{s.sector}</div>
                    <div style={{display:'flex',gap:4,marginTop:4}}>
                      {s.scanner52wl.isSignal&&<Badge color={C.pink} glow>🎯 Full Signal</Badge>}
                      {topVolumeSignal(s)==='pp'&&<Badge color={C.green}>🔥PP</Badge>}
                    </div>
                  </div>
                  <div style={{textAlign:'right'}}>
                    <div style={{fontWeight:800,fontSize:18}}>{fmtP(s.last)}</div>
                    <div style={{color:s.chg>=0?C.green:C.red,fontWeight:700}}>{s.chg>=0?'+':''}{s.chg.toFixed(2)}%</div>
                  </div>
                </div>
                <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:8}}>
                  {[[s.scanner52wl.near52wLow,`52WL +${s.scanner52wl.pctFrom52wLow}%`,C.yellow],
                    [s.scanner52wl.crossedAboveEMA5,'5-EMA Cross',C.green],
                    [s.scanner52wl.ppVolume,`PP Vol ${s.scanner52wl.volRatio}x`,C.orange]].map(([ok,label,color])=>(
                    <div key={label} style={{padding:'5px 10px',borderRadius:20,fontSize:11,fontWeight:700,
                      background:ok?color+'22':C.border,color:ok?color:C.muted}}>{ok?'✅':'❌'} {label}</div>
                  ))}
                </div>
                <TopSignalDots s={s}/>
              </div>
            )):(
              <div style={{textAlign:'center',padding:'60px 0',color:C.muted}}>
                <div style={{fontSize:42,marginBottom:12}}>🎯</div>
                <div style={{fontSize:14,fontWeight:700,color:C.text}}>No 52WL stocks</div>
                <div style={{fontSize:12,marginTop:6}}>Run a scan first.</div>
              </div>
            )}
          </div>
        )}

        {/* ══ WEAK RS ══ */}
        {mainTab==='weak'&&(
          <div>
            <LastUpdatedBar
              scanMeta={scanMeta} lastRefresh={lastRefresh} loading={loading}
              autoRefresh={autoRefresh} setAutoRefresh={setAutoRefresh}
              refreshInterval={refreshInterval} setRefreshInterval={setRefreshInterval}
              onRefresh={runDBScan}
            />

            {displayedWeak.length>0&&<TVCopyPanel stocks={displayedWeak} label={`Weak RS > +${weakThreshold}%`}/>}
            <div style={{background:C.card,border:`1px solid ${C.lime}44`,borderRadius:12,padding:'14px',marginBottom:14}}>
              <div style={{fontWeight:800,fontSize:15,color:C.lime,marginBottom:6}}>🚨 Weak RS + Big Move</div>
              <div style={{fontSize:12,color:C.muted,marginBottom:12}}>RS &lt; 50 but moved more than +{weakThreshold}% today.</div>
              <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginBottom:12}}>
                <span style={{fontSize:12,color:C.muted,fontWeight:600}}>Threshold:</span>
                {[5,8,10,15].map(v=>(
                  <button key={v} onClick={()=>setWeakThreshold(v)}
                    style={{padding:'5px 12px',borderRadius:20,border:`1px solid ${weakThreshold===v?C.lime:C.border}`,
                      cursor:'pointer',fontSize:12,fontWeight:700,
                      background:weakThreshold===v?C.lime+'22':'transparent',
                      color:weakThreshold===v?C.lime:C.muted}}>+{v}%</button>
                ))}
              </div>
              <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                {[{l:'Signals',v:displayedWeak.length,c:C.lime},{l:'Vol Spike',v:displayedWeak.filter(s=>s.weakRS.isVolSpike).length,c:C.orange},
                  {l:'PP Today',v:displayedWeak.filter(s=>s.pp.isPP).length,c:C.orange}].map(({l,v,c})=>(
                  <div key={l} style={{flex:'1 1 80px',background:C.bg,borderRadius:8,padding:'10px 12px',textAlign:'center'}}>
                    <div style={{fontSize:20,fontWeight:800,color:c}}>{v}</div>
                    <div style={{fontSize:10,color:C.muted,marginTop:2}}>{l}</div>
                  </div>
                ))}
              </div>
            </div>
            {weakBase.length>0&&(
              <PPFilterBar ppFilter={ppFilterWeak} setPpFilter={setPpFilterWeak}
                ppCount={weakBase.filter(s=>s.pp.isPP).length} total={displayedWeak.length}/>
            )}
            {displayedWeak.length>0?displayedWeak.map((s,i)=>(
              <div key={s.sym} style={{background:C.card,border:`1px solid ${C.lime}44`,borderRadius:12,marginBottom:10,padding:'13px 14px'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8}}>
                  <div>
                    <div style={{fontWeight:800,fontSize:15}}>{s.sym}</div>
                    <div style={{fontSize:11,color:C.muted}}>{s.sector}</div>
                    <div style={{display:'flex',gap:4,marginTop:4}}>
                      <Badge color={C.lime} glow>🚨 RS{s.rs} +{s.weakRS.chg1d}%</Badge>
                      {s.weakRS.isVolSpike&&<Badge color={C.orange}>📊{s.weakRS.volSpike}x</Badge>}
                      {topVolumeSignal(s)==='pp'&&<Badge color={C.green}>🔥PP</Badge>}
                    </div>
                  </div>
                  <div style={{textAlign:'right'}}>
                    <div style={{fontWeight:800,fontSize:18}}>{fmtP(s.last)}</div>
                    <div style={{fontWeight:700,fontSize:14,color:C.lime}}>+{s.weakRS.chg1d}%</div>
                    <div style={{fontSize:11,color:s.weakRS.chg5d>=0?C.green:C.red}}>5d: {s.weakRS.chg5d>=0?'+':''}{s.weakRS.chg5d}%</div>
                  </div>
                </div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8,marginBottom:8}}>
                  {[['RS',s.rs,rsColor(s.rs)],['1D',`+${s.weakRS.chg1d}%`,C.lime],
                    ['5D',`${s.weakRS.chg5d>=0?'+':''}${s.weakRS.chg5d}%`,s.weakRS.chg5d>=0?C.green:C.red],
                    ['Vol',`${s.weakRS.volSpike}x`,s.weakRS.isVolSpike?C.orange:C.muted]].map(([k,v,c])=>(
                    <div key={k} style={{background:C.bg,borderRadius:8,padding:'8px 10px',textAlign:'center'}}>
                      <div style={{fontSize:9,color:C.muted,marginBottom:2}}>{k}</div>
                      <div style={{fontWeight:800,fontSize:14,color:c}}>{v}</div>
                    </div>
                  ))}
                </div>
                <TopSignalDots s={s}/>
              </div>
            )):(
              <div style={{textAlign:'center',padding:'60px 0',color:C.muted}}>
                <div style={{fontSize:42,marginBottom:12}}>🚨</div>
                <div style={{fontSize:14,fontWeight:700,color:C.text}}>No signals found</div>
                <div style={{fontSize:12,marginTop:6}}>Try lowering threshold to +5%.</div>
              </div>
            )}
          </div>
        )}

        {/* ══ SECTOR ROTATION ══ */}
        {mainTab==='rotation'&&(()=>{
          const ROTATION_WINDOWS=[{label:'10D',days:10},{label:'1M',days:22},{label:'3M',days:66},{label:'6M',days:126},{label:'1Y',days:252}]
          const data=rotationData||[]
          const displayData=rotationSelectedIds.size>0 ? data.filter(s=>rotationSelectedIds.has(s.id)) : data
          const toggleSel=id=>setRotationSelectedIds(prev=>{
            const next=new Set(prev)
            next.has(id)?next.delete(id):next.add(id)
            return next
          })
          const xFor=level=>20+(Math.max(0,Math.min(100,level??50))/100)*580
          const maxAbsMom=Math.max(5,...displayData.map(s=>Math.abs(s.momentum||0)))
          const yFor=mom=>230-(Math.max(-maxAbsMom,Math.min(maxAbsMom,mom||0))/maxAbsMom)*205
          const quadColor=s=>{
            const leading=(s.level??50)>=50&&(s.momentum||0)>=0
            const improving=(s.level??50)<50&&(s.momentum||0)>=0
            const weakening=(s.level??50)>=50&&(s.momentum||0)<0
            return leading?C.green:improving?C.accent:weakening?C.orange:C.muted
          }
          const goTo=s=>{
            if(rotationScope==='sector'){setSectorFilter(s.id);setMainTab('rs')}
            else if(rotationScope==='index'){setExpandedIndex(s.id);setMainTab('indices')}
            else{setChartSym(s.id)}
          }
          const effectiveWlId=rotationWlId??activeWl??watchlists[0]?.id??null
          const effectiveWl=watchlists.find(w=>w.id===effectiveWlId)
          const maxAvailable=data.length?Math.max(...data.map(s=>s.windowDays||1)):0
          const requestedWindow=ROTATION_WINDOWS.find(w=>w.days===rotationWindow)
          const scopeLabel=rotationScope==='sector'?'Sector':rotationScope==='index'?'Index':'Watchlist'
          const levelLabel=rotationScope==='sector'?'avg RS':'RS-TV'
          return(
          <div style={{padding:'0 0 20px'}}>
            <div style={{marginBottom:12}}>
              <div style={{fontWeight:800,fontSize:15,color:C.accent}}>🔄 {scopeLabel} Rotation</div>
              <div style={{fontSize:12,color:C.muted,marginTop:2}}>
                Which {rotationScope==='watchlist'?'stocks':scopeLabel.toLowerCase()+'s'} are gaining or losing relative strength, and how fast.
                {rotationScope!=='watchlist'&&` Click to jump to that ${rotationScope==='sector'?'sector\u2019s filtered RS list':'index'}.`}
                {rotationScope==='watchlist'&&' Click a stock to open its chart.'}
              </div>
            </div>

            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14,flexWrap:'wrap',gap:10}}>
              <div style={{display:'flex',gap:4,background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:3}}>
                {[['sector','Sector'],['index','Index'],['watchlist','Watchlist']].map(([id,label])=>(
                  <button key={id} onClick={()=>{setRotationScope(id);setRotationSelectedIds(new Set())}}
                    style={{border:'none',background:rotationScope===id?C.accent+'22':'transparent',
                      color:rotationScope===id?C.accent:C.muted,fontSize:11,fontWeight:600,
                      padding:'6px 12px',borderRadius:6,cursor:'pointer'}}>{label}</button>
                ))}
              </div>
              <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
                <span style={{fontSize:11,color:C.muted,fontWeight:600}}>Window:</span>
                {ROTATION_WINDOWS.map(w=>(
                  <button key={w.days} onClick={()=>setRotationWindow(w.days)}
                    style={{padding:'5px 12px',borderRadius:20,border:`1px solid ${rotationWindow===w.days?C.accent:C.border}`,
                      cursor:'pointer',fontSize:12,fontWeight:700,
                      background:rotationWindow===w.days?C.accent+'22':'transparent',
                      color:rotationWindow===w.days?C.accent:C.muted}}>{w.label}</button>
                ))}
              </div>
            </div>

            {rotationScope==='watchlist'&&(
              watchlists.length===0?(
                <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:'14px',marginBottom:14,fontSize:12,color:C.muted}}>
                  No watchlists yet — create one from the Watchlist tab first.
                </div>
              ):(
                <div style={{marginBottom:14,display:'flex',alignItems:'center',gap:8}}>
                  <span style={{fontSize:11,color:C.muted,fontWeight:600}}>Watchlist:</span>
                  <select value={effectiveWlId||''} onChange={e=>{setRotationWlId(e.target.value);setRotationSelectedIds(new Set())}}
                    style={{padding:'5px 8px',background:C.card,border:`1px solid ${C.border}`,
                      borderRadius:6,color:C.text,fontSize:12,outline:'none',cursor:'pointer'}}>
                    {watchlists.map(w=><option key={w.id} value={w.id}>{w.name} ({w.stocks?.length||0})</option>)}
                  </select>
                </div>
              )
            )}

            {rotationScope==='watchlist'&&effectiveWl&&(effectiveWl.stocks?.length||0)===0&&(
              <div style={{textAlign:'center',padding:'60px 0',color:C.muted}}>
                <div style={{fontSize:42,marginBottom:12}}>📋</div>
                <div style={{fontSize:14,fontWeight:700,color:C.text}}>"{effectiveWl.name}" is empty</div>
                <div style={{fontSize:12,marginTop:6}}>Add some stocks to it first.</div>
              </div>
            )}

            {loadingRotation&&!rotationData&&(
              <div style={{textAlign:'center',padding:'60px 0',color:C.muted}}>Loading…</div>
            )}

            {rotationData&&rotationData.length===0&&!(rotationScope==='watchlist'&&(!effectiveWl||(effectiveWl.stocks?.length||0)===0))&&(
              <div style={{textAlign:'center',padding:'60px 0',color:C.muted}}>
                <div style={{fontSize:42,marginBottom:12}}>🔄</div>
                <div style={{fontSize:14,fontWeight:700,color:C.text}}>No history yet</div>
                <div style={{fontSize:12,marginTop:6}}>
                  {rotationScope==='index'
                    ?'Index-level history starts accumulating once index_history exists in Supabase — check backend logs if this persists.'
                    :'Needs a few days of daily snapshots to show rotation.'}
                </div>
              </div>
            )}

            {data.length>0&&(<>
              <div style={{marginBottom:14}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
                  <span style={{fontSize:11,fontWeight:700,color:C.muted}}>
                    FOCUS ON {rotationSelectedIds.size>0?`(${rotationSelectedIds.size} selected)`:'(showing all — tap to focus on a few)'}
                  </span>
                  {rotationSelectedIds.size>0&&(
                    <button onClick={()=>setRotationSelectedIds(new Set())}
                      style={{fontSize:11,fontWeight:700,color:C.accent,background:'transparent',
                        border:'none',cursor:'pointer',padding:'2px 4px'}}>Show all</button>
                  )}
                </div>
                <div style={{display:'flex',flexWrap:'wrap',gap:6,maxHeight:120,overflowY:'auto'}}>
                  {data.map(s=>{
                    const on=rotationSelectedIds.size===0||rotationSelectedIds.has(s.id)
                    return(
                      <button key={s.id} onClick={()=>toggleSel(s.id)}
                        style={{padding:'4px 10px',borderRadius:20,cursor:'pointer',fontSize:11,fontWeight:600,
                          border:`1px solid ${rotationSelectedIds.has(s.id)?C.accent:C.border}`,
                          background:rotationSelectedIds.has(s.id)?C.accent+'22':'transparent',
                          color:on?C.text:C.muted,opacity:on?1:0.55}}>
                        {s.label}
                      </button>
                    )
                  })}
                </div>
              </div>
              {requestedWindow&&maxAvailable>0&&maxAvailable<rotationWindow&&(
                <div style={{fontSize:11,color:C.yellow,background:C.yellow+'14',border:`1px solid ${C.yellow}33`,
                  borderRadius:8,padding:'8px 12px',marginBottom:12}}>
                  ⚠ Only {maxAvailable} day{maxAvailable===1?'':'s'} of history available yet — showing the full {maxAvailable}-day window
                  instead of the requested {requestedWindow.label}. This fills in automatically as more daily snapshots accumulate.
                </div>
              )}
              <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:16,marginBottom:16}}>
                <svg viewBox="0 0 620 460" style={{width:'100%',height:'auto',display:'block'}}>
                  <rect x="310" y="20" width="290" height="210" fill={C.green} opacity="0.06"/>
                  <rect x="20" y="20" width="290" height="210" fill={C.accent} opacity="0.06"/>
                  <rect x="20" y="230" width="290" height="210" fill={C.muted} opacity="0.08"/>
                  <rect x="310" y="230" width="290" height="210" fill={C.orange} opacity="0.06"/>
                  <line x1="310" y1="20" x2="310" y2="440" stroke={C.border} strokeWidth="1.5"/>
                  <line x1="20" y1="230" x2="600" y2="230" stroke={C.border} strokeWidth="1.5"/>
                  <text x="580" y="38" textAnchor="end" fontSize="11" fontWeight="700" fill={C.green}>LEADING</text>
                  <text x="40" y="38" textAnchor="start" fontSize="11" fontWeight="700" fill={C.accent}>IMPROVING</text>
                  <text x="40" y="428" textAnchor="start" fontSize="11" fontWeight="700" fill={C.muted}>LAGGING</text>
                  <text x="580" y="428" textAnchor="end" fontSize="11" fontWeight="700" fill={C.orange}>WEAKENING</text>
                  <text x="310" y="455" textAnchor="middle" fontSize="10" fill={C.muted}>{levelLabel.toUpperCase()} LEVEL →</text>
                  <text x="12" y="230" textAnchor="middle" fontSize="10" fill={C.muted} transform="rotate(-90 12 230)">MOMENTUM ({requestedWindow?.label||rotationWindow+'d'}) →</text>

                  {displayData.filter(s=>s.trail&&s.trail.length>0).map(s=>{
                    const l0=s.trail[0].level, tx=t=>xFor(t.level)
                    const ty=t=>yFor(t.level-l0)
                    const pathD=s.trail.map((t,i)=>`${i===0?'M':'L'} ${tx(t)} ${ty(t)}`).join(' ')
                    const cx=xFor(s.level), cy=yFor(s.momentum)
                    const r=rotationScope==='sector'?7+Math.min(6,(s.count||1)/3):7
                    const color=quadColor(s)
                    return(
                      <g key={s.id} style={{cursor:'pointer'}} onClick={()=>goTo(s)}>
                        <path d={pathD} fill="none" stroke={color} strokeWidth="1.5" opacity="0.55"/>
                        {/* Small hollow dots along the trail (every day except
                            the current one, which gets the solid dot below) —
                            same "beads on a string" look as a real RRG chart,
                            not just a bare line between two points. */}
                        {s.trail.slice(0,-1).map((t,i)=>(
                          <circle key={i} cx={tx(t)} cy={ty(t)} r="2.5" fill={C.bg} stroke={color} strokeWidth="1.2"/>
                        ))}
                        <circle cx={cx} cy={cy} r={r} fill={color}/>
                        <text x={cx+r+4} y={cy+4} fontSize="12" fontWeight="700" fill={C.text}>{s.label}</text>
                      </g>
                    )
                  })}
                </svg>
                <div style={{display:'flex',gap:14,flexWrap:'wrap',marginTop:10,paddingTop:10,borderTop:`1px solid ${C.divider}`}}>
                  {[['Leading — strong & still improving',C.green],['Improving — gaining strength',C.accent],
                    ['Weakening — losing momentum',C.orange],['Lagging — weak & still falling',C.muted]].map(([label,color])=>(
                    <div key={label} style={{display:'flex',alignItems:'center',gap:6,fontSize:10,color:C.muted}}>
                      <span style={{width:8,height:8,borderRadius:'50%',background:color,display:'inline-block'}}/>{label}
                    </div>
                  ))}
                </div>
              </div>

              <div style={{fontSize:11,fontWeight:700,color:C.muted,marginBottom:8}}>RANKED LIST</div>
              <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,overflow:'hidden'}}>
                {data.map((s,i)=>(
                  <div key={s.id} onClick={()=>goTo(s)}
                    style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,
                      padding:'11px 14px',borderBottom:i<data.length-1?`1px solid ${C.divider}`:'none',cursor:'pointer'}}>
                    <div style={{display:'flex',alignItems:'center',gap:10,minWidth:0}}>
                      <div style={{width:22,height:22,borderRadius:6,background:C.bg,display:'flex',
                        alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700,color:C.muted,flexShrink:0}}>
                        {s.rank??'—'}
                      </div>
                      <div style={{minWidth:0}}>
                        <div style={{fontWeight:700,fontSize:13}}>{s.label}</div>
                        <div style={{fontSize:10,color:C.muted,marginTop:2}}>{s.meta} · {levelLabel} {s.level}</div>
                      </div>
                    </div>
                    <div style={{display:'flex',alignItems:'center',gap:12,flexShrink:0}}>
                      <div style={{textAlign:'right'}}>
                        <div style={{fontWeight:800,fontSize:15,color:quadColor(s)}}>{s.level}</div>
                        {s.rankChange!=null&&(
                          <div style={{fontSize:10,fontWeight:700,color:s.rankChange>0?C.green:s.rankChange<0?C.red:C.muted}}>
                            {s.rankChange>0?'▲':s.rankChange<0?'▼':'–'} {s.rankChange!==0?Math.abs(s.rankChange):''}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>)}
          </div>
          )
        })()}

        {/* ══ ALERTS HISTORY ══ */}
        {mainTab==='alerts'&&(
          <div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
              <div>
                <div style={{fontWeight:800,fontSize:15,color:C.accent}}>🔔 Alerts History</div>
                <div style={{fontSize:12,color:C.muted,marginTop:2}}>
                  Squeeze, VCP, HY &amp; HT fires — same events that trigger your browser notifications,
                  including any that fired while this tab was closed.
                </div>
              </div>
              <button onClick={()=>{setLoadingAlerts(true);fetchRecentAlerts(150).then(setAlertsLog).finally(()=>setLoadingAlerts(false))}}
                style={{padding:'6px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:C.card,
                  color:C.muted,cursor:'pointer',fontSize:12,fontWeight:600}}>
                {loadingAlerts?'…':'↻ Refresh'}
              </button>
            </div>

            {loadingAlerts&&!alertsLog&&(
              <div style={{textAlign:'center',padding:'60px 0',color:C.muted}}>Loading…</div>
            )}

            {alertsLog&&alertsLog.length===0&&(
              <div style={{textAlign:'center',padding:'60px 0',color:C.muted}}>
                <div style={{fontSize:42,marginBottom:12}}>🔔</div>
                <div style={{fontSize:14,fontWeight:700,color:C.text}}>No alerts yet</div>
                <div style={{fontSize:12,marginTop:6}}>New squeeze, VCP, HY, and HT fires will show up here.</div>
              </div>
            )}

            {alertsLog&&alertsLog.length>0&&alertsLog.map((a,i)=>{
              const isVol = /HY|HT/.test(a.fire_type) && !/Squeeze|VCP/.test(a.fire_type)
              const badgeColor = isVol ? C.orange : C.accent
              const mins = Math.max(0, Math.round((Date.now()-new Date(a.fired_at).getTime())/60000))
              const ago = mins<1?'just now':mins<60?`${mins}m ago`:mins<1440?`${Math.round(mins/60)}h ago`:`${Math.round(mins/1440)}d ago`
              return (
                <div key={`${a.sym}-${a.fired_at}-${i}`} onClick={()=>setChartSym(a.sym)}
                  style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,
                    marginBottom:8,padding:'11px 13px',cursor:'pointer',
                    display:'flex',justifyContent:'space-between',alignItems:'center',gap:10}}>
                  <div style={{minWidth:0}}>
                    <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                      <span style={{fontWeight:800,fontSize:14}}>{a.sym}</span>
                      <Badge color={badgeColor}>{isVol?'🔊':'🔥'} {a.fire_type}</Badge>
                    </div>
                    <div style={{fontSize:11,color:C.muted,marginTop:3}}>
                      {a.sector||'—'} · RS {a.rs_tv??a.rs??'—'} · {ago}
                    </div>
                  </div>
                  <div style={{textAlign:'right',flexShrink:0}}>
                    <div style={{fontWeight:800,fontSize:14}}>{a.last_price!=null?fmtP(a.last_price):'—'}</div>
                    <div style={{fontWeight:700,fontSize:12,color:(a.chg_pct??0)>=0?C.green:C.red}}>
                      {a.chg_pct!=null?`${a.chg_pct>=0?'+':''}${a.chg_pct.toFixed(2)}%`:'—'}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* ══ SETTINGS ══ */}
        {mainTab==='settings'&&(
          <SettingsPanel session={session} onUpdate={s=>setSession(s)} onLogout={()=>{setSession(null);setShowAuth(false)}}
            themeKey={themeKey} switchTheme={switchTheme} ambient={ambient}/>
        )}

      </div>
      </div>

      {/* Quick settings — theme + ambient sound, always reachable from any
          tab via a floating button, instead of needing to navigate into
          Account Settings first. */}
      <div style={{position:'fixed',top:isMobile?12:16,right:isMobile?12:16,zIndex:60}}>
        <button onClick={()=>setShowQuickSettings(v=>!v)}
          style={{width:38,height:38,borderRadius:'50%',border:`1px solid ${C.border}`,
            background:C.card,color:C.text,fontSize:16,cursor:'pointer',
            display:'flex',alignItems:'center',justifyContent:'center',
            boxShadow:'0 4px 14px rgba(0,0,0,0.25)'}}>
          🎨
        </button>
        {showQuickSettings&&(
          <div style={{position:'absolute',top:46,right:0,width:260,background:C.card,
            border:`1px solid ${C.border}`,borderRadius:12,padding:14,
            boxShadow:'0 12px 32px rgba(0,0,0,0.35)'}}>
            <div style={{fontSize:11,fontWeight:700,color:C.muted,textTransform:'uppercase',
              letterSpacing:'0.06em',marginBottom:8}}>Appearance</div>
            <div style={{display:'flex',gap:6,marginBottom:16}}>
              {[['dark','🌙'],['light','☀️'],['midnight','🌌']].map(([key,icon])=>(
                <button key={key} onClick={()=>switchTheme(key)}
                  style={{flex:1,padding:'8px 0',borderRadius:8,cursor:'pointer',fontSize:16,
                    border:`1px solid ${themeKey===key?C.accent:C.border}`,
                    background:themeKey===key?C.accent+'18':C.bg}}>
                  {icon}
                </button>
              ))}
            </div>
            <div style={{fontSize:11,fontWeight:700,color:C.muted,textTransform:'uppercase',
              letterSpacing:'0.06em',marginBottom:8}}>Ambient Sound</div>
            <button onClick={ambient.toggle}
              style={{width:'100%',padding:'8px 0',borderRadius:8,cursor:'pointer',fontSize:12,fontWeight:600,
                border:`1px solid ${ambient.enabled?C.accent:C.border}`,
                background:ambient.enabled?C.accent+'18':C.bg,
                color:ambient.enabled?C.accent:C.muted,marginBottom:10}}>
              {ambient.enabled?'🔔 Enabled':'🔕 Disabled'}
            </button>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6,marginBottom:10}}>
              {AMBIENT_SOUNDS.map(([key,label])=>(
                <button key={key} onClick={()=>ambient.setSoundType(key)}
                  style={{padding:'6px 6px',borderRadius:6,cursor:'pointer',fontSize:10.5,fontWeight:600,
                    border:`1px solid ${ambient.soundType===key?C.accent:C.border}`,
                    background:ambient.soundType===key?C.accent+'18':C.bg,
                    color:ambient.soundType===key?C.accent:C.muted}}>
                  {label}
                </button>
              ))}
            </div>
            <input type="range" min={0} max={1} step={0.05} value={ambient.volume}
              onChange={e=>ambient.setVolume(+e.target.value)}
              style={{width:'100%'}}/>
            {ambient.enabled&&!ambient.playing&&(
              <div style={{fontSize:9.5,color:C.muted,marginTop:6}}>
                Will start on your next tap anywhere (browsers block silent autoplay).
              </div>
            )}
          </div>
        )}
      </div>

      {/* Global chart panel — works from any tab, right-docked on desktop,
          full-screen on mobile. Rendered once so swapping symbols updates
          the same panel instance in place. */}
      <ChartPanel
        sym={chartSym}
        wide={chartWide}
        onToggleWide={()=>setChartWide(v=>(v+1)%3)}
        onClose={()=>setChartSym(null)}
        isMobile={isMobile}
        symList={displayedRS.map(s=>s.sym)}
        onNavigate={setChartSym}
      />

      {/* Mobile bottom nav */}
      {isMobile&&(
        <>
          <div style={{position:'fixed',bottom:0,left:0,right:0,background:C.card,
            borderTop:`1px solid ${C.border}`,display:'flex',zIndex:40,
            paddingBottom:'env(safe-area-inset-bottom)'}}>
            {[
              ['rs','📊','RS'],['indices','🗂','Indices'],['rotation','🔄','Rotate'],['breakout','💥','Break'],['52wl','🎯','52WL'],
            ].map(([t,icon,label])=>(
              <button key={t} onClick={()=>setMainTab(t)}
                style={{flex:1,padding:'8px 1px 6px',background:'transparent',border:'none',
                  cursor:'pointer',display:'flex',flexDirection:'column',alignItems:'center',gap:2}}>
                <span style={{fontSize:15}}>{icon}</span>
                <span style={{fontSize:8,fontWeight:600,color:mainTab===t?C.accent:C.muted}}>{label}</span>
                {mainTab===t&&<div style={{width:14,height:2,background:C.accent,borderRadius:99}}/>}
              </button>
            ))}
            <button onClick={()=>setShowMoreMenu(true)}
              style={{flex:1,padding:'8px 1px 6px',background:'transparent',border:'none',
                cursor:'pointer',display:'flex',flexDirection:'column',alignItems:'center',gap:2}}>
              <span style={{fontSize:15}}>⋯</span>
              <span style={{fontSize:8,fontWeight:600,
                color:['breadth','squeeze','weak','portfolio','compare','watchlist','alerts','settings'].includes(mainTab)?C.accent:C.muted}}>More</span>
              {['breadth','squeeze','weak','portfolio','compare','watchlist','alerts','settings'].includes(mainTab)&&
                <div style={{width:14,height:2,background:C.accent,borderRadius:99}}/>}
            </button>
          </div>

          {/* More menu — bottom sheet with the less-frequently-used tabs */}
          {showMoreMenu&&(
            <div onClick={()=>setShowMoreMenu(false)}
              style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.55)',zIndex:50,
                display:'flex',alignItems:'flex-end'}}>
              <div onClick={e=>e.stopPropagation()}
                style={{background:C.card,width:'100%',borderTopLeftRadius:16,borderTopRightRadius:16,
                  padding:'8px 8px calc(20px + env(safe-area-inset-bottom))',
                  borderTop:`1px solid ${C.border}`}}>
                <div style={{width:36,height:4,background:C.border,borderRadius:99,margin:'8px auto 16px'}}/>
                <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:4}}>
                  {[
                    ['breadth','📈','Breadth'],['squeeze','🌀','Squeeze'],['weak','🚨','Weak'],
                    ['portfolio','💼','Portfolio'],['compare','⚖','Compare'],['watchlist','📋','Watchlist'],
                    ['alerts','🔔','Alerts'],['settings','⚙','Account'],
                  ].map(([t,icon,label])=>(
                    <button key={t} onClick={()=>{setMainTab(t);setShowMoreMenu(false)}}
                      style={{padding:'16px 8px',background:mainTab===t?C.accent+'18':'transparent',
                        border:`1px solid ${mainTab===t?C.accent:C.border}`,borderRadius:10,cursor:'pointer',
                        display:'flex',flexDirection:'column',alignItems:'center',gap:6}}>
                      <span style={{fontSize:22}}>{icon}</span>
                      <span style={{fontSize:11,fontWeight:600,color:mainTab===t?C.accent:C.text}}>{label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
