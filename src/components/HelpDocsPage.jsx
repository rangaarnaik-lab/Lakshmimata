import React, { useMemo, useState, useEffect } from 'react'
import {
  DOCS_CATEGORIES,
  DOCS_ARTICLES,
  getArticle,
  articlesForCategory,
  searchArticles,
} from '../content/helpDocs'

/**
 * Full-page Guide — beginner overview + how each component works.
 * `theme` is the live `C` palette from App.jsx.
 */
export default function HelpDocsPage({
  theme: C,
  initialArticleId = null,
  onOpenTab,
  onOpenHelp,
}) {
  const [category, setCategory] = useState('start')
  const [articleId, setArticleId] = useState(initialArticleId || 'start-overview')
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (initialArticleId && getArticle(initialArticleId)) {
      const a = getArticle(initialArticleId)
      setArticleId(a.id)
      setCategory(a.category)
    }
  }, [initialArticleId])

  const searching = query.trim().length > 0
  const list = useMemo(() => {
    if (searching) return searchArticles(query)
    return articlesForCategory(category)
  }, [category, query, searching])

  const article = getArticle(articleId) || list[0] || DOCS_ARTICLES[0]

  const openArticle = (id) => {
    const a = getArticle(id)
    if (!a) return
    setArticleId(id)
    if (!searching) setCategory(a.category)
  }

  return (
    <div style={{ padding: '4px 4px 28px', maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 800, fontSize: 18, color: C.text, letterSpacing: '-0.02em' }}>
          Guide — how Lakshmimata works
        </div>
        <div style={{ fontSize: 12.5, color: C.muted, marginTop: 6, lineHeight: 1.55, maxWidth: 640 }}>
          Written for newcomers and power users. Start with Getting started, then open any
          scanner or chart component to see what it is, how it works, and how to use it.
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search Guide — RS, Squeeze, Lakshmi Mata, Concall…"
            style={{
              flex: '1 1 220px',
              minWidth: 180,
              padding: '9px 12px',
              borderRadius: 10,
              border: `1px solid ${C.border}`,
              background: C.card,
              color: C.text,
              fontSize: 12.5,
              outline: 'none',
            }}
          />
          {onOpenHelp && (
            <button
              type="button"
              onClick={onOpenHelp}
              style={{
                padding: '9px 14px',
                borderRadius: 10,
                border: `1px solid ${C.border}`,
                background: C.card,
                color: C.text,
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Ask Guide (?)
            </button>
          )}
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 220px) minmax(0, 1fr)',
          gap: 14,
          alignItems: 'start',
        }}
        className="help-docs-grid"
      >
        {/* Category / results rail */}
        <div
          style={{
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: 12,
            padding: 10,
            position: 'sticky',
            top: 8,
          }}
        >
          {!searching && (
            <>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 800,
                  color: C.muted,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  margin: '2px 6px 8px',
                }}
              >
                Sections
              </div>
              {DOCS_CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => {
                    setCategory(cat.id)
                    const first = articlesForCategory(cat.id)[0]
                    if (first) setArticleId(first.id)
                  }}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '8px 10px',
                    marginBottom: 2,
                    borderRadius: 8,
                    border: 'none',
                    cursor: 'pointer',
                    background: category === cat.id ? C.accent + '22' : 'transparent',
                    color: category === cat.id ? C.accent : C.text,
                    fontSize: 12,
                    fontWeight: category === cat.id ? 800 : 600,
                  }}
                >
                  <span style={{ marginRight: 6 }}>{cat.emoji}</span>
                  {cat.label}
                </button>
              ))}
              <div style={{ height: 1, background: C.divider, margin: '10px 4px' }} />
            </>
          )}
          <div
            style={{
              fontSize: 10,
              fontWeight: 800,
              color: C.muted,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              margin: '2px 6px 8px',
            }}
          >
            {searching ? `Results (${list.length})` : 'In this section'}
          </div>
          <div style={{ maxHeight: '52vh', overflowY: 'auto' }}>
            {list.length === 0 && (
              <div style={{ padding: 10, fontSize: 12, color: C.muted }}>No matches. Try “squeeze” or “RS”.</div>
            )}
            {list.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => openArticle(a.id)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 10px',
                  marginBottom: 2,
                  borderRadius: 8,
                  border: 'none',
                  cursor: 'pointer',
                  background: article?.id === a.id ? C.active : 'transparent',
                  color: article?.id === a.id ? C.accent : C.muted,
                  fontSize: 11.5,
                  fontWeight: article?.id === a.id ? 800 : 600,
                  lineHeight: 1.35,
                }}
              >
                {a.title}
              </button>
            ))}
          </div>
        </div>

        {/* Article */}
        <div
          style={{
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: 12,
            padding: '18px 20px 22px',
            minHeight: 360,
          }}
        >
          {article && (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 800,
                    color: C.accent,
                    background: C.accent + '18',
                    border: `1px solid ${C.accent}44`,
                    borderRadius: 999,
                    padding: '3px 10px',
                  }}
                >
                  {DOCS_CATEGORIES.find((c) => c.id === article.category)?.label || article.category}
                </span>
                {article.tabId && onOpenTab && (
                  <button
                    type="button"
                    onClick={() => onOpenTab(article.tabId)}
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      padding: '4px 10px',
                      borderRadius: 8,
                      border: `1px solid ${C.border}`,
                      background: C.bg,
                      color: C.text,
                      cursor: 'pointer',
                    }}
                  >
                    Open {article.title} tab →
                  </button>
                )}
              </div>
              <h1
                style={{
                  margin: 0,
                  fontSize: 20,
                  fontWeight: 800,
                  color: C.text,
                  letterSpacing: '-0.02em',
                  lineHeight: 1.25,
                }}
              >
                {article.title}
              </h1>

              <div
                style={{
                  marginTop: 14,
                  padding: '12px 14px',
                  borderRadius: 10,
                  border: `1px solid ${C.accent}33`,
                  background: C.accent + '10',
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 800,
                    color: C.accent,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    marginBottom: 6,
                  }}
                >
                  For newcomers
                </div>
                <div style={{ fontSize: 13, color: C.text, lineHeight: 1.65 }}>{article.forNewcomers}</div>
              </div>

              {(article.sections || []).map((sec) => (
                <div key={sec.heading} style={{ marginTop: 18 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: C.text, marginBottom: 8 }}>{sec.heading}</div>
                  {sec.body && (
                    <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.7, marginBottom: sec.bullets ? 8 : 0 }}>
                      {sec.body}
                    </div>
                  )}
                  {sec.bullets && (
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {sec.bullets.map((b) => (
                        <li
                          key={b.slice(0, 48)}
                          style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.65, marginBottom: 6 }}
                        >
                          {b}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}

              <div
                style={{
                  marginTop: 22,
                  paddingTop: 14,
                  borderTop: `1px solid ${C.divider}`,
                  fontSize: 11.5,
                  color: C.muted,
                  lineHeight: 1.55,
                }}
              >
                Tip: press <strong style={{ color: C.text }}>?</strong> anywhere for Ask Guide (free, no AI cost), or
                search this Guide for “Lakshmi Mata”, “Squeeze Pro”, or “Super Cycle”.
              </div>
            </>
          )}
        </div>
      </div>

      <style>{`
        @media (max-width: 800px) {
          .help-docs-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  )
}
