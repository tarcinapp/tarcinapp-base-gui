const CONFIRM_VARIANTS = {
  danger:  'bg-rose-700 hover:bg-rose-600',
  success: 'bg-emerald-700 hover:bg-emerald-600',
  warning: 'bg-amber-600 hover:bg-amber-500',
}

export default function ConfirmDialog({ open, title, message, onConfirm, onCancel, confirmLabel = 'Delete', cancelLabel = 'Cancel', confirmVariant = 'danger' }) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onCancel}
      />

      {/* Panel */}
      <div className="relative z-10 w-full max-w-sm mx-4 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl">
        <div className="p-6">
          <h3
            id="confirm-dialog-title"
            className="text-base font-semibold text-gray-900 dark:text-slate-100 mb-2"
          >
            {title ?? 'Are you sure?'}
          </h3>
          {message && (
            <p className="text-sm text-gray-500 dark:text-slate-400 mb-6">{message}</p>
          )}
          <div className="flex items-center justify-end gap-3">
            <button
              onClick={onCancel}
              className="px-4 py-2 text-sm rounded-lg bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 border border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-300 hover:text-gray-900 dark:hover:text-white transition-colors"
            >
              {cancelLabel}
            </button>
            <button
              onClick={onConfirm}
              className={`px-4 py-2 text-sm rounded-lg text-white transition-colors ${CONFIRM_VARIANTS[confirmVariant] ?? CONFIRM_VARIANTS.danger}`}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
