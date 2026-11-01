/** Stat card used on the dashboard */
export default function StatCard({ label, value, delta, icon, color = 'blue' }) {
  const colorMap = {
    blue:   { bg: 'bg-blue-50 dark:bg-blue-600/10',     icon: 'text-blue-500 dark:text-blue-400',     border: 'border-blue-200 dark:border-blue-900/40' },
    green:  { bg: 'bg-emerald-50 dark:bg-emerald-600/10', icon: 'text-emerald-500 dark:text-emerald-400', border: 'border-emerald-200 dark:border-emerald-900/40' },
    amber:  { bg: 'bg-amber-50 dark:bg-amber-600/10',   icon: 'text-amber-500 dark:text-amber-400',   border: 'border-amber-200 dark:border-amber-900/40' },
    purple: { bg: 'bg-purple-50 dark:bg-purple-600/10', icon: 'text-purple-500 dark:text-purple-400', border: 'border-purple-200 dark:border-purple-900/40' },
    rose:   { bg: 'bg-rose-50 dark:bg-rose-600/10',     icon: 'text-rose-500 dark:text-rose-400',     border: 'border-rose-200 dark:border-rose-900/40' },
  }
  const c = colorMap[color] ?? colorMap.blue

  return (
    <div className={`rounded-2xl border ${c.border} ${c.bg} px-5 py-4 flex items-center gap-4`}>
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center bg-gray-100 dark:bg-slate-900/60 ${c.icon} flex-shrink-0`}>
        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
        </svg>
      </div>
      <div>
        <p className="text-2xl font-bold text-gray-900 dark:text-white leading-none">{value}</p>
        <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">{label}</p>
        {delta !== undefined && (
          <p className={`text-xs mt-0.5 font-medium ${delta >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {delta >= 0 ? '+' : ''}{delta}% vs last week
          </p>
        )}
      </div>
    </div>
  )
}
