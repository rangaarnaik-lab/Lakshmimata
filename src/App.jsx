import { useState, useEffect, useCallback, useRef } from 'react'
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, 
  Tooltip, ResponsiveContainer, ReferenceLine, Legend } from 'recharts'
import { supabase, fetchOwnerToken } from './lib/supabase'
import { fetchStocksFromDB, fetchSectorsFromDB, fetchScanMeta, fetchAvailableHistoryDates, fetchIndexDashboard } from './lib/db'
import {
  calcRSRaw, percentileRank, buildRSHistory, rsSlope,
  detectPP, calcHY, calcHT, calcNearEMA9,
  detect52WLCrossover, detectWeakRSBigMove, buildSectorRS
} from './scanners/math'
import { SECTOR_MAP, NIFTY50, MIDCAP, SMALLCAP, getSector } from './data/sectors'

// ─────────────────────────────────────────────────────────────────────
// 🔑 YOUR UPSTOX TOKEN — set this so users don't need to enter anything
// Leave empty string "" to require users to enter their own token
// ─────────────────────────────────────────────────────────────────────
let OWNER_TOKEN = import.meta.env.VITE_OWNER_UPSTOX_TOKEN || ''

// ── Colors ────────────────────────────────────────────────────────────
const C = {
  bg:'#0a0d12',card:'#0e1117',border:'#1c2333',
  accent:'#4f8ef7',text:'#e2e8f0',muted:'#4a5568',
  green:'#22c55e',red:'#ef4444',yellow:'#eab308',
  purple:'#a855f7',orange:'#f97316',blue:'#3b82f6',
  pink:'#ec4899',lime:'#84cc16',teal:'#14b8a6',
  sidebar:'#080b10',divider:'#161b27',
  rowHover:'#121824',active:'#1a2035',
}

const sectors_fallback = [
  {sector:'Defence',avgRS:88,chgD:1.2,chgW:3.4},
  {sector:'Pharma', avgRS:84,chgD:2.1,chgW:4.8},
  {sector:'Realty',  avgRS:82,chgD:0.8,chgW:2.1},
]

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
  const hist = s.hist || []
  // We need price + volume history — use rs_hist as proxy
  // IBV score = count of big up days with high volume vs down days
  const rs = s.rs || 0
  const trend = s.rsTrend?.trend || 'flat'
  const ppCount = s.pp?.ppCount10d || 0
  const chg = s.chg || 0

  // IBV signals:
  // 1. Multiple PP days in last 10 (institutional buying)
  // 2. RS improving
  // 3. Price up today
  const ibvScore = (ppCount >= 3 ? 3 : ppCount) +
                   (trend === 'improving' ? 2 : 0) +
                   (chg > 0 ? 1 : 0) +
                   (rs >= 70 ? 1 : 0)

  const isIBV = ppCount >= 2 && trend !== 'declining' && rs >= 50
  return {
    isIBV,
    ibvScore,
    ppCount,
    label: ibvScore >= 5 ? '🏛️ Strong IBV' : ibvScore >= 3 ? '🏛️ IBV' : 'No IBV',
    color: ibvScore >= 5 ? C.purple : ibvScore >= 3 ? C.blue : C.muted,
    desc: `${ppCount} PP days, score ${ibvScore}/7`
  }
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
  {id:'ibv',       label:'IBV',          icon:'🏛️', desc:'Institutional Buying Volume — 2+ PP days'},
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
// shows two copy buttons: Pine Script list + NSE:SYM format
function TVCopyPanel({stocks,label,compact}){
  // compact=true → single "Export to TradingView" button style (for top bar)
  const {copy,copied}=useCopy()
  if(!stocks||stocks.length===0)return null
  const syms=stocks.map(s=>s.sym)
  const pineScript=syms.join(',')
  const tvFormat=syms.map(s=>`NSE:${s}`).join(',')
  const alertStr=syms.map(s=>`NSE:${s}`).join('\n')
  if(compact){
    return(
      <div style={{display:'flex',gap:4}}>
        <button onClick={()=>copy(pineScript,'pine')} title="Copy Pine Script watchlist"
          style={{padding:'5px 10px',borderRadius:6,border:'none',cursor:'pointer',
            background:copied==='pine'?C.green:C.teal,color:'#000',fontSize:11,fontWeight:700,whiteSpace:'nowrap'}}>
          {copied==='pine'?'✅ Copied':'📋 Pine'}
        </button>
        <button onClick={()=>copy(tvFormat,'tv')} title="Copy NSE:SYM format"
          style={{padding:'5px 10px',borderRadius:6,border:'none',cursor:'pointer',
            background:copied==='tv'?C.green:C.teal,color:'#000',fontSize:11,fontWeight:700,whiteSpace:'nowrap'}}>
          {copied==='tv'?'✅':'🔗 TV'} <span style={{background:'#00000033',borderRadius:4,padding:'0 4px',fontSize:10}}>{syms.length}</span>
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
      <button onClick={()=>copy(pineScript,'pine')} title="Paste in watchlist box"
        style={{padding:'4px 10px',borderRadius:6,border:`1px solid ${C.teal}33`,cursor:'pointer',
          background:copied==='pine'?C.teal+'22':'transparent',
          color:copied==='pine'?C.teal:C.muted,fontSize:10,fontWeight:600,whiteSpace:'nowrap'}}>
        {copied==='pine'?'✅ Copied':'📋 Pine'}
      </button>
      <button onClick={()=>copy(tvFormat,'tv')} title="Paste in TV symbol search"
        style={{padding:'4px 10px',borderRadius:6,border:`1px solid ${C.teal}33`,cursor:'pointer',
          background:copied==='tv'?C.teal+'22':'transparent',
          color:copied==='tv'?C.teal:C.muted,fontSize:10,fontWeight:600,whiteSpace:'nowrap'}}>
        {copied==='tv'?'✅ Copied':'🔗 NSE:SYM'}
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

function _TVCopyPanelOld({stocks,label}){
  const {copy,copied}=useCopy()
  if(!stocks||stocks.length===0)return null
  const syms=stocks.map(s=>s.sym)
  const pineScript=syms.join(',')
  const tvFormat=syms.map(s=>`NSE:${s}`).join(',')
  const alertStr=syms.map(s=>`NSE:${s}`).join('\n')
  if(compact){
    return(
      <div style={{display:'flex',gap:4}}>
        <button onClick={()=>copy(pineScript,'pine')} title="Copy Pine Script watchlist"
          style={{padding:'5px 10px',borderRadius:6,border:'none',cursor:'pointer',
            background:copied==='pine'?C.green:C.teal,color:'#000',fontSize:11,fontWeight:700,whiteSpace:'nowrap'}}>
          {copied==='pine'?'✅ Copied':'📋 Pine'}
        </button>
        <button onClick={()=>copy(tvFormat,'tv')} title="Copy NSE:SYM format"
          style={{padding:'5px 10px',borderRadius:6,border:'none',cursor:'pointer',
            background:copied==='tv'?C.green:C.teal,color:'#000',fontSize:11,fontWeight:700,whiteSpace:'nowrap'}}>
          {copied==='tv'?'✅':'🔗 TV'} <span style={{background:'#00000033',borderRadius:4,padding:'0 4px',fontSize:10}}>{syms.length}</span>
        </button>
      </div>
    )
  }
  return(
    <div style={{background:C.card,border:`1px solid ${C.teal}44`,borderRadius:10,
      padding:'10px 14px',marginBottom:12}}>
      <div style={{fontSize:11,fontWeight:700,color:C.teal,marginBottom:8}}>
        📊 Copy to TradingView — {syms.length} stocks {label&&`(${label})`}
      </div>
      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
        <button onClick={()=>copy(pineScript,'pine')}
          style={{padding:'6px 14px',borderRadius:7,border:`1px solid ${C.teal}44`,cursor:'pointer',
            background:copied==='pine'?C.teal+'22':'transparent',
            color:copied==='pine'?C.teal:C.muted,fontSize:11,fontWeight:600}}>
          {copied==='pine'?'✅ Copied!':'📋 Pine Script list'}
        </button>
        <button onClick={()=>copy(tvFormat,'tv')}
          style={{padding:'6px 14px',borderRadius:7,border:`1px solid ${C.teal}44`,cursor:'pointer',
            background:copied==='tv'?C.teal+'22':'transparent',
            color:copied==='tv'?C.teal:C.muted,fontSize:11,fontWeight:600}}>
          {copied==='tv'?'✅ Copied!':'🔗 NSE:SYM format'}
        </button>
        <button onClick={()=>copy(alertStr,'alert')}
          style={{padding:'6px 14px',borderRadius:7,border:`1px solid ${C.teal}44`,cursor:'pointer',
            background:copied==='alert'?C.teal+'22':'transparent',
            color:copied==='alert'?C.teal:C.muted,fontSize:11,fontWeight:600}}>
          {copied==='alert'?'✅ Copied!':'🔔 Alert list (one/line)'}
        </button>
      </div>
      <div style={{marginTop:8,fontSize:10,color:C.muted,lineHeight:1.5}}>
        <strong style={{color:C.teal}}>Pine Script:</strong> paste in watchlist box &nbsp;·&nbsp;
        <strong style={{color:C.teal}}>NSE:SYM:</strong> paste in TV symbol search &nbsp;·&nbsp;
        <strong style={{color:C.teal}}>Alert list:</strong> one symbol per line for alert wizard
      </div>
    </div>
  )
}

// ── Micro components ──────────────────────────────────────────────────
function Badge({color,children,glow}){
  return<span style={{fontSize:10,fontWeight:700,padding:'2px 6px',borderRadius:4,
    background:color+'22',color,whiteSpace:'nowrap',boxShadow:glow?`0 0 6px ${color}66`:'none'}}>{children}</span>
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
function PPDots({ppHistory}){
  return(
    <div style={{display:'flex',gap:3,alignItems:'center'}}>
      {(ppHistory||[]).map((isPP,i)=>{
        const d=(ppHistory.length-1-i)
        return<div key={i} title={`${d===0?'Today':`${d}d ago`}: ${isPP?'PP ✅':'No PP'}`}
          style={{width:10,height:10,borderRadius:'50%',
            background:isPP?C.orange:C.border,
            boxShadow:isPP?`0 0 4px ${C.orange}`:'none'}}/>
      })}
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
    else if(p.id === 'pp')       counts[p.id] = stocks.filter(s=>s.pp?.isPP).length
    else if(p.id === 'ema9')     counts[p.id] = stocks.filter(s=>s.nearEMA9?.isNearEMA9).length
    else if(p.id === 'hy')       counts[p.id] = stocks.filter(s=>s.hy?.isHY).length
    else if(p.id === 'ht')       counts[p.id] = stocks.filter(s=>s.ht?.isHT).length
    else if(p.id === 'rs90')     counts[p.id] = stocks.filter(s=>(s.rsTv??s.rs)>=90).length
    else if(p.id === 'rs80')     counts[p.id] = stocks.filter(s=>(s.rsTv??s.rs)>=80).length
    else if(p.id === 'impr')     counts[p.id] = stocks.filter(s=>s.rsTrend?.trend==='improving').length
    else if(p.id === 'power')    counts[p.id] = stocks.filter(s=>s.pp?.isPP&&s.rs>=80).length
    else if(p.id === 's2')       counts[p.id] = stocks.filter(s=>calcWeinsteinStage(s).stage===2).length
    else if(p.id === 's1')       counts[p.id] = stocks.filter(s=>calcWeinsteinStage(s).stage===1).length
    else if(p.id === 's3')       counts[p.id] = stocks.filter(s=>calcWeinsteinStage(s).stage===3).length
    else if(p.id === 's4')       counts[p.id] = stocks.filter(s=>calcWeinsteinStage(s).stage===4).length
    else if(p.id === 'surge')    counts[p.id] = stocks.filter(s=>s.hy?.pctOfMax>=95).length
    else if(p.id === 'ibv')      counts[p.id] = stocks.filter(s=>calcIBV(s).isIBV).length
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
  const [showCreate,setShowCreate]=useState(false)
  const [wlName,setWlName]=useState('')
  const [manualSym,setManualSym]=useState('')
  const [editId,setEditId]=useState(null)
  const [editStocks,setEditStocks]=useState([])
  const [dragOver,setDragOver]=useState(false)
  const fileRef=useRef()
  const {copy,copied}=useCopy()

  const createWL=()=>{
    if(!wlName.trim())return
    const id=Date.now().toString()
    onSave({id,name:wlName.trim(),stocks:[],createdAt:Date.now()})
    setWlName('');setShowCreate(false);setEditId(id);setEditStocks([])
  }

  const addManual=()=>{
    const syms=manualSym.toUpperCase().split(/[\s,;]+/).map(s=>s.trim()).filter(Boolean)
    const deduped=[...new Set([...editStocks,...syms])]
    setEditStocks(deduped);setManualSym('')
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
    const wl=watchlists.find(w=>w.id===editId)
    if(!wl)return
    onSave({...wl,stocks:editStocks})
    setEditId(null);setEditStocks([])
  }

  const startEdit=wl=>{setEditId(wl.id);setEditStocks([...wl.stocks])}

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
        <button onClick={()=>setShowCreate(v=>!v)}
          style={{padding:'6px 13px',borderRadius:20,border:`1px solid ${C.green}44`,
            cursor:'pointer',fontSize:12,fontWeight:600,background:'transparent',color:C.green}}>
          + New Watchlist
        </button>
      </div>

      {/* Create new */}
      {showCreate&&(
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:'14px',marginBottom:12}}>
          <div style={{fontSize:12,fontWeight:700,color:C.text,marginBottom:8}}>New Watchlist</div>
          <div style={{display:'flex',gap:8}}>
            <input value={wlName} onChange={e=>setWlName(e.target.value)}
              onKeyDown={e=>e.key==='Enter'&&createWL()}
              placeholder="Watchlist name (e.g. My Top Picks)"
              style={{flex:1,padding:'8px 12px',background:C.bg,border:`1px solid ${C.border}`,
                borderRadius:8,color:C.text,fontSize:13,outline:'none'}}/>
            <button onClick={createWL}
              style={{padding:'8px 16px',borderRadius:8,border:'none',cursor:'pointer',
                background:C.green,color:'#000',fontWeight:700,fontSize:13}}>Create</button>
          </div>
        </div>
      )}

      {/* Edit panel */}
      {editId&&(()=>{
        const wl=watchlists.find(w=>w.id===editId)
        if(!wl)return null
        return(
          <div style={{background:C.card,border:`1px solid ${C.accent}44`,borderRadius:12,padding:'16px',marginBottom:12}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
              <div style={{fontWeight:800,fontSize:14,color:C.accent}}>✏️ Editing: {wl.name}</div>
              <div style={{display:'flex',gap:8}}>
                <button onClick={saveEdit}
                  style={{padding:'6px 14px',borderRadius:7,border:'none',cursor:'pointer',
                    background:C.accent,color:'#000',fontWeight:700,fontSize:12}}>💾 Save</button>
                <button onClick={()=>{setEditId(null);setEditStocks([])}}
                  style={{padding:'6px 14px',borderRadius:7,border:`1px solid ${C.border}`,cursor:'pointer',
                    background:'transparent',color:C.muted,fontWeight:600,fontSize:12}}>Cancel</button>
                <button onClick={()=>{onDelete(wl.id);setEditId(null);setEditStocks([])}}
                  style={{padding:'6px 14px',borderRadius:7,border:`1px solid ${C.red}44`,cursor:'pointer',
                    background:'transparent',color:C.red,fontWeight:600,fontSize:12}}>🗑 Delete</button>
              </div>
            </div>

            {/* Manual add */}
            <div style={{marginBottom:12}}>
              <div style={{fontSize:11,fontWeight:700,color:C.muted,marginBottom:6}}>Add stocks manually (comma or space separated)</div>
              <div style={{display:'flex',gap:8}}>
                <input value={manualSym} onChange={e=>setManualSym(e.target.value)}
                  onKeyDown={e=>e.key==='Enter'&&addManual()}
                  placeholder="RELIANCE, TCS, INFY..."
                  style={{flex:1,padding:'8px 12px',background:C.bg,border:`1px solid ${C.border}`,
                    borderRadius:8,color:C.text,fontSize:13,outline:'none',fontFamily:'monospace'}}/>
                <button onClick={addManual}
                  style={{padding:'8px 14px',borderRadius:8,border:'none',cursor:'pointer',
                    background:C.accent,color:'#000',fontWeight:700,fontSize:13}}>Add</button>
              </div>
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
        <button onClick={()=>copy(s.sym,'pine')}
          style={{padding:'5px 12px',borderRadius:7,border:`1px solid ${C.teal}44`,cursor:'pointer',
            background:copied==='pine'?C.teal+'22':'transparent',color:copied==='pine'?C.teal:C.muted,
            fontSize:11,fontWeight:600}}>
          {copied==='pine'?'✅ Copied!':'📋 Pine: '+s.sym}
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

      {/* PP 10-day */}
      <div style={{marginBottom:14}}>
        <div style={{fontSize:11,fontWeight:800,color:C.orange,marginBottom:8,textTransform:'uppercase'}}>🔥 Pocket Pivot — Last 10 Days</div>
        <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
          <PPDots ppHistory={s.pp.ppHistory||[]}/>
          <span style={{fontSize:12,color:C.orange,fontWeight:700}}>{s.pp.ppCount10d} PP in 10 days</span>
        </div>
        <div style={{fontSize:11,color:C.muted,marginTop:6}}>
          10-MA: <strong style={{color:C.text}}>{s.pp.ma10?fmtP(s.pp.ma10):'—'}</strong>&nbsp;·&nbsp;
          50-MA: <strong style={{color:C.text}}>{s.pp.ma50?fmtP(s.pp.ma50):'—'}</strong>&nbsp;·&nbsp;
          Vol: <strong style={{color:s.pp.isPP?C.orange:C.muted}}>{s.pp.volRatio}x</strong>
        </div>
      </div>

      {/* Stats */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
        {[
          ['RS-TV',s.rsTv!=null?s.rsTv:'—',s.rsTv!=null?rsColor(s.rsTv):C.muted],
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
    </div>
  )
}

function StockCard({s,i}){
  const [open,setOpen]=useState(false)
  return(
    <div style={{background:C.card,border:`1px solid ${open?C.accent+'55':C.border}`,
      borderRadius:12,marginBottom:10,overflow:'hidden'}}>
      <div onClick={()=>setOpen(o=>!o)} style={{padding:'14px 14px 12px',cursor:'pointer'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <div style={{width:28,height:28,borderRadius:7,background:rsColor(s.rs)+'22',
              border:`1px solid ${rsColor(s.rs)}55`,display:'flex',alignItems:'center',
              justifyContent:'center',fontSize:11,fontWeight:800,color:C.muted}}>{i+1}</div>
            <div>
              <div style={{fontWeight:800,fontSize:16}}>{s.sym}</div>
              <div style={{fontSize:10,color:C.muted}}>{s.sector}</div>
              <div style={{display:'flex',gap:4,marginTop:3,flexWrap:'wrap'}}>
                {s.pp.isPP&&<Badge color={C.orange}>🔥PP</Badge>}
                {s.hy.isHY&&<Badge color={C.blue}>📊HY</Badge>}
                {s.ht.isHT&&<Badge color={C.purple}>🚀HT</Badge>}
                {s.nearEMA9.isNearEMA9&&<Badge color={C.green} glow>⚡EMA9</Badge>}
                {s.pp.isPP&&s.rs>=80&&<Badge color={C.accent} glow>⭐Power</Badge>}
                    <StageBadge stage={calcWeinsteinStage(s)}/>
                    {calcIBV(s).isIBV&&<Badge color={C.purple}>🏛️IBV</Badge>}
                    {calcHYHTBreakout(s).isBreakout&&<Badge color={C.accent} glow>💥Break</Badge>}
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
          <div style={{display:'flex',gap:6,alignItems:'center'}}>
            <Sparkline data={s.hist} width={60} height={22} color={rsColor(s.rs)}/>
            <span style={{fontSize:14,color:C.muted}}>{open?'▲':'▼'}</span>
          </div>
        </div>
        <div style={{display:'flex',gap:2,marginBottom:6}}>
          {s.hist.slice(-7).map((v,idx)=>{
            const color=v===null?C.border:v>=90?C.green:v>=70?C.accent:v>=50?C.yellow:C.red
            return<div key={idx} style={{flex:1,height:26,borderRadius:4,background:color+'28',
              border:`1px solid ${color}55`,display:'flex',alignItems:'center',justifyContent:'center',
              fontSize:9,fontWeight:800,color}}>{v??'—'}</div>
          })}
        </div>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <span style={{fontSize:10,color:C.muted}}>PP 10d:</span>
          <PPDots ppHistory={s.pp.ppHistory||[]}/>
          <span style={{fontSize:10,color:s.pp.ppCount10d>0?C.orange:C.muted,fontWeight:700}}>{s.pp.ppCount10d}×</span>
        </div>
      </div>
      {open&&<StockDetail s={s}/>}
    </div>
  )
}

// ── TradingView Chart Modal ──────────────────────────────────────────
function TVChartModal({sym, onClose}){
  if(!sym) return null
  const tvSym = `NSE:${sym}`
  return(
    <div onClick={onClose}
      style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.85)',
        zIndex:1000,display:'flex',flexDirection:'column'}}>
      <div onClick={e=>e.stopPropagation()}
        style={{flex:1,display:'flex',flexDirection:'column',margin:'20px',
          background:'#0e1117',borderRadius:12,border:'1px solid #1c2333',
          overflow:'hidden'}}>
        {/* Header */}
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',
          padding:'10px 16px',borderBottom:'1px solid #1c2333',flexShrink:0}}>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <span style={{fontWeight:700,fontSize:16,color:'#e2e8f0'}}>{sym}</span>
            <a href={`https://www.tradingview.com/chart/?symbol=${tvSym}`}
              target="_blank" rel="noopener noreferrer"
              style={{fontSize:11,color:'#4f8ef7',textDecoration:'none'}}>
              Open in TradingView ↗
            </a>
          </div>
          <button onClick={onClose}
            style={{background:'transparent',border:'1px solid #1c2333',
              color:'#4a5568',fontSize:18,width:32,height:32,borderRadius:6,
              cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>
            ×
          </button>
        </div>
        {/* TradingView Widget iframe */}
        <iframe
          src={`https://s.tradingview.com/widgetembed/?frameElementId=tv_chart&symbol=${tvSym}&interval=D&hidesidetoolbar=0&symboledit=1&saveimage=0&toolbarbg=0e1117&studies=RSI%40tv-basicstudies&theme=dark&style=1&timezone=Asia%2FKolkata&withdateranges=1&showpopupbutton=0&studies_overrides=%7B%7D&overrides=%7B%7D&enabled_features=%5B%5D&disabled_features=%5B%5D&locale=en&utm_source=lakshmimata`}
          style={{flex:1,width:'100%',border:'none'}}
          allowFullScreen
        />
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
  const COLS='32px 130px 52px 48px 48px 52px 52px 60px 70px 58px 110px 140px 55px 55px 48px 48px 48px 55px 24px'
  return(
    <div style={{borderBottom:`1px solid ${C.border}22`}}>
      <div onClick={()=>setOpen(o=>!o)}
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

        {/* RS-TV — Pine Script / Lakshmi Mata formula only */}
        <div style={{textAlign:'center'}}>
          {(s.rsTv!=null&&s.rsTv>0)?(
            <>
              <div style={{fontWeight:700,fontSize:15,color:rsColor(s.rsTv),lineHeight:1}}>{s.rsTv}</div>
              <div style={{fontSize:7,color:C.teal,marginTop:1,fontWeight:700}}>TV</div>
            </>
          ):<span style={{color:C.muted,fontSize:11}}>—</span>}
        </div>

        {/* RS within Midcap */}
        <div style={{textAlign:'center'}} title={`RS rank if compared vs Midcap 150 stocks: ${s.rsMidcap??'N/A'}`}>
          {s.rsMidcap!=null?(
            <>
              <div style={{fontWeight:800,fontSize:13,color:rsColor(s.rsMidcap)}}>{s.rsMidcap}</div>
              <div style={{fontSize:7,color:C.blue,marginTop:1,fontWeight:600}}>MID</div>
            </>
          ):<span style={{color:C.border,fontSize:9}}>—</span>}
        </div>

        {/* RS within Smallcap */}
        <div style={{textAlign:'center'}} title={`RS rank if compared vs Smallcap 250 stocks: ${s.rsSmallcap??'N/A'}`}>
          {s.rsSmallcap!=null?(
            <>
              <div style={{fontWeight:800,fontSize:13,color:rsColor(s.rsSmallcap)}}>{s.rsSmallcap}</div>
              <div style={{fontSize:7,color:C.yellow,marginTop:1,fontWeight:600}}>SML</div>
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
        <div style={{display:'flex',flexDirection:'column',gap:3,alignItems:'center'}}>
          <PPDots ppHistory={s.pp.ppHistory||[]}/>
          <span style={{fontSize:9,color:s.pp.ppCount10d>0?C.orange:C.muted,fontWeight:700,whiteSpace:'nowrap'}}>
            {s.pp.ppCount10d}× PP
          </span>
        </div>

        {/* RS Last 7d */}
        <div style={{display:'flex',gap:2,alignItems:'center'}}>
          {s.hist.slice(-7).map((v,idx)=>{
            const color=v===null?C.border:v>=90?C.green:v>=70?C.accent:v>=50?C.yellow:C.red
            return<div key={idx} style={{flex:1,height:24,borderRadius:4,background:color+'28',
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

        {/* Expand */}
        <span style={{textAlign:'center',fontSize:10,color:C.muted}}>{open?'▲':'▼'}</span>
      </div>
      {open&&<StockDetail s={s}/>}
    </div>
  )
}

// ── Sector Panel ──────────────────────────────────────────────────────
function SectorPanel({sectorData,isMobile}){
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
                  <div style={{fontWeight:800,fontSize:14}}>#{sec.rank} {sec.sector}</div>
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
                {/* TV copy for sector */}
                <TVCopyPanel stocks={sec.members} label={sec.sector}/>
                <div style={{fontSize:11,fontWeight:700,color:C.muted,marginBottom:8,textTransform:'uppercase'}}>
                  All {sec.sector} stocks
                </div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))',gap:6}}>
                  {sec.members.sort((a,b)=>b.rs-a.rs).map(m=>(
                    <div key={m.sym} style={{background:C.bg,borderRadius:8,padding:'8px 10px'}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                        <span style={{fontWeight:700,fontSize:12}}>{m.sym}</span>
                        <span style={{fontWeight:800,fontSize:14,color:rsColor(m.rs)}}>{m.rs}</span>
                      </div>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:3}}>
                        <span style={{fontSize:10,color:m.chg>=0?C.green:C.red}}>
                          {m.chg>=0?'+':''}{m.chg.toFixed(1)}%</span>
                        {m.pp.isPP&&<Badge color={C.orange}>🔥</Badge>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Auth Screen ────────────────────────────────────────────────────────
function AuthScreen({onLogin}){
  const [mode,setMode]=useState('login') // login | register | forgot
  const [email,setEmail]=useState('')
  const [password,setPassword]=useState('')
  const [name,setName]=useState('')
  const [mobile,setMobile]=useState('')
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
        const{data:td}=await supabase.from('user_tokens').select('upstox_token').eq('user_id',data.user.id).single()
        onLogin({user:data.user,token:td?.upstox_token||OWNER_TOKEN})
      } else {
        // Register
        const{data,error:e}=await supabase.auth.signUp({
          email,password,
          options:{data:{full_name:name||email.split('@')[0]}}
        })
        if(e)throw e
        if(data.user&&upstoxToken){
          await supabase.from('user_tokens').upsert({user_id:data.user.id,upstox_token:upstoxToken})
        }
        setInfo('Account created! Check your email to confirm, then sign in.')
        setMode('login')
      }
    }catch(e){setError(e.message||'Auth error')}
    setLoading(false)
  }

  return(
    <div style={{minHeight:'100vh',background:C.bg,display:'flex',alignItems:'center',
      justifyContent:'center',padding:20,
      backgroundImage:`radial-gradient(ellipse at 20% 50%, ${C.accent}08 0%, transparent 50%),radial-gradient(ellipse at 80% 20%, ${C.purple}08 0%, transparent 50%)`}}>
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
                  placeholder={mode==='register'?'Min 6 characters':'Enter password'}
                  onKeyDown={e=>e.key==='Enter'&&handleEmailAuth()}
                  style={{width:'100%',padding:'12px 13px',background:C.bg,
                    border:`1px solid ${C.border}`,borderRadius:9,color:C.text,
                    fontSize:14,outline:'none',boxSizing:'border-box'}}/>
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
function SettingsPanel({session,onUpdate,onLogout}){
  const [newToken,setNewToken]=useState('')
  const [msg,setMsg]=useState('')
  const [loading,setLoading]=useState(false)
  const [profile,setProfile]=useState(null)
  const [sessionInfo,setSessionInfo]=useState(null)

  // Load profile + session info
  useEffect(()=>{
    if(!session) return
    // Load profile
    supabase.from('profiles').select('*').eq('id',session.user.id).single()
      .then(({data})=>setProfile(data))
    // Load session info
    supabase.from('user_sessions').select('*').eq('user_id',session.user.id).single()
      .then(({data})=>setSessionInfo(data))
  },[session])

  const saveToken = async()=>{
    setLoading(true)
    try{
      const {error}=await supabase.auth.updateUser({data:{upstox_token:newToken}})
      if(error) setMsg('Error: '+error.message)
      else{ setMsg('Token saved!'); onUpdate&&onUpdate({...session,user:{...session.user,user_metadata:{...session.user.user_metadata,upstox_token:newToken}}}) }
    }catch(e){ setMsg('Error saving') }
    setLoading(false)
  }

  const logoutAllDevices = async()=>{
    if(!confirm('This will log out ALL devices including this one. Continue?')) return
    // Delete session record — all devices will be forced out on next check
    await supabase.from('user_sessions').delete().eq('user_id',session.user.id)
    await supabase.auth.signOut()
    onLogout&&onLogout()
  }

  const user = session?.user
  const meta = user?.user_metadata||{}
  const createdAt = user?.created_at?new Date(user.created_at).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}):'—'
  const lastSeen = sessionInfo?.last_seen?new Date(sessionInfo.last_seen).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'—'

  return(
    <div style={{maxWidth:500,margin:'0 auto',padding:'0 0 40px'}}>

      {/* Profile card */}
      <div style={{background:C.card,border:`1px solid ${C.divider}`,borderRadius:12,
        padding:'20px',marginBottom:12}}>
        <div style={{display:'flex',alignItems:'center',gap:14,marginBottom:16}}>
          <div style={{width:48,height:48,borderRadius:'50%',
            background:`linear-gradient(135deg,${C.accent},#7c3aed)`,
            display:'flex',alignItems:'center',justifyContent:'center',
            fontWeight:700,fontSize:20,color:'#fff',flexShrink:0}}>
            {(meta.full_name||user?.email||'U')[0].toUpperCase()}
          </div>
          <div>
            <div style={{fontWeight:700,fontSize:15,color:C.text}}>
              {meta.full_name||'User'}
            </div>
            <div style={{fontSize:12,color:C.muted,marginTop:2}}>{user?.email}</div>
            {(meta.mobile||profile?.mobile)&&(
              <div style={{fontSize:11,color:C.muted,marginTop:1}}>
                📱 {meta.mobile||profile?.mobile}
              </div>
            )}
          </div>
        </div>

        {/* Account info grid */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
          {[
            {l:'Member Since', v:createdAt,       icon:'📅'},
            {l:'Last Login',   v:lastSeen,         icon:'🕐'},
            {l:'Device',       v:sessionInfo?.device_info?.split('(')[0]?.trim()?.slice(0,20)||'—', icon:'📱'},
            {l:'Status',       v:'Active',          icon:'🟢'},
          ].map(({l,v,icon})=>(
            <div key={l} style={{background:C.bg,borderRadius:8,padding:'10px'}}>
              <div style={{fontSize:9,color:C.muted,marginBottom:3}}>{icon} {l}</div>
              <div style={{fontSize:11,fontWeight:600,color:C.text}}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Security section */}
      <div style={{background:C.card,border:`1px solid ${C.divider}`,borderRadius:12,
        padding:'16px',marginBottom:12}}>
        <div style={{fontWeight:700,fontSize:13,color:C.text,marginBottom:12}}>
          🔒 Security
        </div>

        {/* Password reset */}
        <button onClick={async()=>{
          const {error}=await supabase.auth.resetPasswordForEmail(user?.email,{
            redirectTo: window.location.origin
          })
          if(!error) setMsg('Password reset email sent to '+user?.email)
          else setMsg('Error: '+error.message)
        }}
          style={{width:'100%',padding:'10px',borderRadius:8,
            border:`1px solid ${C.border}`,background:'transparent',
            color:C.text,fontSize:13,cursor:'pointer',textAlign:'left',marginBottom:8,
            display:'flex',alignItems:'center',gap:8}}>
          <span>🔑</span>
          <span>Reset Password</span>
          <span style={{marginLeft:'auto',color:C.muted,fontSize:11}}>Send email link</span>
        </button>

        {/* Logout all devices */}
        <button onClick={logoutAllDevices}
          style={{width:'100%',padding:'10px',borderRadius:8,
            border:`1px solid ${C.red}44`,background:C.red+'11',
            color:C.red,fontSize:13,cursor:'pointer',textAlign:'left',
            display:'flex',alignItems:'center',gap:8}}>
          <span>🚪</span>
          <span>Log Out All Devices</span>
          <span style={{marginLeft:'auto',fontSize:11,opacity:0.7}}>Forces logout everywhere</span>
        </button>

        {msg&&<div style={{fontSize:11,color:C.green,marginTop:8,padding:'6px 10px',
          background:C.green+'11',borderRadius:6}}>{msg}</div>}
      </div>

      {/* Upstox token */}
      <div style={{background:C.card,border:`1px solid ${C.divider}`,borderRadius:12,
        padding:'16px',marginBottom:12}}>
        <div style={{fontWeight:700,fontSize:13,color:C.text,marginBottom:4}}>
          🔗 Upstox Token
        </div>
        <div style={{fontSize:11,color:C.muted,marginBottom:10}}>
          {meta.upstox_token?'Token saved ✅ — paste new one to update':'No token saved yet'}
        </div>
        <textarea value={newToken} onChange={e=>setNewToken(e.target.value)}
          placeholder="Paste your Upstox access token here…"
          rows={3}
          style={{width:'100%',padding:'10px',background:C.bg,border:`1px solid ${C.border}`,
            borderRadius:8,color:C.text,fontSize:11,outline:'none',
            resize:'vertical',boxSizing:'border-box',fontFamily:'monospace'}}/>
        <button onClick={saveToken} disabled={loading||!newToken.trim()}
          style={{marginTop:8,width:'100%',padding:'10px',borderRadius:8,border:'none',
            background:newToken.trim()?C.accent:C.border,
            color:newToken.trim()?'#000':C.muted,
            fontWeight:700,fontSize:13,cursor:newToken.trim()?'pointer':'not-allowed'}}>
          {loading?'Saving…':'Save Token'}
        </button>
      </div>

      {/* Logout */}
      <button onClick={async()=>{
        await supabase.auth.signOut()
        onLogout&&onLogout()
      }}
        style={{width:'100%',padding:'12px',borderRadius:8,
          border:`1px solid ${C.border}`,background:'transparent',
          color:C.muted,fontSize:13,cursor:'pointer',fontWeight:600}}>
        Sign Out This Device
      </button>
    </div>
  )
}


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

// ── Breadth Charts Component ─────────────────────────────────────────
function BreadthCharts({history}){
  if(!history||history.length===0) return(
    <div style={{textAlign:'center',padding:'40px 20px',color:'#4a5568'}}>
      <div style={{fontSize:13}}>Historical data builds up daily after market close.</div>
      <div style={{fontSize:11,marginTop:4}}>Come back tomorrow to see trends!</div>
    </div>
  )

  const fmt = d => {
    const date = new Date(d)
    return `${date.getDate()}/${date.getMonth()+1}`
  }

  const chartStyle = {
    fontSize:9, fill:'#4a5568'
  }

  const CustomTooltip = ({active,payload,label})=>{
    if(!active||!payload?.length) return null
    return(
      <div style={{background:'#0e1117',border:'1px solid #1c2333',borderRadius:8,
        padding:'8px 12px',fontSize:11}}>
        <div style={{color:'#4a5568',marginBottom:4}}>{label}</div>
        {payload.map(p=>(
          <div key={p.name} style={{color:p.color,fontWeight:600}}>
            {p.name}: {typeof p.value==='number'?p.value.toFixed(2):p.value}
          </div>
        ))}
      </div>
    )
  }

  return(
    <div>
      {/* Chart 1: A/D Ratio trend */}
      <div style={{background:'#0e1117',border:'1px solid #1c2333',borderRadius:12,
        padding:'14px',marginBottom:12}}>
        <div style={{fontWeight:700,fontSize:13,color:'#e2e8f0',marginBottom:4}}>
          📈 Advance/Decline Ratio — 90 Days
        </div>
        <div style={{fontSize:10,color:'#4a5568',marginBottom:10}}>
          Above 1.0 = more stocks rising than falling (healthy)
        </div>
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={history} margin={{top:5,right:5,left:-20,bottom:0}}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1c2333"/>
            <XAxis dataKey="scan_date" tickFormatter={fmt} tick={chartStyle} interval="preserveStartEnd"/>
            <YAxis tick={chartStyle} domain={['auto','auto']}/>
            <Tooltip content={<CustomTooltip/>}/>
            <ReferenceLine y={1} stroke="#4a5568" strokeDasharray="4 4"/>
            <Line type="monotone"
              dataKey={d=>d.advances&&d.declines?+(d.advances/d.declines).toFixed(2):null}
              name="A/D Ratio" stroke="#22c55e" dot={false} strokeWidth={2}/>
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Chart 2: Advancing vs Declining bars */}
      <div style={{background:'#0e1117',border:'1px solid #1c2333',borderRadius:12,
        padding:'14px',marginBottom:12}}>
        <div style={{fontWeight:700,fontSize:13,color:'#e2e8f0',marginBottom:4}}>
          📊 Advancing vs Declining Stocks
        </div>
        <div style={{fontSize:10,color:'#4a5568',marginBottom:10}}>
          Green bars = stocks up, Red bars = stocks down each day
        </div>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={history} margin={{top:5,right:5,left:-20,bottom:0}} barGap={0}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1c2333"/>
            <XAxis dataKey="scan_date" tickFormatter={fmt} tick={chartStyle} interval="preserveStartEnd"/>
            <YAxis tick={chartStyle}/>
            <Tooltip content={<CustomTooltip/>}/>
            <Bar dataKey="advances" name="Advancing" fill="#22c55e" opacity={0.8}/>
            <Bar dataKey="declines" name="Declining" fill="#ef4444" opacity={0.8}/>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Chart 3: RS Improving vs Declining */}
      <div style={{background:'#0e1117',border:'1px solid #1c2333',borderRadius:12,
        padding:'14px',marginBottom:12}}>
        <div style={{fontWeight:700,fontSize:13,color:'#e2e8f0',marginBottom:4}}>
          ⚡ RS Improving vs Declining
        </div>
        <div style={{fontSize:10,color:'#4a5568',marginBottom:10}}>
          Rising blue line = more stocks gaining momentum (buy signal)
        </div>
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={history} margin={{top:5,right:5,left:-20,bottom:0}}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1c2333"/>
            <XAxis dataKey="scan_date" tickFormatter={fmt} tick={chartStyle} interval="preserveStartEnd"/>
            <YAxis tick={chartStyle}/>
            <Tooltip content={<CustomTooltip/>}/>
            <Line type="monotone" dataKey="rs_improving" name="RS Improving"
              stroke="#4f8ef7" dot={false} strokeWidth={2}/>
            <Line type="monotone" dataKey="rs_declining" name="RS Declining"
              stroke="#f97316" dot={false} strokeWidth={2}/>
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Chart 4: PP count + RS>=70 count */}
      <div style={{background:'#0e1117',border:'1px solid #1c2333',borderRadius:12,
        padding:'14px',marginBottom:12}}>
        <div style={{fontWeight:700,fontSize:13,color:'#e2e8f0',marginBottom:4}}>
          🔥 PP Signals + Strong RS (≥70) Stocks
        </div>
        <div style={{fontSize:10,color:'#4a5568',marginBottom:10}}>
          Rising PP count = institutional buying increasing
        </div>
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={history} margin={{top:5,right:5,left:-20,bottom:0}}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1c2333"/>
            <XAxis dataKey="scan_date" tickFormatter={fmt} tick={chartStyle} interval="preserveStartEnd"/>
            <YAxis tick={chartStyle}/>
            <Tooltip content={<CustomTooltip/>}/>
            <Line type="monotone" dataKey="pp_count" name="PP Signals"
              stroke="#eab308" dot={false} strokeWidth={2}/>
            <Line type="monotone" dataKey="rs_above_70" name="RS ≥ 70"
              stroke="#22c55e" dot={false} strokeWidth={2}/>
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Chart 5: New 52W Highs vs Lows */}
      <div style={{background:'#0e1117',border:'1px solid #1c2333',borderRadius:12,
        padding:'14px'}}>
        <div style={{fontWeight:700,fontSize:13,color:'#e2e8f0',marginBottom:4}}>
          🎯 New 52-Week Highs vs Lows
        </div>
        <div style={{fontSize:10,color:'#4a5568',marginBottom:10}}>
          More new highs than lows = bull market confirmation
        </div>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={history} margin={{top:5,right:5,left:-20,bottom:0}}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1c2333"/>
            <XAxis dataKey="scan_date" tickFormatter={fmt} tick={chartStyle} interval="preserveStartEnd"/>
            <YAxis tick={chartStyle}/>
            <Tooltip content={<CustomTooltip/>}/>
            <Bar dataKey="new_52w_high" name="52W Highs" fill="#14b8a6" opacity={0.8}/>
            <Bar dataKey="new_52w_low"  name="52W Lows"  fill="#ef4444" opacity={0.8}/>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}


// ── Horizontal Bar Chart Component ───────────────────────────────────
function HBarChart({data, valueKey, labelKey, colorFn, height=200, fmt=v=>v?.toFixed(1)+'%'}){
  if(!data||data.length===0) return(
    <div style={{textAlign:'center',padding:'20px',color:'#4a5568',fontSize:11}}>No data yet</div>
  )
  const max = Math.max(...data.map(d=>Math.abs(d[valueKey]||0)))
  return(
    <div style={{display:'flex',flexDirection:'column',gap:3}}>
      {data.slice(0,12).map((d,i)=>{
        const val = d[valueKey]||0
        const pct = max>0?Math.abs(val)/max*100:0
        const color = colorFn?colorFn(val):val>=0?'#22c55e':'#ef4444'
        return(
          <div key={i} style={{display:'flex',alignItems:'center',gap:6,fontSize:10}}>
            <div style={{width:42,textAlign:'right',color:'#4a5568',flexShrink:0,fontWeight:600}}>
              {fmt(val)}
            </div>
            <div style={{flex:1,background:'#161b27',borderRadius:3,height:20,overflow:'hidden'}}>
              <div style={{width:`${pct}%`,height:'100%',background:color,
                borderRadius:3,display:'flex',alignItems:'center',paddingLeft:6,
                minWidth:40,transition:'width 0.3s'}}>
                <span style={{fontSize:9,fontWeight:700,color:'#fff',
                  whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                  {d[labelKey]}
                </span>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Stock Mini Table ──────────────────────────────────────────────────
function StockMiniTable({stocks, cols, onChart}){
  if(!stocks||stocks.length===0) return(
    <div style={{textAlign:'center',padding:'16px',color:'#4a5568',fontSize:11}}>No data</div>
  )
  return(
    <div style={{overflowX:'auto'}}>
      <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
        <thead>
          <tr style={{borderBottom:'1px solid #1c2333'}}>
            {cols.map(c=>(
              <th key={c.key} style={{padding:'6px 8px',textAlign:c.align||'left',
                color:'#4a5568',fontWeight:600,fontSize:10,whiteSpace:'nowrap'}}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {stocks.slice(0,15).map((s,i)=>(
            <tr key={i} style={{borderBottom:'1px solid #161b27'}}
              onMouseEnter={e=>e.currentTarget.style.background='#121824'}
              onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
              {cols.map(c=>(
                <td key={c.key} style={{padding:'7px 8px',textAlign:c.align||'left',
                  color:c.colorFn?c.colorFn(s[c.key]):c.color||'#e2e8f0',
                  fontWeight:c.bold?700:400,whiteSpace:'nowrap'}}>
                  {c.key==='sym'?(
                    <span onClick={()=>onChart&&onChart(s.sym)}
                      style={{color:'#4f8ef7',cursor:'pointer',fontWeight:700}}>
                      {s[c.key]}
                    </span>
                  ):c.fmt?c.fmt(s[c.key]):s[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Section Card ──────────────────────────────────────────────────────
function SectionCard({title, subtitle, children, color='#4f8ef7'}){
  return(
    <div style={{background:'#0e1117',border:`1px solid ${color}22`,
      borderRadius:12,padding:'14px',marginBottom:12}}>
      <div style={{fontWeight:700,fontSize:13,color:'#e2e8f0',marginBottom:2}}>{title}</div>
      {subtitle&&<div style={{fontSize:10,color:'#4a5568',marginBottom:10}}>{subtitle}</div>}
      {children}
    </div>
  )
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App(){
  const isMobile=useIsMobile()
  const [session,setSession]=useState(null)
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
  const [mainTab,setMainTab]=useState('rs')

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
  const [presetFilter,setPresetFilter]=useState('all')
  const [chartSym,setChartSym]=useState(null)
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

  // Poll for new squeeze fires every minute
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
              const n = new Notification(
                `🔥 ${alert.sym} — Squeeze Fired!`,
                {
                  body: `${alert.fire_type} | RS: ${alert.rs_tv||alert.rs} | ${alert.chg_pct>=0?'+':''}${alert.chg_pct?.toFixed(2)}% | ${alert.sector}`,
                  icon: '/favicon.ico',
                  tag: `squeeze-${alert.sym}`,  // prevents duplicate for same stock
                  requireInteraction: false,
                }
              )
              // Click notification → switch to squeeze tab
              n.onclick = ()=>{
                window.focus()
                setMainTab('squeeze')
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
  const [chartWide,setChartWide]=useState(false)
  const [ppFilterRS,setPpFilterRS]=useState('all')
  const [ppFilter52WL,setPpFilter52WL]=useState('all')
  const [ppFilterWeak,setPpFilterWeak]=useState('all')

  // RS tab filters
  const [rsMin,setRsMin]=useState(0),[rsMax,setRsMax]=useState(99)
  const [rsImprFilter,setRsImprFilter]=useState('all')
  const [sigFilter,setSigFilter]=useState('all')
  const [search,setSearch]=useState(''),[sortBy,setSortBy]=useState('rs')
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
  const [breadthData,setBreadthData]=useState(null)
  const [portfolioHoldings,setPortfolioHoldings]=useState(()=>{
    try{return JSON.parse(localStorage.getItem('lm_portfolio')||'[]')}catch{return []}
  })
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
    setSectorData(buildSectorRS(processed,SECTOR_MAP))
    setProgress(100);setProgressMsg('Done!')
    setStocks(processed);setLastRefresh(Date.now());setLoading(false)
  },[session,indexFilter,weakThreshold,activeWl,watchlists])

  // Auto-refresh from DB every 1 minute — disabled while viewing a past date
  useEffect(()=>{
    clearInterval(refreshTimer.current)
    if(autoRefresh&&!historyDate){
      refreshTimer.current=setInterval(()=>runDBScan(),refreshInterval)
    }
    return()=>clearInterval(refreshTimer.current)
  },[autoRefresh,refreshInterval,runDBScan,historyDate])

  // Auto-load data on mount and every time session/date changes
  useEffect(()=>{
    if(session){
      runDBScan()  // always load immediately on login
    }
  },[session,historyDate])

  // ── Single device enforcement ─────────────────────────────────────
  // Generate a unique token for this browser tab/device
  const deviceToken = useRef(
    sessionStorage.getItem('lm_device_token') || 
    (()=>{ const t = Math.random().toString(36).slice(2)+Date.now(); sessionStorage.setItem('lm_device_token',t); return t })()
  )
  const [forcedOut, setForcedOut] = useState(false)

  // On login — register this device as the active session
  useEffect(()=>{
    if(!session) return
    const userId = session.user.id
    const token  = deviceToken.current

    // Write our token to Supabase
    const registerDevice = async()=>{
      await supabase.from('user_sessions').upsert({
        user_id:    userId,
        token:      token,
        last_seen:  new Date().toISOString(),
        device_info: navigator.userAgent.slice(0,100),
      }, {onConflict: 'user_id'})
    }
    registerDevice()

    // Poll every 30s — check if our token is still the active one
    const checkSession = async()=>{
      const {data} = await supabase
        .from('user_sessions')
        .select('token')
        .eq('user_id', userId)
        .single()
      if(data && data.token !== token){
        // Another device logged in — force logout
        setForcedOut(true)
        await supabase.auth.signOut()
        setSession(null)
      } else if(data) {
        // Still active — update last_seen
        await supabase.from('user_sessions').update({
          last_seen: new Date().toISOString()
        }).eq('user_id', userId)
      }
    }

    const timer = setInterval(checkSession, 30000)
    return ()=>clearInterval(timer)
  },[session])
  
  // Auto-refresh every minute when market is open
  useEffect(()=>{
    if(!session||!autoRefresh||historyDate) return
    const timer = setInterval(()=>{
      if(isMarketOpen()) runDBScan()
    }, refreshInterval)
    return ()=>clearInterval(timer)
  },[session,autoRefresh,refreshInterval,historyDate,runDBScan])

  // Load index dashboard and breadth data on tab switch
  useEffect(()=>{
    if(!session) return
    if(mainTab==='indices'){
      fetchIndexDashboard().then(setIndexData).catch(e=>console.error('Index fetch:',e))
    }
    if(mainTab==='breadth'){
      supabase.from('market_breadth').select('*')
        .order('scan_date',{ascending:true}).limit(90)
        .then(({data})=>setBreadthData(data||[]))
        .catch(e=>console.error('Breadth fetch:',e))
    }
  },[session,mainTab])

  // Save portfolio to localStorage whenever it changes
  useEffect(()=>{
    localStorage.setItem('lm_portfolio', JSON.stringify(portfolioHoldings))
  },[portfolioHoldings])

  // Filter helpers
  const applyPP=(list,f)=>f==='yes'?list.filter(s=>s.pp?.isPP):f==='no'?list.filter(s=>!s.pp?.isPP):list

  const rsBase=stocks.filter(s=>{
    if(!s.sym.toLowerCase().includes(search.toLowerCase()))return false
    if(s.rs<rsMin||s.rs>rsMax)return false
    if(rsImprFilter!=='all'&&s.rsTrend?.trend!==rsImprFilter)return false
    if(sigFilter==='pp'&&!s.pp?.isPP)return false
    if(sigFilter==='hy'&&!s.hy?.isHY)return false
    if(sigFilter==='ht'&&!s.ht?.isHT)return false
    if(sigFilter==='ema9'&&!s.nearEMA9?.isNearEMA9)return false
    if(sigFilter==='power'&&!(s.pp?.isPP&&s.rs>=80))return false
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
  })
  const displayedRS=applyPP(rsBase,ppFilterRS)

  const wlBase=stocks.filter(s=>s.scanner52wl.near52wLow&&s.sym.toLowerCase().includes(wlSearch.toLowerCase())&&(!wlSigOnly||s.scanner52wl.isSignal)).sort((a,b)=>a.scanner52wl.pctFrom52wLow-b.scanner52wl.pctFrom52wLow)
  const displayed52WL=applyPP(wlBase,ppFilter52WL)

  const weakBase=stocks.filter(s=>s.weakRS.chg1d>=weakThreshold&&s.rs<50&&s.sym.toLowerCase().includes(weakSearch.toLowerCase())&&(!weakSigOnly||s.weakRS.isSignal)).sort((a,b)=>b.weakRS.chg1d-a.weakRS.chg1d)
  const displayedWeak=applyPP(weakBase,ppFilterWeak)

  const tabs=[['rs','📊','RS'],['indices','🗂','Indices'],['breadth','📈','Breadth'],['squeeze','🌀','Squeeze'],['breakout','💥','Breakout'],['52wl','🎯','52WL'],['weak','🚨','Weak'],['sector','🏭','Sectors'],['portfolio','💼','Portfolio'],['compare','⚖','Compare'],['watchlist','📋','Watchlist'],['settings','⚙','Account']]

  if(authLoading)return(
    <div style={{minHeight:'100vh',background:C.bg,display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div style={{width:32,height:32,border:`3px solid ${C.accent}`,borderTopColor:'transparent',borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>
    </div>
  )
  if(!session)return <AuthScreen onLogin={s=>setSession(s)}/>

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
              {id:'sector',    label:'Sectors',   abbr:'SEC'},
              {id:'portfolio', label:'Portfolio', abbr:'PF'},
              {id:'compare',   label:'Compare',   abbr:'CMP'},
              {id:'watchlist', label:'Watchlist', abbr:'WL'},
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
                 mainTab==='weak'?'Weak RS':mainTab==='sector'?'Sectors':
                 mainTab==='watchlist'?'Watchlist':'Account'}
              </div>
              {!isMobile&&<div style={{fontSize:10,color:C.muted,marginTop:1}}>
                {session?.user?.email} · {scanLabel}
              </div>}
            </div>
          </div>

          {/* Controls */}
          {mainTab!=='settings'&&mainTab!=='watchlist'&&(
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
                <select value={historyDate||''} onChange={e=>setHistoryDate(e.target.value||null)}
                  style={{padding:'5px 8px',background:historyDate?C.purple+'22':C.card,
                    border:`1px solid ${historyDate?C.purple+'66':C.border}`,
                    borderRadius:6,color:historyDate?C.purple:C.text,fontSize:11,outline:'none',cursor:'pointer',
                    fontWeight:historyDate?700:400}}>
                  <option value="">📅 Today</option>
                  {availableDates.map(d=>(
                    <option key={d} value={d}>{new Date(d).toLocaleDateString('en-IN',{day:'2-digit',month:'short'})}</option>
                  ))}
                </select>
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
              <button onClick={()=>runDBScan()} disabled={loading}
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
        <div style={{padding:isMobile?'10px':'0',flex:1,overflowY:'auto',
          minHeight:0}}>

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
              onSave={saveWL} onDelete={deleteWL} allKnownStocks={[...new Set([...NIFTY50,...MIDCAP,...SMALLCAP])]}/>
          </div>
        )}

        {/* ══ RS SCANNER ══ */}
        {mainTab==='rs'&&(
          <div style={{display:'flex',gap:0,height:'calc(100vh - 52px)',overflow:'hidden'}}>

          {/* Left pane — stock list */}
          <div style={{flex:1,overflowY:'auto',minWidth:0,
            transition:'border 0.2s',
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
                <select value={historyDate||''} onChange={e=>setHistoryDate(e.target.value||null)}
                  style={{padding:'8px',background:historyDate?C.purple+'22':C.card,
                    border:`1px solid ${historyDate?C.purple+'66':C.border}`,borderRadius:8,
                    color:historyDate?C.purple:C.text,fontSize:11,outline:'none',fontWeight:historyDate?700:400}}>
                  <option value="">📅 Live</option>
                  {availableDates.map(d=>(
                    <option key={d} value={d}>{new Date(d).toLocaleDateString('en-IN',{day:'2-digit',month:'short'})}</option>
                  ))}
                </select>
                <button onClick={()=>runDBScan()} disabled={loading}
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
                  <strong style={{color:C.text}}>MID/SML/SEC</strong> =  percentile rank vs that index pool — shown for ALL stocks regardless of index membership, so you can compare any stock against each universe. &nbsp;·&nbsp;
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
                  {label:'🔥PP',val:stocks.filter(s=>s.pp.isPP).length,color:C.orange,f:'pp'},
                  {label:'⚡EMA9',val:stocks.filter(s=>s.nearEMA9.isNearEMA9).length,color:C.green,f:'ema9'},
                  {label:'📊HY',val:stocks.filter(s=>s.hy.isHY).length,color:C.blue,f:'hy'},
                  {label:'🚀HT',val:stocks.filter(s=>s.ht.isHT).length,color:C.purple,f:'ht'},
                  {label:'↑↑Impr',val:stocks.filter(s=>s.rsTrend.trend==='improving').length,color:C.green,f:'__impr'},
                ].map(({label,val,color,f})=>(
                  <div key={label} onClick={()=>{
                    if(f==='__impr')setRsImprFilter(v=>v==='improving'?'all':'improving')
                    else setSigFilter(v=>v===f?'all':f)
                  }} style={{flexShrink:0,padding:'8px 14px',borderRadius:20,cursor:'pointer',
                    background:C.card,border:`1px solid ${(f===sigFilter||(f==='__impr'&&rsImprFilter==='improving'))?color:C.border}`,textAlign:'center',minWidth:60}}>
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
                {showFilters&&(
                  <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:'14px'}}>
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
                      <div style={{fontSize:11,fontWeight:700,color:C.text,marginBottom:8}}>Signal</div>
                      <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                        {[['all','All',C.muted],['pp','🔥PP',C.orange],['hy','📊HY',C.blue],['ht','🚀HT',C.purple],['ema9','⚡EMA9',C.green],['power','⭐Power',C.accent]].map(([v,label,color])=>(
                          <button key={v} onClick={()=>setSigFilter(v)}
                            style={{padding:'6px 13px',borderRadius:20,border:`1px solid ${sigFilter===v?color:C.border}`,
                              cursor:'pointer',fontSize:12,fontWeight:600,
                              background:sigFilter===v?color+'22':'transparent',color:sigFilter===v?color:C.muted}}>{label}</button>
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
              isMobile?displayedRS.map((s,i)=><StockCard key={s.sym} s={s} i={i}/>):(
                <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden'}}>
                  <div style={{display:'grid',gridTemplateColumns:'32px 130px 52px 48px 48px 52px 52px 60px 70px 58px 110px 140px 55px 55px 48px 48px 48px 55px 24px',
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
                  </div>
                  {displayedRS.map((s,i)=><DesktopRow key={s.sym} s={s} i={i} onChart={()=>setChartSym(s.sym)}/>)}
                </div>
              )
            )}
          </div>

          {/* Right pane — inline TradingView chart */}
          {chartSym&&(
            <div style={{width:chartWide?'65%':'50%',minWidth:460,flexShrink:0,
              display:'flex',flexDirection:'column',background:C.sidebar,
              transition:'width 0.2s ease'}}>

              {/* Chart header bar */}
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',
                padding:'8px 14px',borderBottom:`1px solid ${C.divider}`,flexShrink:0,height:42}}>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <span style={{fontWeight:700,fontSize:14,color:C.text,letterSpacing:'0.01em'}}>
                    {chartSym}
                  </span>
                  <span style={{fontSize:10,color:C.muted,background:C.card,
                    padding:'1px 5px',borderRadius:3}}>NSE</span>
                  <a href={`https://www.tradingview.com/chart/?symbol=NSE:${chartSym}`}
                    target="_blank" rel="noopener noreferrer"
                    style={{fontSize:10,color:C.accent,textDecoration:'none',
                      padding:'2px 7px',borderRadius:4,border:`1px solid ${C.accent}33`,
                      display:'flex',alignItems:'center',gap:3}}>
                    TV ↗
                  </a>
                </div>
                <div style={{display:'flex',gap:4,alignItems:'center'}}>
                  <button onClick={()=>setChartWide(v=>!v)}
                    style={{background:'transparent',border:`1px solid ${C.border}`,
                      color:C.muted,fontSize:10,padding:'3px 8px',borderRadius:4,
                      cursor:'pointer',whiteSpace:'nowrap'}}>
                    {chartWide?'◀':'▶'}
                  </button>
                  <button onClick={()=>setChartSym(null)}
                    style={{background:'transparent',border:`1px solid ${C.border}`,
                      color:C.muted,fontSize:16,width:26,height:26,borderRadius:4,
                      cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',
                      lineHeight:1}}>×
                  </button>
                </div>
              </div>

              {/* TradingView iframe */}
              <iframe
                key={chartSym}
                src={`https://s.tradingview.com/widgetembed/?symbol=NSE%3A${encodeURIComponent(chartSym)}&interval=D&hidesidetoolbar=0&symboledit=1&saveimage=0&toolbarbg=0e1117&studies=RSI%40tv-basicstudies%1FVolume%40tv-basicstudies&theme=dark&style=1&timezone=Asia%2FKolkata&withdateranges=1&locale=en`}
                style={{flex:1,width:'100%',border:'none'}}
                allowFullScreen
              />
            </div>
          )}
        </div>
        )}

        {/* ══ INDICES DASHBOARD ══ */}
        {mainTab==='indices'&&(
          <div style={{padding:isMobile?'10px':'12px 16px'}}>

            {/* Header */}
            <div style={{marginBottom:14}}>
              <div style={{fontWeight:700,fontSize:16}}>Index Dashboard</div>
              <div style={{fontSize:11,color:C.muted}}>Top movers · Near 52W High · Stage 2 buys · Index strength</div>
            </div>

            {/* Summary strip */}
            {stocks.length>0&&(
              <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8,marginBottom:14}}>
                {[
                  {l:'Total',    v:stocks.length,                                      c:C.accent},
                  {l:'RS ≥ 80',  v:stocks.filter(s=>(s.rsTv||s.rs||0)>=80).length,    c:C.green},
                  {l:'Up Today', v:stocks.filter(s=>s.chg>0).length,                  c:C.green},
                  {l:'PP Today', v:stocks.filter(s=>s.pp?.isPP).length,               c:C.orange},
                ].map(({l,v,c})=>(
                  <div key={l} style={{background:C.card,border:`1px solid ${c}22`,
                    borderRadius:8,padding:'10px',textAlign:'center'}}>
                    <div style={{fontWeight:700,fontSize:18,color:c}}>{v}</div>
                    <div style={{fontSize:9,color:C.muted,marginTop:2}}>{l}</div>
                  </div>
                ))}
              </div>
            )}

            {/* 4 stock tables */}
            <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'1fr 1fr',gap:10,marginBottom:14}}>

              <SectionCard title="📈 Top Gainers Today" color={C.green}
                subtitle="Best RS stocks up today">
                <StockMiniTable
                  stocks={[...stocks].filter(s=>s.chg>0).sort((a,b)=>(b.rsTv||b.rs||0)-(a.rsTv||a.rs||0)).slice(0,10)}
                  onChart={s=>setChartSym(s===chartSym?null:s)}
                  cols={[
                    {key:'sym',  label:'Symbol'},
                    {key:'rsTv', label:'RS', align:'right', bold:true,
                      colorFn:v=>v>=90?C.green:v>=70?C.accent:v>=50?C.yellow:C.red},
                    {key:'chg',  label:'Chg%', align:'right',
                      colorFn:v=>v>=0?C.green:C.red,
                      fmt:v=>`+${v?.toFixed(1)}%`},
                    {key:'last', label:'Price', align:'right',
                      fmt:v=>v?`₹${v?.toLocaleString('en-IN')}`:'—'},
                  ]}/>
              </SectionCard>

              <SectionCard title="📉 Top Losers Today" color={C.red}
                subtitle="Biggest declines today">
                <StockMiniTable
                  stocks={[...stocks].filter(s=>s.chg<0).sort((a,b)=>a.chg-b.chg).slice(0,10)}
                  onChart={s=>setChartSym(s===chartSym?null:s)}
                  cols={[
                    {key:'sym',  label:'Symbol'},
                    {key:'rsTv', label:'RS', align:'right', bold:true,
                      colorFn:v=>v>=90?C.green:v>=70?C.accent:v>=50?C.yellow:C.red},
                    {key:'chg',  label:'Chg%', align:'right',
                      colorFn:_=>C.red,
                      fmt:v=>`${v?.toFixed(1)}%`},
                    {key:'last', label:'Price', align:'right',
                      fmt:v=>v?`₹${v?.toLocaleString('en-IN')}`:'—'},
                  ]}/>
              </SectionCard>

              <SectionCard title="🎯 Near 52-Week High" color={C.teal}
                subtitle="Within 3% of 52W high">
                <StockMiniTable
                  stocks={[...stocks].filter(s=>
                    s.pctFrom52wh!=null&&s.pctFrom52wh>=-3&&s.pctFrom52wh<=0&&
                    (s.rsTv||s.rs||0)>=60
                  ).sort((a,b)=>b.pctFrom52wh-a.pctFrom52wh).slice(0,10)}
                  onChart={s=>setChartSym(s===chartSym?null:s)}
                  cols={[
                    {key:'sym',         label:'Symbol'},
                    {key:'rsTv',        label:'RS',  align:'right', bold:true,
                      colorFn:v=>v>=90?C.green:v>=70?C.accent:C.yellow},
                    {key:'pctFrom52wh', label:'From High', align:'right',
                      colorFn:v=>v>=-1?C.green:v>=-3?C.yellow:C.muted,
                      fmt:v=>`${v?.toFixed(1)}%`},
                    {key:'chg', label:'Today', align:'right',
                      colorFn:v=>v>=0?C.green:C.red,
                      fmt:v=>`${v>=0?'+':''}${v?.toFixed(1)}%`},
                  ]}/>
              </SectionCard>

              <SectionCard title="🚀 Stage 2 Buy Signals" color={C.green}
                subtitle="PP + RS ≥ 70 — best setups today">
                <StockMiniTable
                  stocks={[...stocks].filter(s=>s.pp?.isPP&&(s.rsTv||s.rs||0)>=70)
                    .sort((a,b)=>(b.rsTv||b.rs||0)-(a.rsTv||a.rs||0)).slice(0,10)}
                  onChart={s=>setChartSym(s===chartSym?null:s)}
                  cols={[
                    {key:'sym',  label:'Symbol'},
                    {key:'rsTv', label:'RS',  align:'right', bold:true,
                      colorFn:v=>v>=90?C.green:v>=70?C.accent:C.yellow},
                    {key:'chg',  label:'Chg%', align:'right',
                      colorFn:v=>v>=0?C.green:C.red,
                      fmt:v=>`${v>=0?'+':''}${v?.toFixed(1)}%`},
                    {key:'last', label:'Price', align:'right',
                      fmt:v=>v?`₹${v?.toLocaleString('en-IN')}`:'—'},
                  ]}/>
              </SectionCard>
            </div>

            {/* Index strength bar charts */}
            {indexData.length>0&&(
              <div style={{marginBottom:14}}>
                <div style={{fontWeight:700,fontSize:14,color:C.text,marginBottom:10}}>
                  📊 Index Strength Rankings
                </div>
                <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'1fr 1fr 1fr',gap:10}}>
                  {[
                    {label:'Daily %',   key:'chgD'},
                    {label:'Weekly %',  key:'chgW'},
                    {label:'Monthly %', key:'chgM'},
                  ].map(({label,key})=>(
                    <SectionCard key={label} title={label} color={C.accent}>
                      <HBarChart
                        data={[...indexData].sort((a,b)=>(b[key]||0)-(a[key]||0))}
                        valueKey={key} labelKey="name"
                        colorFn={v=>v>=0?C.green:C.red}
                        fmt={v=>`${v>=0?'+':''}${v?.toFixed(1)}%`}/>
                    </SectionCard>
                  ))}
                </div>
              </div>
            )}

            {/* Index cards */}
            {indexData.length>0&&(
              <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'1fr 1fr',gap:10}}>
                {indexData.map(idx=>{
                  const sc={1:C.yellow,2:C.green,3:C.orange,4:C.red}[idx.stage]||C.muted
                  const sl={1:'S1 Base',2:'S2 Up',3:'S3 Top',4:'S4 Down'}[idx.stage]||'—'
                  return(
                    <div key={idx.name} style={{background:C.card,
                      border:`1px solid ${sc}33`,borderRadius:12,padding:'14px'}}>
                      <div style={{display:'flex',justifyContent:'space-between',marginBottom:8}}>
                        <div>
                          <div style={{fontWeight:700,fontSize:14}}>{idx.name}</div>
                          <div style={{fontSize:10,color:C.muted}}>
                            ₹{idx.lastPrice?.toLocaleString('en-IN')}
                          </div>
                          <div style={{marginTop:4}}>
                            <span style={{padding:'1px 6px',borderRadius:3,fontSize:8,
                              fontWeight:700,background:sc+'18',color:sc,border:`1px solid ${sc}33`}}>
                              {sl}
                            </span>
                          </div>
                        </div>
                        <div style={{textAlign:'center'}}>
                          <div style={{fontWeight:700,fontSize:24,
                            color:idx.rsTv>=90?C.green:idx.rsTv>=70?C.accent:idx.rsTv>=50?C.yellow:C.red,
                            lineHeight:1}}>{idx.rsTv||'—'}</div>
                          <div style={{fontSize:8,color:C.teal,fontWeight:600}}>RS-TV</div>
                        </div>
                      </div>
                      <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:3}}>
                        {[['1D',idx.chgD],['1W',idx.chgW],['1M',idx.chgM],['3M',idx.chgQ],['1Y',idx.chgY]].map(([l,v])=>(
                          <div key={l} style={{background:C.bg,borderRadius:4,padding:'4px 2px',textAlign:'center'}}>
                            <div style={{fontSize:7,color:C.muted,marginBottom:1}}>{l}</div>
                            <div style={{fontWeight:700,fontSize:10,
                              color:v>=0?C.green:C.red}}>
                              {v!=null?`${v>=0?'+':''}${v.toFixed(1)}%`:'—'}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

          </div>
        )}

                {/* ══ SQUEEZE SCANNER (John Carter TTM) ══ */}
        {mainTab==='squeeze'&&(
          <div style={{padding:isMobile?'10px':'12px 16px'}}>
            <div style={{marginBottom:12}}>
              <div style={{fontWeight:700,fontSize:16}}>TTM Squeeze Scanner</div>
              <div style={{fontSize:11,color:C.muted}}>John Carter — scroll to see all timeframes</div>
            </div>

            {[
              {title:'🔥 Fired Now',      color:C.green,  list:stocks.filter(s=>s.sqFiredBullish||s.sqFiredBearish)},
              {title:'⭐ Multi-TF D+W',   color:C.accent, list:stocks.filter(s=>s.inSqueeze&&s.sqWeeklyIn)},
              {title:'📅 Daily Squeeze',  color:C.red,    list:stocks.filter(s=>s.inSqueeze)},
              {title:'📈 Weekly Squeeze', color:C.orange, list:stocks.filter(s=>s.sqWeeklyIn)},
              {title:'⏱ Hourly Squeeze', color:C.yellow, list:stocks.filter(s=>s.sqHourlyIn)},
            ].map(({title,color,list})=>(
              <div key={title} style={{background:C.card,border:`1px solid ${color}33`,borderRadius:12,padding:'14px',marginBottom:12}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
                  <div style={{fontWeight:700,fontSize:13,color}}>{title}</div>
                  <span style={{fontSize:11,fontWeight:700,color,background:color+'18',padding:'2px 8px',borderRadius:10}}>{list.length}</span>
                </div>
                {list.length===0
                  ?<div style={{textAlign:'center',padding:'14px',color:C.muted,fontSize:11}}>No signals</div>
                  :<div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'1fr 1fr',gap:8}}>
                    {list.sort((a,b)=>(b.sqStrength||0)-(a.sqStrength||0)).slice(0,10).map(s=>(
                      <div key={s.sym} style={{background:C.bg,border:`1px solid ${color}33`,borderRadius:8,padding:'10px'}}>
                        <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
                          <div>
                            <span onClick={()=>setChartSym(s.sym===chartSym?null:s.sym)} style={{fontWeight:700,fontSize:13,color:C.accent,cursor:'pointer'}}>{s.sym}</span>
                            <span style={{fontSize:9,color:C.muted,marginLeft:4}}>{s.sector}</span>
                          </div>
                          <div style={{textAlign:'right'}}>
                            <div style={{fontWeight:700,fontSize:15,color:(s.rsTv||s.rs||0)>=80?C.green:(s.rsTv||s.rs||0)>=60?C.accent:C.yellow}}>{s.rsTv||s.rs||0}</div>
                            <div style={{fontSize:9,color:(s.chg||0)>=0?C.green:C.red}}>{(s.chg||0)>=0?'+':''}{(s.chg||0).toFixed(1)}%</div>
                          </div>
                        </div>
                        {s.sqDotsD&&s.sqDotsD.length>0&&(
                          <div style={{display:'flex',gap:2,marginBottom:3}}>
                            {s.sqDotsD.slice(-12).map((d,i)=>(
                              <div key={i} style={{width:7,height:7,borderRadius:'50%',background:d==='red'?C.red:d==='green'?C.green:'#374151'}}/>
                            ))}
                          </div>
                        )}
                        {s.sqHistD&&s.sqHistD.length>0&&(
                          <div style={{display:'flex',gap:1,alignItems:'flex-end',height:16}}>
                            {s.sqHistD.slice(-12).map((v,i)=>{
                              const mx=Math.max(...s.sqHistD.map(Math.abs),0.001)
                              return <div key={i} style={{flex:1,display:'flex',flexDirection:'column',justifyContent:v>=0?'flex-end':'flex-start',height:'100%'}}><div style={{background:v>=0?C.green:C.red,height:`${Math.abs(v)/mx*14}px`,minHeight:1,borderRadius:1}}/></div>
                            })}
                          </div>
                        )}
                        {(s.sqStrength||0)>0&&(
                          <div style={{fontSize:9,color:C.muted,marginTop:3}}>Str:<span style={{color:C.accent,fontWeight:600,marginLeft:3}}>{(s.sqStrength||0).toFixed(0)}</span></div>
                        )}
                      </div>
                    ))}
                  </div>
                }
              </div>
            ))}
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
                      {s.pp.isPP&&<Badge color={C.orange}>🔥PP</Badge>}
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
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <span style={{fontSize:10,color:C.muted}}>PP 10d:</span>
                  <PPDots ppHistory={s.pp.ppHistory||[]}/>
                  <span style={{fontSize:10,color:s.pp.ppCount10d>0?C.orange:C.muted,fontWeight:700}}>{s.pp.ppCount10d}×</span>
                </div>
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
                      {s.pp.isPP&&<Badge color={C.orange}>🔥PP</Badge>}
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
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <span style={{fontSize:10,color:C.muted}}>PP 10d:</span>
                  <PPDots ppHistory={s.pp.ppHistory||[]}/>
                  <span style={{fontSize:10,color:s.pp.ppCount10d>0?C.orange:C.muted,fontWeight:700}}>{s.pp.ppCount10d}×</span>
                </div>
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

        {/* ══ SECTORS ══ */}
        {mainTab==='sector'&&(
          <div style={{padding:isMobile?'10px':'12px 16px'}}>

            <div style={{marginBottom:12,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div>
                <div style={{fontWeight:700,fontSize:16}}>Sector Rotation</div>
                <div style={{fontSize:11,color:C.muted}}>Tap any sector to see stocks</div>
              </div>
            </div>

            {(()=>{
              const [selSector, setSelSector] = useState(null)

              // Build sector data from stocks
              const sectorMap = {}
              stocks.forEach(s=>{
                if(!s.sector||s.sector==='Other') return
                if(!sectorMap[s.sector]) sectorMap[s.sector]={
                  name:s.sector, rsArr:[], chgArr:[], chgWArr:[], chgMArr:[], ppCount:0, count:0, stocks:[]
                }
                const sec = sectorMap[s.sector]
                const rs = s.rsTv||0
                if(rs>0) sec.rsArr.push(rs)
                if(s.chg!=null)  sec.chgArr.push(s.chg)
                if(s.chgW!=null) sec.chgWArr.push(s.chgW)
                if(s.chgM!=null) sec.chgMArr.push(s.chgM)
                if(s.pp?.isPP)   sec.ppCount++
                sec.count++
                sec.stocks.push(s)
              })

              const avg = arr => arr.length ? +(arr.reduce((a,b)=>a+b,0)/arr.length).toFixed(1) : 0

              const sectors = Object.values(sectorMap).map(s=>({
                name:    s.name,
                avgRS:   Math.round(avg(s.rsArr)),
                chgD:    avg(s.chgArr),
                chgW:    avg(s.chgWArr),
                chgM:    avg(s.chgMArr),
                ppCount: s.ppCount,
                count:   s.count,
                stocks:  s.stocks.sort((a,b)=>(b.rsTv||0)-(a.rsTv||0)),
              })).filter(s=>s.count>=2)

              if(sectors.length===0) return(
                <div style={{textAlign:'center',padding:'40px',color:C.muted}}>
                  <div style={{fontSize:13}}>Tap 🚀 Scan to load sector data</div>
                </div>
              )

              // If a sector is selected, show its stocks
              if(selSector){
                const sec = sectors.find(s=>s.name===selSector)
                if(!sec) return null
                return(
                  <div>
                    {/* Back button */}
                    <button onClick={()=>setSelSector(null)}
                      style={{display:'flex',alignItems:'center',gap:6,padding:'8px 0',
                        background:'transparent',border:'none',
                        color:C.accent,fontSize:13,cursor:'pointer',marginBottom:12,fontWeight:600}}>
                      ← Back to Sectors
                    </button>

                    {/* Sector header */}
                    <div style={{background:C.card,border:`1px solid ${C.divider}`,
                      borderRadius:12,padding:'14px',marginBottom:14}}>
                      <div style={{fontWeight:700,fontSize:16,marginBottom:4}}>{sec.name}</div>
                      <div style={{display:'flex',gap:12,fontSize:11,flexWrap:'wrap'}}>
                        <span>Avg RS: <span style={{fontWeight:700,
                          color:sec.avgRS>=80?C.green:sec.avgRS>=60?C.accent:sec.avgRS>=40?C.yellow:C.red}}>
                          {sec.avgRS}
                        </span></span>
                        <span style={{color:sec.chgD>=0?C.green:C.red}}>
                          Day: {sec.chgD>=0?'+':''}{sec.chgD}%
                        </span>
                        <span style={{color:sec.chgW>=0?C.green:C.red}}>
                          Week: {sec.chgW>=0?'+':''}{sec.chgW}%
                        </span>
                        <span style={{color:sec.chgM>=0?C.green:C.red}}>
                          Month: {sec.chgM>=0?'+':''}{sec.chgM}%
                        </span>
                        {sec.ppCount>0&&<span style={{color:C.orange}}>🔥 {sec.ppCount} PP</span>}
                      </div>
                    </div>

                    {/* Stock list */}
                    <div style={{display:'grid',
                      gridTemplateColumns:isMobile?'1fr':'1fr 1fr',gap:8}}>
                      {sec.stocks.map(s=>(
                        <div key={s.sym} style={{background:C.card,
                          border:`1px solid ${C.divider}`,borderRadius:10,padding:'12px',
                          cursor:'pointer'}}
                          onClick={()=>setChartSym(s.sym===chartSym?null:s.sym)}>
                          <div style={{display:'flex',justifyContent:'space-between',
                            alignItems:'flex-start'}}>
                            <div>
                              <div style={{fontWeight:700,fontSize:13,color:C.accent}}>
                                {s.sym}
                              </div>
                              <div style={{fontSize:10,color:C.muted,marginTop:1}}>
                                ₹{s.last?.toLocaleString('en-IN')||'—'}
                              </div>
                              <div style={{display:'flex',gap:4,marginTop:4}}>
                                {s.pp?.isPP&&<span style={{fontSize:9,fontWeight:700,
                                  padding:'1px 5px',borderRadius:3,
                                  background:C.orange+'18',color:C.orange}}>PP</span>}
                                {s.inSqueeze&&<span style={{fontSize:9,fontWeight:700,
                                  padding:'1px 5px',borderRadius:3,
                                  background:C.red+'18',color:C.red}}>SQ</span>}
                              </div>
                            </div>
                            <div style={{textAlign:'right'}}>
                              <div style={{fontWeight:700,fontSize:18,
                                color:(s.rsTv||0)>=80?C.green:(s.rsTv||0)>=60?C.accent:
                                      (s.rsTv||0)>=40?C.yellow:C.red}}>
                                {s.rsTv||'—'}
                              </div>
                              <div style={{fontSize:9,color:C.teal}}>RS-TV</div>
                              <div style={{fontSize:11,fontWeight:600,marginTop:2,
                                color:(s.chg||0)>=0?C.green:C.red}}>
                                {(s.chg||0)>=0?'+':''}{(s.chg||0).toFixed(1)}%
                              </div>
                            </div>
                          </div>
                          {/* Mini RS sparkline */}
                          {s.hist&&s.hist.length>0&&(
                            <div style={{display:'flex',gap:2,marginTop:8}}>
                              {s.hist.slice(-10).map((v,i)=>(
                                <div key={i} style={{flex:1,height:4,borderRadius:2,
                                  background:(v||0)>=70?C.green:(v||0)>=50?C.accent:
                                             (v||0)>=30?C.yellow:C.red,opacity:0.7}}/>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )
              }

              // Main sector view
              const BarChart = ({data, valueKey, title, subtitle, color}) => {
                const sorted = [...data].sort((a,b)=>(b[valueKey]||0)-(a[valueKey]||0))
                const maxAbs = Math.max(...sorted.map(s=>Math.abs(s[valueKey]||0)), 0.01)
                return(
                  <div style={{background:C.card,border:`1px solid ${C.divider}`,
                    borderRadius:12,padding:'14px',marginBottom:12}}>
                    <div style={{fontWeight:700,fontSize:13,color:C.text,marginBottom:2}}>{title}</div>
                    <div style={{fontSize:10,color:C.muted,marginBottom:10}}>{subtitle}</div>
                    {sorted.map((s,i)=>{
                      const val = s[valueKey]||0
                      const pct = Math.abs(val)/maxAbs*100
                      const c   = val>=0?C.green:C.red
                      const rsC = s.avgRS>=80?C.green:s.avgRS>=60?C.accent:s.avgRS>=40?C.yellow:C.red
                      return(
                        <div key={s.name} onClick={()=>setSelSector(s.name)}
                          style={{display:'flex',alignItems:'center',gap:8,
                            marginBottom:5,cursor:'pointer'}}
                          onMouseEnter={e=>e.currentTarget.style.opacity='0.8'}
                          onMouseLeave={e=>e.currentTarget.style.opacity='1'}>
                          {/* Value */}
                          <div style={{width:44,textAlign:'right',fontSize:10,
                            fontWeight:700,color:c,flexShrink:0}}>
                            {val>=0?'+':''}{val}%
                          </div>
                          {/* Bar with label inside */}
                          <div style={{flex:1,background:C.bg,borderRadius:4,
                            height:24,overflow:'hidden',position:'relative'}}>
                            <div style={{width:`${Math.max(pct,3)}%`,height:'100%',
                              background:c+'99',borderRadius:4,
                              display:'flex',alignItems:'center',
                              paddingLeft:8,minWidth:60,
                              transition:'width 0.3s'}}>
                              <span style={{fontSize:10,fontWeight:700,
                                color:'#fff',whiteSpace:'nowrap',
                                overflow:'hidden',textOverflow:'ellipsis'}}>
                                {s.name}
                              </span>
                            </div>
                            {/* Show name outside bar if bar too small */}
                            {pct<20&&(
                              <span style={{position:'absolute',left:`${Math.max(pct,3)}%+4px`,
                                top:'50%',transform:'translateY(-50%)',
                                fontSize:10,fontWeight:600,color:C.text,
                                marginLeft:4,whiteSpace:'nowrap'}}>
                                {s.name}
                              </span>
                            )}
                          </div>
                          {/* RS */}
                          <div style={{width:28,textAlign:'right',flexShrink:0}}>
                            <span style={{fontSize:10,fontWeight:700,color:rsC}}>
                              {s.avgRS}
                            </span>
                          </div>
                          {/* PP dot */}
                          {s.ppCount>0&&(
                            <div style={{width:8,height:8,borderRadius:'50%',
                              background:C.orange,flexShrink:0}}/>
                          )}
                        </div>
                      )
                    })}
                    <div style={{display:'flex',gap:12,marginTop:8,fontSize:9,color:C.muted}}>
                      <span>RS = avg RS-TV</span>
                      <span>🟠 = PP signals</span>
                      <span>Tap bar to see stocks</span>
                    </div>
                  </div>
                )
              }

              // RS Rankings with 15-day trend
              const RSRankings = () => {
                const sorted = [...sectors].sort((a,b)=>b.avgRS-a.avgRS)
                return(
                  <div style={{background:C.card,border:`1px solid ${C.divider}`,
                    borderRadius:12,padding:'14px'}}>
                    <div style={{fontWeight:700,fontSize:13,color:C.text,marginBottom:2}}>
                      ⭐ RS Strength Rankings
                    </div>
                    <div style={{fontSize:10,color:C.muted,marginBottom:10}}>
                      Tap any sector to see stocks inside
                    </div>
                    {sorted.map((s,i)=>{
                      const c = s.avgRS>=80?C.green:s.avgRS>=60?C.accent:s.avgRS>=40?C.yellow:C.red
                      // 15-day RS trend: use avgChgW as proxy (positive = improving)
                      const trend = s.chgW>0.5?'↑':s.chgW<-0.5?'↓':'→'
                      const trendColor = s.chgW>0.5?C.green:s.chgW<-0.5?C.red:C.muted
                      return(
                        <div key={s.name} onClick={()=>setSelSector(s.name)}
                          style={{display:'flex',alignItems:'center',gap:10,
                            marginBottom:8,cursor:'pointer',padding:'4px 0',
                            borderBottom:`1px solid ${C.divider}`}}
                          onMouseEnter={e=>e.currentTarget.style.background=C.bg}
                          onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                          <span style={{color:C.muted,fontSize:10,width:20,
                            textAlign:'right',flexShrink:0}}>{i+1}</span>
                          {/* Bar */}
                          <div style={{flex:1,background:C.bg,borderRadius:4,
                            height:22,overflow:'hidden'}}>
                            <div style={{width:`${s.avgRS}%`,height:'100%',
                              background:c+'88',borderRadius:4,
                              display:'flex',alignItems:'center',paddingLeft:8,
                              transition:'width 0.3s',minWidth:40}}>
                              <span style={{fontSize:10,fontWeight:700,
                                color:'#fff',whiteSpace:'nowrap'}}>
                                {s.name}
                              </span>
                            </div>
                          </div>
                          {/* RS value */}
                          <span style={{fontWeight:700,fontSize:14,color:c,
                            width:28,textAlign:'right',flexShrink:0}}>{s.avgRS}</span>
                          {/* 15d trend */}
                          <span style={{fontSize:12,color:trendColor,
                            width:16,textAlign:'center',flexShrink:0}}
                            title={`Weekly: ${s.chgW>=0?'+':''}${s.chgW}%`}>
                            {trend}
                          </span>
                          {/* Count */}
                          <span style={{fontSize:9,color:C.muted,
                            width:30,flexShrink:0}}>{s.count}s</span>
                        </div>
                      )
                    })}
                  </div>
                )
              }

              return(
                <div>
                  <BarChart data={sectors} valueKey="chgD"
                    title="📅 Sector Advances — Daily %"
                    subtitle="Today's performance · tap bar to see stocks"
                    color={C.accent}/>
                  <BarChart data={sectors} valueKey="chgW"
                    title="📈 Sector Advances — Weekly %"
                    subtitle="Last 5 trading days · tap bar to see stocks"
                    color={C.teal}/>
                  <BarChart data={sectors} valueKey="chgM"
                    title="🗓 Sector Advances — Monthly %"
                    subtitle="Last 21 trading days · tap bar to see stocks"
                    color={C.purple}/>
                  <RSRankings/>
                </div>
              )
            })()}
          </div>
        )}

        {/* ══ SETTINGS ══ */}
        {mainTab==='settings'&&(
          <SettingsPanel session={session} onUpdate={s=>setSession(s)} onLogout={()=>setSession(null)}/>
        )}

      </div>
      </div>
      {/* Mobile bottom nav */}
      {isMobile&&(
        <div style={{position:'fixed',bottom:0,left:0,right:0,background:C.card,
          borderTop:`1px solid ${C.border}`,display:'flex',zIndex:40,
          overflowX:'auto',paddingBottom:'env(safe-area-inset-bottom)',
          WebkitOverflowScrolling:'touch'}}>
          {[
            ['rs','📊','RS'],
            ['indices','🗂','IX'],
            ['breadth','📈','Breadth'],
            ['squeeze','🌀','Squeeze'],
            ['breakout','💥','Break'],
            ['52wl','🎯','52WL'],
            ['weak','🚨','Weak'],
            ['sector','🏭','Sectors'],
            ['portfolio','💼','Portfolio'],
            ['compare','⚖','Compare'],
            ['watchlist','📋','Watch'],
            ['settings','⚙','Account'],
          ].map(([t,icon,label])=>(
            <button key={t} onClick={()=>setMainTab(t)}
              style={{flex:'0 0 auto',minWidth:56,padding:'6px 4px 5px',
                background:'transparent',border:'none',
                cursor:'pointer',display:'flex',flexDirection:'column',
                alignItems:'center',gap:1}}>
              <span style={{fontSize:14}}>{icon}</span>
              <span style={{fontSize:8,fontWeight:600,color:mainTab===t?C.accent:C.muted,
                whiteSpace:'nowrap'}}>{label}</span>
              {mainTab===t&&<div style={{width:16,height:2,background:C.accent,borderRadius:99,marginTop:1}}/>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
