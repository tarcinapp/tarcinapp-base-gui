import { useMemo } from 'react'
import { whereExprToTokens, whereTokensToExpr } from '../../utils/whereFilterExpr'

function removeConditionToken(tokens, index) {
  const copy = [...tokens]
  const prevOp = index > 0 && copy[index - 1]?.type === 'op' ? index - 1 : null
  const nextOp = index < copy.length - 1 && copy[index + 1]?.type === 'op' ? index + 1 : null

  const toRemove = new Set([index])
  if (prevOp !== null) toRemove.add(prevOp)
  else if (nextOp !== null) toRemove.add(nextOp)

  let result = copy.filter((_, i) => !toRemove.has(i))

  let changed = true
  while (changed) {
    changed = false
    const next = []
    for (let i = 0; i < result.length; i += 1) {
      if (result[i]?.type === 'lparen' && result[i + 1]?.type === 'rparen') {
        changed = true
        i += 1
        continue
      }
      next.push(result[i])
    }
    result = next
  }

  return result
}

function toggleOpToken(tokens, index) {
  return tokens.map((t, i) =>
    i === index && t.type === 'op'
      ? { ...t, op: t.op === 'and' ? 'or' : 'and' }
      : t
  )
}

export default function VisualWhereFilterBuilder({ expr, onChange }) {
  const tokens = useMemo(() => whereExprToTokens(expr), [expr])

  if (!expr || tokens.length === 0) return null

  function handleRemoveCondition(index) {
    const next = removeConditionToken(tokens, index)
    onChange(whereTokensToExpr(next))
  }

  function handleToggleOp(index) {
    const next = toggleOpToken(tokens, index)
    onChange(whereTokensToExpr(next))
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 rounded-lg bg-gray-50 dark:bg-slate-950 border border-gray-200 dark:border-slate-700/60 min-h-[38px]">
      <span className="text-[10px] text-gray-300 dark:text-slate-600 font-mono uppercase tracking-wider shrink-0">fields</span>
      <span className="text-gray-200 dark:text-slate-700 text-xs shrink-0">›</span>
      {tokens.map((token, i) => {
        if (token.type === 'condition') {
          return (
            <span
              key={token.id}
              className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded border text-xs font-mono bg-gray-100 dark:bg-slate-800 border-gray-200 dark:border-slate-600 text-gray-700 dark:text-slate-300"
              title={token.label}
            >
              <span className="max-w-[360px] truncate">{token.label}</span>
              <button
                type="button"
                onClick={() => handleRemoveCondition(i)}
                className="opacity-50 hover:opacity-100 transition-opacity ml-0.5"
                aria-label={`Remove ${token.label}`}
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

      <button
        type="button"
        onClick={() => onChange(null)}
        className="ml-auto flex items-center justify-center w-5 h-5 rounded text-gray-300 dark:text-slate-600 hover:text-rose-500 dark:hover:text-rose-400 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
        title="Clear field filter expression"
        aria-label="Clear field filter expression"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}
