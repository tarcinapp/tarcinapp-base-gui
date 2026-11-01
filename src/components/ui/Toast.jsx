export default function Toast({ message, onClose, type = 'error' }) {
  if (!message) return null

  const stylesByType = {
    error: 'bg-rose-50 dark:bg-rose-950/95 border-rose-200 dark:border-rose-700 text-rose-700 dark:text-rose-100',
    success: 'bg-emerald-50 dark:bg-emerald-950/95 border-emerald-200 dark:border-emerald-700 text-emerald-700 dark:text-emerald-100',
    info: 'bg-white dark:bg-slate-900/95 border-gray-200 dark:border-slate-600 text-gray-800 dark:text-slate-100',
  }

  return (
    <div className="fixed right-4 top-4 z-50 max-w-md">
      <div
        role="alert"
        className={`flex items-start gap-3 rounded-lg border px-3 py-2 shadow-xl backdrop-blur ${stylesByType[type] ?? stylesByType.error}`}
      >
        <span className="text-sm leading-5">{message}</span>
        <button
          onClick={onClose}
          className="ml-auto rounded p-1 text-xs opacity-80 hover:opacity-100"
          aria-label="Dismiss notification"
          title="Dismiss"
        >
          x
        </button>
      </div>
    </div>
  )
}
