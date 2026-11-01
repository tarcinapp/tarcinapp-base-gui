/**
 * VisualFilterBuilder.jsx
 *
 * Displays the current filter expression as an interactive token line.
 * Users can:
 *   • Click an operator token to toggle it between AND / OR
 *   • Click the × on a set token to remove it (and the adjacent operator)
 *   • Click ( ) to add/remove grouping parentheses around adjacent set tokens
 *   • See the resulting human-readable expression
 *
 * Props:
 *   expr        {object|null}   FilterExpr AST (from filterExpr.js)
 *   onChange    {(expr) => void}  Called with updated AST after mutation
 */

import { useMemo } from 'react'
import { exprToTokens, tokensToExpr } from '../../utils/filterExpr'

function formatSetLabel(key) {
  if (!key) return ''
  const first = key.charAt(0).toUpperCase()
  return `${first}${key.slice(1)}`
}

// ─── Mutation helpers on a flat token list ───────────────────────────────────

/**
 * Remove a set token at `index` plus the adjacent operator token.
 * If the set is surrounded by parens that become empty, remove them too.
 */
function removeSetToken(tokens, index) {
  const copy = [...tokens]
  // Find adjacent op: prefer the op immediately before (index-1), else after (index+1)
  const prevOp = index > 0 && copy[index - 1]?.type === 'op' ? index - 1 : null
  const nextOp = index < copy.length - 1 && copy[index + 1]?.type === 'op' ? index + 1 : null

  let toRemove = new Set([index])
  if (prevOp !== null) toRemove.add(prevOp)
  else if (nextOp !== null) toRemove.add(nextOp)

  let result = copy.filter((_, i) => !toRemove.has(i))

  // Clean up empty parens pairs
  result = cleanEmptyParens(result)
  return result
}

/** Remove any consecutive ( ) pairs with nothing between them. */
function cleanEmptyParens(tokens) {
  let prev = null
  let result = tokens
  do {
    prev = result
    const out = []
    let i = 0
    while (i < result.length) {
      if (result[i]?.type === 'lparen' && result[i + 1]?.type === 'rparen') {
        i += 2 // skip the empty pair
      } else {
        out.push(result[i])
        i++
      }
    }
    result = out
  } while (result.length !== prev.length)
  return result
}

/**
 * Toggle the operator token at `index` between AND and OR.
 */
function toggleOpToken(tokens, index) {
  return tokens.map((t, i) =>
    i === index && t.type === 'op'
      ? { ...t, op: t.op === 'and' ? 'or' : 'and' }
      : t
  )
}

/**
 * Wrap the set tokens at indices [from, to] (inclusive) in a ( ) group.
 * from/to must point at set tokens (not ops or parens).
 * The range must include all operator tokens between from and to.
 */
function wrapInParens(tokens, fromIdx, toIdx) {
  const copy = [...tokens]
  const lparen = { type: 'lparen', id: `lp-${Date.now()}` }
  const rparen = { type: 'rparen', id: `rp-${Date.now()}` }

  // Expand range to include ops between set tokens
  let start = fromIdx
  let end = toIdx
  // Grow left past any op just before start
  if (start > 0 && copy[start - 1]?.type === 'op') start--
  // Grow right past any op just after end
  if (end < copy.length - 1 && copy[end + 1]?.type === 'op') end++

  return [
    ...copy.slice(0, start),
    lparen,
    ...copy.slice(start, end + 1),
    rparen,
    ...copy.slice(end + 1),
  ]
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function VisualFilterBuilder({ expr, onChange }) {
  const tokens = useMemo(() => exprToTokens(expr), [expr])

  if (!expr || tokens.length === 0) return null

  function handleRemoveSet(index) {
    const next = removeSetToken(tokens, index)
    onChange(tokensToExpr(next))
  }

  function handleToggleOp(index) {
    const next = toggleOpToken(tokens, index)
    onChange(tokensToExpr(next))
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 rounded-lg bg-gray-50 dark:bg-slate-950 border border-gray-200 dark:border-slate-700/60 min-h-[38px]">
      <span className="text-[10px] text-gray-300 dark:text-slate-600 font-mono uppercase tracking-wider shrink-0">sets</span>
      <span className="text-gray-200 dark:text-slate-700 text-xs shrink-0">›</span>
      {tokens.map((token, i) => {
        if (token.type === 'set') {
          const setLabel = formatSetLabel(token.key)
          return (
            <span
              key={token.id}
              className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded border text-xs font-mono bg-gray-100 dark:bg-slate-800 border-gray-200 dark:border-slate-600 text-gray-700 dark:text-slate-300"
            >
              {setLabel}
              <button
                type="button"
                onClick={() => handleRemoveSet(i)}
                className="opacity-50 hover:opacity-100 transition-opacity ml-0.5"
                aria-label={`Remove ${setLabel}`}
              >
                <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </span>
          )
        }

        if (token.type === 'op') {
          return (
            <button
              key={token.id}
              type="button"
              onClick={() => handleToggleOp(i)}
              title="Click to toggle AND / OR"
              className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono uppercase border transition-colors ${
                token.op === 'and'
                  ? 'bg-blue-100 dark:bg-blue-900/40 border-blue-300 dark:border-blue-700 text-blue-600 dark:text-blue-400 hover:bg-blue-600 dark:hover:bg-blue-700 hover:text-white'
                  : 'bg-amber-100 dark:bg-amber-900/40 border-amber-300 dark:border-amber-700 text-amber-600 dark:text-amber-400 hover:bg-amber-600 dark:hover:bg-amber-700 hover:text-white'
              }`}
            >
              {token.op}
            </button>
          )
        }

        if (token.type === 'lparen') {
          return (
            <span key={token.id} className="text-gray-500 dark:text-slate-300 text-base font-mono font-bold select-none leading-none">(</span>
          )
        }

        if (token.type === 'rparen') {
          return (
            <span key={token.id} className="text-gray-500 dark:text-slate-300 text-base font-mono font-bold select-none leading-none">)</span>
          )
        }

        return null
      })}

      {/* Clear entire expression */}
      <button
        type="button"
        onClick={() => onChange(null)}
        className="ml-auto flex items-center justify-center w-5 h-5 rounded text-gray-300 dark:text-slate-600 hover:text-rose-500 dark:hover:text-rose-400 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
        title="Clear filter expression"
        aria-label="Clear filter expression"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}
