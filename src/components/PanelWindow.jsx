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

/** Bottom taskbar chips for minimized / closed-restorable panels */
export function PanelTaskbar({ items, colors: C }) {
  if (!items?.length) return null
  return (
    <div style={{
      position: 'fixed', left: 60, right: 12, bottom: 10, zIndex: 90,
      display: 'flex', gap: 8, flexWrap: 'wrap', pointerEvents: 'none',
    }}>
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          onClick={it.onRestore}
          title={it.title}
          style={{
            pointerEvents: 'auto',
            padding: '6px 12px',
            borderRadius: 8,
            border: `1px solid ${C.border}`,
            background: C.card,
            color: C.text,
            fontSize: 11,
            fontWeight: 700,
            cursor: 'pointer',
            boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
            maxWidth: 220,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {it.minimized ? '▢ ' : ''}{it.title}
        </button>
      ))}
    </div>
  )
}
