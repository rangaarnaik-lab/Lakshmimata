/**
 * Earnings Tracker — season overview + sector map.
 * Uses structured financial_results (Sales/PAT YoY·QoQ + result quality).
 * Beat / Miss / No Coverage approximate analyst outcomes via our result
 * rating (Excellent/Good = beat, Weak = miss, Neutral/unrated = no coverage)
 * because Lakshmimata does not store Street consensus estimates.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { fetchFinancialResultsGroupedForRatings } from '../lib/db'
import { INDEX_CONSTITUENT_SYMS } from '../data/index-constituents'
import { resolveSector } from '../data/industries'

function parsePeriodDate(s){
  if(!s) return null
  const d = new Date(s)
  if(!isNaN(d.getTime())) return d
  // DD-Mon-YYYY (e.g. 30-Jun-2026)
  const m = String(s).match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/)
  if(m){
    const months={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11}
    const mo=months[m[2]]
    if(mo!=null) return new Date(+m[3], mo, +m[1])
  }
  return null
}

/** Indian fiscal year for a period-end date. FY27 = Apr 2026–Mar 2027. */
function fyLabelForDate(d){
  if(!d) return null
  const y = d.getFullYear()
  const m = d.getMonth() // 0-based
  const fyEnd = m >= 3 ? y + 1 : y // Apr+ → next calendar year number
  return `FY${String(fyEnd).slice(-2)}`
}

/** Q1=Apr–Jun, Q2=Jul–Sep, Q3=Oct–Dec, Q4=Jan–Mar */
function quarterForDate(d){
  if(!d) return null
  const m = d.getMonth()
  if(m>=3 && m<=5) return 'Q1'
  if(m>=6 && m<=8) return 'Q2'
  if(m>=9 && m<=11) return 'Q3'
  return 'Q4'
}

function pct(now, then){
  if(now==null || then==null || then===0) return null
  return ((now - then) / Math.abs(then)) * 100
}

function adjPat(row){
  if(!row || row.pat==null) return null
  return row.pat - (row.exceptional_item || 0)
}

function classifyOutcome(rating, salesYoy, patYoy){
  if(rating==='Excellent' || rating==='Good') return 'beat'
  if(rating==='Weak') return 'miss'
  if(rating==='Neutral') return 'none'
  if(salesYoy!=null && patYoy!=null){
    if(salesYoy>0 && patYoy>0) return 'beat'
    if(salesYoy<0 || patYoy<0) return 'miss'
  } else if(patYoy!=null){
    if(patYoy>5) return 'beat'
    if(patYoy<-5) return 'miss'
  }
  return 'none'
}

function fmtPct(v){
  if(v==null || Number.isNaN(v)) return '—'
  const n = Number(v)
  return `${n>=0?'+':''}${n.toFixed(1)}%`
}

function avg(nums){
  const xs = nums.filter(n=>n!=null && !Number.isNaN(n))
  if(!xs.length) return null
  return xs.reduce((a,b)=>a+b,0)/xs.length
}

const INDEX_OPTIONS = [
  {id:'nifty500', label:'Nifty 500', key:'500'},
  {id:'nifty50', label:'Nifty 50', membership:'inNifty50'},
  {id:'midcap', label:'Midcap 150', membership:'inMidcap'},
  {id:'smallcap', label:'Smallcap 250', membership:'inSmallcap'},
  {id:'all', label:'All scanned'},
]

function defaultFyQuarter(){
  // Prefer current Indian FY / latest completed quarter.
  const now = new Date()
  const fy = fyLabelForDate(now) || 'FY27'
  // If we're early in a quarter, show prior quarter (results lag).
  const m = now.getMonth()
  let q
  if(m===3||m===4) q='Q4' // Apr–May → still looking at Jan–Mar
  else if(m===5||m===6||m===7) q='Q1'
  else if(m===8||m===9||m===10) q='Q2'
  else q='Q3'
  // Aug 2026 → Q1 season is the live one
  if(m>=6 && m<=8) q='Q1'
  return {fy, quarter:q}
}

export default function EarningsTracker({
  C, stocks, watchlists, activeWl, portfolios, activePortfolioId, onOpenSymbol,
}){
  const defaults = defaultFyQuarter()
  const [scope,setScope]=useState('all') // all | watchlist | portfolio
  const [indexId,setIndexId]=useState('nifty500')
  const [fy,setFy]=useState(defaults.fy)
  const [quarter,setQuarter]=useState(defaults.quarter)
  const [subTab,setSubTab]=useState('sectormap') // sectormap | declared | live | upcoming | leaderboard
  // Click a summary / sector rectangle → list announced names under that bucket.
  // {kind:'outcome', value:'beat'|'miss'|'none'|'all'} | {kind:'sector', value:string} | null
  const [drill,setDrill]=useState(null)
  const [grouped,setGrouped]=useState(null)
  const [loading,setLoading]=useState(true)

  useEffect(()=>{
    let cancelled=false
    setLoading(true)
    fetchFinancialResultsGroupedForRatings()
      .then(g=>{ if(!cancelled) setGrouped(g||{}) })
      .catch(()=>{ if(!cancelled) setGrouped({}) })
      .finally(()=>{ if(!cancelled) setLoading(false) })
    return ()=>{ cancelled=true }
  },[])

  // Season / universe change → clear drill so the list matches the new filter.
  useEffect(()=>{ setDrill(null) },[fy,quarter,scope,indexId])

  const universeSyms = useMemo(()=>{
    const stockBySym = new Map((stocks||[]).map(s=>[String(s.sym||'').toUpperCase(), s]))
    let base = []
    const opt = INDEX_OPTIONS.find(o=>o.id===indexId) || INDEX_OPTIONS[0]
    if(opt.key && INDEX_CONSTITUENT_SYMS[opt.key]){
      base = INDEX_CONSTITUENT_SYMS[opt.key].map(s=>String(s).toUpperCase())
    } else if(opt.membership){
      base = (stocks||[]).filter(s=>s[opt.membership]).map(s=>String(s.sym).toUpperCase())
    } else {
      base = (stocks||[]).map(s=>String(s.sym).toUpperCase())
    }
    if(scope==='watchlist'){
      const wl = (watchlists||[]).find(w=>w.id===activeWl) || (watchlists||[])[0]
      const set = new Set((wl?.stocks||[]).map(x=>String(x).toUpperCase()))
      base = base.filter(s=>set.has(s))
    } else if(scope==='portfolio'){
      const p = (portfolios||[]).find(x=>x.id===activePortfolioId) || (portfolios||[])[0]
      const set = new Set((p?.holdings||[]).map(h=>String(h.sym||h.symbol||'').toUpperCase()).filter(Boolean))
      base = base.filter(s=>set.has(s))
    }
    return base.filter(s=>stockBySym.has(s) || (grouped && grouped[s]))
  },[stocks,indexId,scope,watchlists,activeWl,portfolios,activePortfolioId,grouped])

  const fyOptions = useMemo(()=>{
    const set = new Set([defaults.fy])
    if(grouped){
      for(const rows of Object.values(grouped)){
        for(const r of rows){
          const d=parsePeriodDate(r.period_ended)
          const lab=fyLabelForDate(d)
          if(lab) set.add(lab)
        }
      }
    }
    return [...set].sort((a,b)=>b.localeCompare(a))
  },[grouped,defaults.fy])

  const seasonRows = useMemo(()=>{
    if(!grouped) return []
    const stockBySym = new Map((stocks||[]).map(s=>[String(s.sym||'').toUpperCase(), s]))
    const out = []
    for(const sym of universeSyms){
      const hist = grouped[sym] || []
      const match = hist.find(r=>{
        const d=parsePeriodDate(r.period_ended)
        return d && fyLabelForDate(d)===fy && quarterForDate(d)===quarter
      }) || null
      if(!match){
        out.push({sym, declared:false, stock:stockBySym.get(sym)||null})
        continue
      }
      const curDate = parsePeriodDate(match.period_ended)
      const yoyRow = hist.find(h=>{
        const d=parsePeriodDate(h.period_ended)
        if(!d||!curDate) return false
        return curDate.getFullYear()-d.getFullYear()===1 &&
          Math.abs((d.getMonth()*30+d.getDate())-(curDate.getMonth()*30+curDate.getDate()))<=25
      }) || null
      const prevQ = hist.find(h=>h!==match && parsePeriodDate(h.period_ended) &&
        parsePeriodDate(h.period_ended) < curDate) || hist[1] || null
      const salesYoy = match.sales_yoy_pct ?? pct(match.sales, yoyRow?.sales)
      const patYoy = match.pat_yoy_pct ?? pct(adjPat(match), adjPat(yoyRow))
      const salesQoq = match.sales_qoq_pct ?? pct(match.sales, prevQ?.sales)
      const patQoq = match.pat_qoq_pct ?? pct(adjPat(match), adjPat(prevQ))
      const rating = match.result_rating || null
      const outcome = classifyOutcome(rating, salesYoy, patYoy)
      const stock = stockBySym.get(sym)
      const sector = stock?.sector || resolveSector(sym) || 'Other'
      out.push({
        sym, declared:true, match, stock, sector,
        salesYoy, patYoy, salesQoq, patQoq, rating, outcome,
        filedAt: match.filed_at || null,
      })
    }
    return out
  },[grouped,universeSyms,fy,quarter,stocks])

  const summary = useMemo(()=>{
    const total = seasonRows.length
    const declared = seasonRows.filter(r=>r.declared)
    const beats = declared.filter(r=>r.outcome==='beat')
    const misses = declared.filter(r=>r.outcome==='miss')
    const none = declared.filter(r=>r.outcome==='none')
    return {
      total,
      declaredCount: declared.length,
      declaredPct: total? Math.round(declared.length/total*100) : 0,
      beats: beats.length,
      misses: misses.length,
      none: none.length,
      salesYoy: avg(declared.map(r=>r.salesYoy)),
      patYoy: avg(declared.map(r=>r.patYoy)),
    }
  },[seasonRows])

  const sectorCards = useMemo(()=>{
    const by = {}
    for(const r of seasonRows){
      const sec = r.sector || 'Other'
      if(!by[sec]) by[sec]={sector:sec, total:0, declared:[], beats:0, misses:0, none:0}
      by[sec].total++
      if(r.declared){
        by[sec].declared.push(r)
        if(r.outcome==='beat') by[sec].beats++
        else if(r.outcome==='miss') by[sec].misses++
        else by[sec].none++
      }
    }
    return Object.values(by)
      .filter(s=>s.declared.length>0 || s.total>=3)
      .map(s=>({
        ...s,
        salesYoy: avg(s.declared.map(r=>r.salesYoy)),
        patYoy: avg(s.declared.map(r=>r.patYoy)),
        salesQoq: avg(s.declared.map(r=>r.salesQoq)),
        patQoq: avg(s.declared.map(r=>r.patQoq)),
      }))
      .sort((a,b)=>b.declared.length-a.declared.length)
  },[seasonRows])

  const declaredList = useMemo(()=>
    seasonRows.filter(r=>r.declared)
      .sort((a,b)=>String(b.filedAt||'').localeCompare(String(a.filedAt||'')))
  ,[seasonRows])

  const drillList = useMemo(()=>{
    if(!drill) return declaredList
    if(drill.kind==='outcome'){
      if(drill.value==='all') return declaredList
      return declaredList.filter(r=>r.outcome===drill.value)
    }
    if(drill.kind==='sector'){
      return declaredList.filter(r=>r.sector===drill.value)
    }
    return declaredList
  },[declaredList,drill])

  const drillTitle = useMemo(()=>{
    if(!drill) return null
    if(drill.kind==='outcome'){
      return ({
        all:'All declared',
        beat:'Strong (Excellent / Good)',
        miss:'Weak quality',
        none:'Neutral / unrated',
      })[drill.value] || 'Declared'
    }
    if(drill.kind==='sector') return `${drill.value} · declared`
    return 'Declared'
  },[drill])

  const openDrill=(next)=>{
    setDrill(next)
    setSubTab('declared')
  }

  const leaderboard = useMemo(()=>{
    return [...declaredList]
      .filter(r=>r.patYoy!=null)
      .sort((a,b)=>(b.patYoy??-999)-(a.patYoy??-999))
      .slice(0,40)
  },[declaredList])

  const upcoming = useMemo(()=>
    seasonRows.filter(r=>!r.declared)
      .map(r=>({...r, rs:r.stock?.rs??0}))
      .sort((a,b)=>b.rs-a.rs)
      .slice(0,80)
  ,[seasonRows])

  const indexLabel = INDEX_OPTIONS.find(o=>o.id===indexId)?.label || 'Universe'
  const isLive = summary.declaredCount>0 && summary.declaredPct<100

  const chip=(active)=>({
    padding:'7px 14px',borderRadius:8,border:`1px solid ${active?C.accent:C.border}`,
    background:active?C.accent+'22':'transparent',color:active?C.accent:C.muted,
    fontSize:12,fontWeight:700,cursor:'pointer',
  })

  const MetricCard=({label,value,sub,valueColor,active,onClick,hint})=>{
    const clickable=typeof onClick==='function'
    return(
      <div role={clickable?'button':undefined} tabIndex={clickable?0:undefined}
        onClick={onClick}
        onKeyDown={clickable?(e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); onClick() } }:undefined}
        title={hint||(clickable?'Show announced stocks in this group':undefined)}
        style={{background:C.card,border:`1px solid ${active?C.accent:C.border}`,borderRadius:12,padding:'18px 16px',
          cursor:clickable?'pointer':'default',boxShadow:active?`0 0 0 1px ${C.accent}44`:'none',
          transition:'border-color 0.15s, box-shadow 0.15s'}}>
        <div style={{fontSize:12,color:C.muted,marginBottom:8}}>{label}</div>
        <div style={{fontSize:28,fontWeight:800,color:valueColor||C.text,letterSpacing:'-0.02em'}}>{value}</div>
        {sub&&<div style={{fontSize:11,color:C.muted,marginTop:6}}>{sub}</div>}
        {clickable&&(
          <div style={{fontSize:10,fontWeight:700,color:active?C.accent:C.muted,marginTop:8}}>
            {active?'Showing list below ↓':'Tap → see announced'}
          </div>
        )}
      </div>
    )
  }

  const growthColor=v=>v==null?C.muted:v>=0?C.green:C.red
  const outcomeActive=v=>drill?.kind==='outcome'&&drill.value===v
  const sectorActive=sec=>drill?.kind==='sector'&&drill.value===sec

  return(
    <div style={{padding:'4px 0 28px'}}>
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:12,flexWrap:'wrap',marginBottom:6}}>
        <div>
          <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
            <h1 style={{margin:0,fontSize:22,fontWeight:800,color:C.text}}>{quarter} {fy} Earnings</h1>
            {isLive&&(
              <span style={{display:'inline-flex',alignItems:'center',gap:6,background:C.red,color:'#fff',
                fontSize:10,fontWeight:800,letterSpacing:'0.08em',padding:'4px 10px',borderRadius:99}}>
                <span style={{width:6,height:6,borderRadius:'50%',background:'#fff',display:'inline-block'}}/>
                LIVE
              </span>
            )}
          </div>
          <div style={{fontSize:12,color:C.muted,marginTop:4}}>
            Earnings calendar, results &amp; analysis for {quarter} {fy}
            {' · '}Beat/Miss use result quality (no Street estimates in-app)
          </div>
        </div>
      </div>

      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,flexWrap:'wrap',marginBottom:16}}>
        <div style={{display:'flex',gap:4,background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:3}}>
          {[['all','All'],['watchlist','Watchlist'],['portfolio','Portfolio']].map(([id,label])=>(
            <button key={id} type="button" onClick={()=>setScope(id)} style={chip(scope===id)}>{label}</button>
          ))}
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          <select value={indexId} onChange={e=>setIndexId(e.target.value)}
            style={{padding:'7px 10px',background:C.card,border:`1px solid ${C.border}`,borderRadius:8,color:C.text,fontSize:12}}>
            {INDEX_OPTIONS.map(o=><option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          <select value={fy} onChange={e=>setFy(e.target.value)}
            style={{padding:'7px 10px',background:C.card,border:`1px solid ${C.border}`,borderRadius:8,color:C.text,fontSize:12}}>
            {fyOptions.map(f=><option key={f} value={f}>{f}</option>)}
          </select>
          <select value={quarter} onChange={e=>setQuarter(e.target.value)}
            style={{padding:'7px 10px',background:C.card,border:`1px solid ${C.border}`,borderRadius:8,color:C.text,fontSize:12}}>
            {['Q1','Q2','Q3','Q4'].map(q=><option key={q} value={q}>{q}</option>)}
          </select>
        </div>
      </div>

      {loading?(
        <div style={{textAlign:'center',padding:'48px 0',color:C.muted,fontSize:13}}>Loading earnings season…</div>
      ):(
        <>
          <div style={{background:C.yellow+'14',border:`1px solid ${C.yellow}44`,borderRadius:10,
            padding:'10px 12px',marginBottom:14,fontSize:11.5,lineHeight:1.5,color:C.text}}>
            <strong style={{color:C.yellow}}>Result quality, not Street estimates.</strong>
            {' '}“Strong / Weak” here maps Excellent·Good vs Weak from our filings math — Lakshmimata does not store analyst consensus, so this is not a classic Beat vs Estimate.
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))',gap:12,marginBottom:18}}>
            <MetricCard label="Declared" value={`${summary.declaredCount} / ${summary.total}`}
              sub={`${summary.declaredPct}% declared · ${indexLabel}`}
              active={outcomeActive('all')}
              onClick={()=>openDrill({kind:'outcome',value:'all'})}/>
            <MetricCard label="Strong (Ex/Good)" value={String(summary.beats)}
              sub="Our result quality — not Street beat/miss" valueColor={C.green}
              active={outcomeActive('beat')}
              onClick={()=>openDrill({kind:'outcome',value:'beat'})}/>
            <MetricCard label="Weak quality" value={String(summary.misses)}
              sub="Our result quality — not Street beat/miss" valueColor={C.red}
              active={outcomeActive('miss')}
              onClick={()=>openDrill({kind:'outcome',value:'miss'})}/>
            <MetricCard label="Neutral / unrated" value={String(summary.none)}
              sub="No Excellent/Good/Weak rating yet"
              active={outcomeActive('none')}
              onClick={()=>openDrill({kind:'outcome',value:'none'})}/>
            <MetricCard label="Sales Growth (YoY)" value={fmtPct(summary.salesYoy)}
              sub={`from ${summary.declaredCount} declared`} valueColor={growthColor(summary.salesYoy)}
              onClick={()=>openDrill({kind:'outcome',value:'all'})}
              hint="Open all declared stocks"/>
            <MetricCard label="PAT Growth (YoY)" value={fmtPct(summary.patYoy)}
              sub={`from ${summary.declaredCount} declared`} valueColor={growthColor(summary.patYoy)}
              onClick={()=>openDrill({kind:'outcome',value:'all'})}
              hint="Open all declared stocks"/>
          </div>

          <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:16}}>
            {[
              ['sectormap','Sector Map'],
              ['live','Live Feed'],
              ['upcoming','Upcoming'],
              ['declared','Declared'],
              ['leaderboard','Leaderboard'],
            ].map(([id,label])=>(
              <button key={id} type="button" onClick={()=>{ setSubTab(id); if(id!=='declared'&&id!=='live') setDrill(null) }}
                style={{...chip(subTab===id), borderRadius:20}}>{label}</button>
            ))}
          </div>

          {subTab==='sectormap'&&(
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:12}}>
              {sectorCards.length===0?(
                <div style={{color:C.muted,fontSize:13,padding:20}}>No declared results in this season filter yet.</div>
              ):sectorCards.map(s=>{
                const n=s.declared.length||1
                const beatW=(s.beats/n)*100
                const missW=(s.misses/n)*100
                const noneW=(s.none/n)*100
                const active=sectorActive(s.sector)
                return(
                  <div key={s.sector} role="button" tabIndex={0}
                    onClick={()=>openDrill({kind:'sector',value:s.sector})}
                    onKeyDown={e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); openDrill({kind:'sector',value:s.sector}) } }}
                    title={`Show ${s.declared.length} announced in ${s.sector}`}
                    style={{background:C.card,border:`1px solid ${active?C.accent:C.border}`,borderRadius:12,padding:'16px 14px',
                      cursor:'pointer',boxShadow:active?`0 0 0 1px ${C.accent}44`:'none'}}>
                    <div style={{display:'flex',justifyContent:'space-between',gap:8,marginBottom:10}}>
                      <div style={{fontWeight:800,fontSize:14,color:C.text}}>{s.sector}</div>
                      <div style={{fontSize:11,color:C.muted,whiteSpace:'nowrap'}}>{s.declared.length}/{s.total} declared</div>
                    </div>
                    <div style={{display:'flex',height:8,borderRadius:99,overflow:'hidden',background:C.divider,marginBottom:8}}>
                      <div style={{width:`${beatW}%`,background:C.green}}/>
                      <div style={{width:`${missW}%`,background:C.red}}/>
                      <div style={{width:`${noneW}%`,background:C.muted+'55'}}/>
                    </div>
                    <div style={{fontSize:11,color:C.muted,marginBottom:12,display:'flex',gap:10,flexWrap:'wrap'}}>
                      <span><span style={{color:C.green}}>●</span> {s.beats} Strong</span>
                      <span><span style={{color:C.red}}>●</span> {s.misses} Weak</span>
                      <span><span style={{color:C.muted}}>●</span> {s.none} Neutral</span>
                    </div>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                      {[
                        ['Sales YoY', s.salesYoy],
                        ['Profit YoY', s.patYoy],
                        ['Sales QoQ', s.salesQoq],
                        ['Profit QoQ', s.patQoq],
                      ].map(([lab,val])=>(
                        <div key={lab}>
                          <div style={{fontSize:10,color:C.muted}}>{lab}</div>
                          <div style={{fontSize:16,fontWeight:800,color:growthColor(val)}}>{fmtPct(val)}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{fontSize:10,fontWeight:700,color:active?C.accent:C.muted,marginTop:12}}>
                      Tap → see all announced in this sector
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {(subTab==='declared'||subTab==='live')&&(
            <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden'}}>
              <div style={{padding:'10px 14px',borderBottom:`1px solid ${C.divider}`,display:'flex',
                alignItems:'center',justifyContent:'space-between',gap:10,flexWrap:'wrap'}}>
                <div style={{fontSize:12,fontWeight:700,color:C.muted}}>
                  {drill
                    ? <>{drillList.length} announced · <span style={{color:C.accent}}>{drillTitle}</span> · newest first</>
                    : <>{declaredList.length} declared · newest first</>}
                </div>
                {drill&&(
                  <button type="button" onClick={()=>setDrill(null)}
                    style={{padding:'4px 10px',borderRadius:7,border:`1px solid ${C.border}`,background:'transparent',
                      color:C.muted,fontSize:11,fontWeight:700,cursor:'pointer'}}>
                    Clear filter
                  </button>
                )}
              </div>
              {drillList.length===0?(
                <div style={{padding:24,color:C.muted,fontSize:13}}>
                  {drill?'No announced stocks in this group for the selected FY / quarter.':'No filings matched this FY / quarter yet.'}
                </div>
              ):(
                <div style={{maxHeight:520,overflowY:'auto'}}>
                  {drillList.slice(0,120).map(r=>(
                    <div key={r.sym} onClick={()=>onOpenSymbol?.(r.sym)}
                      style={{display:'flex',justifyContent:'space-between',gap:10,padding:'11px 14px',
                        borderBottom:`1px solid ${C.divider}`,cursor:onOpenSymbol?'pointer':'default'}}>
                      <div style={{minWidth:0}}>
                        <div style={{fontWeight:700,fontSize:13}}>{r.sym}
                          <span style={{marginLeft:8,fontSize:11,color:C.muted,fontWeight:500}}>{r.sector}</span>
                        </div>
                        <div style={{fontSize:10,color:C.muted,marginTop:2}}>
                          {r.rating||'Unrated'} · {r.outcome==='beat'?'Strong quality':r.outcome==='miss'?'Weak quality':'Neutral / unrated'}
                          {onOpenSymbol?' · tap for chart':''}
                        </div>
                      </div>
                      <div style={{textAlign:'right',flexShrink:0}}>
                        <div style={{fontSize:12,fontWeight:700,color:growthColor(r.salesYoy)}}>Sales {fmtPct(r.salesYoy)}</div>
                        <div style={{fontSize:12,fontWeight:700,color:growthColor(r.patYoy)}}>PAT {fmtPct(r.patYoy)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {subTab==='upcoming'&&(
            <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden'}}>
              <div style={{padding:'10px 14px',borderBottom:`1px solid ${C.divider}`,fontSize:12,fontWeight:700,color:C.muted}}>
                {upcoming.length} in universe still without {quarter} {fy} numbers
              </div>
              {upcoming.length===0?(
                <div style={{padding:24,color:C.muted,fontSize:13}}>Everyone in this filter has declared — or the universe is empty.</div>
              ):(
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))',gap:8,padding:12}}>
                  {upcoming.map(r=>(
                    <button key={r.sym} type="button" onClick={()=>onOpenSymbol?.(r.sym)}
                      style={{textAlign:'left',padding:'10px 12px',borderRadius:8,border:`1px solid ${C.border}`,
                        background:C.bg,color:C.text,cursor:'pointer'}}>
                      <div style={{fontWeight:700,fontSize:12}}>{r.sym}</div>
                      <div style={{fontSize:10,color:C.muted,marginTop:2}}>RS {r.rs||'—'}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {subTab==='leaderboard'&&(
            <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden'}}>
              <div style={{padding:'10px 14px',borderBottom:`1px solid ${C.divider}`,fontSize:12,fontWeight:700,color:C.muted}}>
                Top PAT YoY among declared
              </div>
              {leaderboard.map((r,i)=>(
                <div key={r.sym} onClick={()=>onOpenSymbol?.(r.sym)}
                  style={{display:'flex',alignItems:'center',gap:12,padding:'10px 14px',
                    borderBottom:`1px solid ${C.divider}`,cursor:onOpenSymbol?'pointer':'default'}}>
                  <div style={{width:24,color:C.muted,fontSize:11,fontWeight:700}}>#{i+1}</div>
                  <div style={{flex:1,fontWeight:700,fontSize:13}}>{r.sym}</div>
                  <div style={{fontSize:13,fontWeight:800,color:growthColor(r.patYoy)}}>{fmtPct(r.patYoy)}</div>
                </div>
              ))}
              {leaderboard.length===0&&(
                <div style={{padding:24,color:C.muted,fontSize:13}}>No PAT YoY data for this season yet.</div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
