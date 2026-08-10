import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Dockable / floating panel chrome: drag to move (undocks), minimize, close.
 * When not floating, fills its parent flex slot (docked).
 */
export default function PanelWindow({
  id,
  title,
  children,
  colors: C,
  open = true,
  minimized = false,
  onMinimize,
  onRestore,
  onClose,
  floating = null, // { x, y, w, h } | null
  onFloatingChange,
  dockStyle = {},
  zIndex = 40,
  headerExtra = null,
  showClose = true,
  showMinimize = true,
  hideHeader = false,
}) {
  const dragRef = useRef(null)

  const startDrag = useCallback((e) => {
    if (e.button !== 0) return
    if (e.target.closest('button,a,input,select,textarea')) return
    e.preventDefault()
    const startX = e.clientX
    const startY = e.clientY
    const rect = e.currentTarget.closest('[data-panel-window]')?.getBoundingClientRect()
    if (!rect) return
    const orig = floating || {
      x: rect.left,
      y: rect.top,
      w: Math.max(320, rect.width),
      h: Math.max(220, rect.height),
    }
    // Undock on first drag
    if (!floating) onFloatingChange?.(orig)

    const onMove = (ev) => {
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      onFloatingChange?.({
        ...orig,
        x: Math.max(0, Math.min(window.innerWidth - 120, orig.x + dx)),
        y: Math.max(0, Math.min(window.innerHeight - 48, orig.y + dy)),
      })
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      dragRef.current = null
    }
    dragRef.current = { onMove, onUp }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [floating, onFloatingChange])

  useEffect(() => () => {
    if (dragRef.current) {
      window.removeEventListener('mousemove', dragRef.current.onMove)
      window.removeEventListener('mouseup', dragRef.current.onUp)
    }
  }, [])

  if (!open) return null
  if (minimized) return null

  const isFloat = !!floating
  const wrapStyle = isFloat
    ? {
        position: 'fixed',
        left: floating.x,
        top: floating.y,
        width: floating.w,
        height: floating.h,
        zIndex,
        display: 'flex',
        flexDirection: 'column',
        background: C.sidebar || C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        boxShadow: '0 12px 40px rgba(0,0,0,0.55)',
        overflow: 'hidden',
      }
    : {
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        minHeight: 0,
        overflow: 'hidden',
        background: C.sidebar || C.card,
        border: `1px solid ${C.divider || C.border}`,
        borderRadius: 8,
        ...dockStyle,
      }

  const btn = {
    background: 'transparent',
    border: `1px solid ${C.border}`,
    color: C.muted,
    fontSize: 12,
    width: 26,
    height: 22,
    borderRadius: 4,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    lineHeight: 1,
    padding: 0,
  }

  return (
    <div data-panel-window={id} style={wrapStyle}>
      {!hideHeader && (
        <div
          onMouseDown={startDrag}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            padding: '6px 8px',
            height: 34,
            flexShrink: 0,
            cursor: 'grab',
            background: C.card,
            borderBottom: `1px solid ${C.divider || C.border}`,
            userSelect: 'none',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
            <span style={{ fontSize: 10, color: C.muted, letterSpacing: 0.4 }}>⋮⋮</span>
            <span style={{
              fontWeight: 700, fontSize: 12, color: C.text,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{title}</span>
            {headerExtra}
          </div>
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            {isFloat && (
              <button
                type="button"
                title="Dock back"
                onClick={() => onFloatingChange?.(null)}
                style={btn}
              >⧉</button>
            )}
            {showMinimize && (
              <button type="button" title="Minimize" onClick={onMinimize} style={btn}>─</button>
            )}
            {showClose && (
              <button type="button" title="Close" onClick={onClose} style={{ ...btn, fontSize: 14 }}>×</button>
            )}
          </div>
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {children}
      </div>
      {isFloat && (
        <div
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            const startX = e.clientX
            const startY = e.clientY
            const orig = { ...floating }
            const onMove = (ev) => {
              onFloatingChange?.({
                ...orig,
                w: Math.max(280, orig.w + (ev.clientX - startX)),
                h: Math.max(180, orig.h + (ev.clientY - startY)),
              })
            }
            const onUp = () => {
              window.removeEventListener('mousemove', onMove)
              window.removeEventListener('mouseup', onUp)
            }
            window.addEventListener('mousemove', onMove)
            window.addEventListener('mouseup', onUp)
          }}
          title="Resize"
          style={{
            position: 'absolute', right: 2, bottom: 2, width: 14, height: 14,
            cursor: 'nwse-resize', opacity: 0.5,
            background: `linear-gradient(135deg, transparent 50%, ${C.border} 50%)`,
          }}
        />
      )}
    </div>
  )
}

/** Wraps screener: plain column on mobile, window chrome on desktop. */
export function ScreenerFrame({
  isMobile,
  visible = true,
  children,
  title,
  colors: C,
  floating,
  onFloatingChange,
  onMinimize,
  onClose,
  dockStyle = {},
}) {
  if (!visible) return null
  if (isMobile) {
    return (
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        overflowX: 'hidden',
        paddingBottom: 72,
        ...dockStyle,
      }}>
        {children}
      </div>
    )
  }
  // Docked: chrome lives in the app top bar (single row). Floating: show window title bar for drag.
  return (
    <PanelWindow
      id="screener"
      title={title}
      colors={C}
      floating={floating}
      onFloatingChange={onFloatingChange}
      onMinimize={onMinimize}
      onClose={onClose}
      hideHeader={!floating}
      dockStyle={{
        height: '100%',
        minWidth: 0,
        overflowX: 'hidden',
        borderRadius: 0,
        border: 'none',
        borderRight: `1px solid ${C.divider || C.border}`,
        background: C.bg || C.sidebar,
        ...dockStyle,
      }}
      zIndex={45}
    >
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        overflowX: 'hidden',
        height: '100%',
      }}>
        {children}
      </div>
    </PanelWindow>
  )
}

const TASKBAR_POS_KEY = 'lakshmimata-taskbar-chip-pos'

function loadTaskbarChipPos() {
  try {
    const raw = JSON.parse(localStorage.getItem(TASKBAR_POS_KEY) || '{}')
    return raw && typeof raw === 'object' ? raw : {}
  } catch {
    return {}
  }
}

function saveTaskbarChipPos(map) {
  try {
    localStorage.setItem(TASKBAR_POS_KEY, JSON.stringify(map))
  } catch { /* ignore */ }
}

function defaultChipPos(index) {
  const w = typeof window !== 'undefined' ? window.innerWidth : 1200
  const h = typeof window !== 'undefined' ? window.innerHeight : 800
  // Stack from bottom-left, offset so chips don't overlap.
  return {
    x: Math.min(w - 160, 68 + (index % 4) * 150),
    y: Math.max(48, h - 52 - Math.floor(index / 4) * 40),
  }
}

/** Movable chips for minimized / closed-restorable panels (drag to reposition, click to restore). */
export function PanelTaskbar({ items, colors: C }) {
  const [posMap, setPosMap] = useState(loadTaskbarChipPos)
  const dragRef = useRef(null)

  useEffect(() => () => {
    if (dragRef.current) {
      window.removeEventListener('mousemove', dragRef.current.onMove)
      window.removeEventListener('mouseup', dragRef.current.onUp)
    }
  }, [])

  if (!items?.length) return null

  const startChipDrag = (e, id, index) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startY = e.clientY
    const cur = posMap[id] || defaultChipPos(index)
    let moved = false
    const onMove = (ev) => {
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      if (!moved && Math.hypot(dx, dy) < 5) return
      moved = true
      const next = {
        x: Math.max(8, Math.min(window.innerWidth - 80, cur.x + dx)),
        y: Math.max(8, Math.min(window.innerHeight - 36, cur.y + dy)),
      }
      setPosMap((prev) => {
        const map = { ...prev, [id]: next }
        saveTaskbarChipPos(map)
        return map
      })
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      dragRef.current = null
      // Click without drag → restore panel
      if (!moved) items.find((it) => it.id === id)?.onRestore?.()
    }
    dragRef.current = { onMove, onUp }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <>
      {items.map((it, index) => {
        const pos = posMap[it.id] || defaultChipPos(index)
        return (
          <button
            key={it.id}
            type="button"
            onMouseDown={(e) => startChipDrag(e, it.id, index)}
            title={`${it.title} — drag to move, click to restore`}
            style={{
              position: 'fixed',
              left: pos.x,
              top: pos.y,
              zIndex: 90,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '7px 12px',
              borderRadius: 8,
              border: `1px solid ${C.border}`,
              background: C.card,
              color: C.text,
              fontSize: 11,
              fontWeight: 700,
              cursor: 'grab',
              boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
              maxWidth: 240,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              userSelect: 'none',
            }}
          >
            <span style={{ fontSize: 10, color: C.muted, letterSpacing: 0.4 }}>⋮⋮</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {it.minimized ? '▢ ' : ''}{it.title}
            </span>
          </button>
        )
      })}
    </>
  )
}
