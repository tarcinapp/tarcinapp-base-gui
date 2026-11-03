/** Visibility badge */
export function VisibilityBadge({ value }) {
 const map = {
 public: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
 protected: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800',
 private: 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800',
 }
 const cls = map[value] ?? 'bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400 border-gray-200 dark:border-slate-700'
 return (
 <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium border ${cls}`}>
 {value ?? '—'}
 </span>
 )
}

/** Generic kind / tag badge */
export function KindBadge({ value }) {
 return (
 <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
 {value ?? '—'}
 </span>
 )
}

/** Datetime cell formatter */
export function DateCell({ value }) {
 if (!value) return <span className="text-gray-300 dark:text-slate-600">—</span>
 const d = new Date(value)
 return (
 <span className="font-mono text-xs text-gray-500 dark:text-slate-400">
 {d.toLocaleDateString()} {d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
 </span>
 )
}
