import { useEffect, useState } from 'react'
import Toast from './Toast'
import ConfirmDialog from './ConfirmDialog'

function buildItemPath(template, id) {
  return template.replace(/\{[^}]+\}/, encodeURIComponent(id))
}

function formatValue(val) {
  if (Array.isArray(val)) return val.length === 0 ? '—' : val.join(', ')
  if (val === null || val === undefined) return '—'
  if (typeof val === 'object') return JSON.stringify(val)
  return String(val)
}

function EditorActions({ onCommit, onCancel }) {
  return (
    <div className="flex gap-2 mt-2">
      <button type="button" onClick={onCommit} className="px-2.5 py-1 text-xs rounded-md bg-blue-600 hover:bg-blue-500 text-white transition-colors">Apply</button>
      <button type="button" onClick={onCancel} className="px-2.5 py-1 text-xs rounded-md border border-gray-300 dark:border-slate-600 text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300 hover:border-gray-400 dark:hover:border-slate-500 transition-colors">Cancel</button>
    </div>
  )
}

function FieldEditor({ currentValue, schema, onCommit, onCancel }) {
  const rawType = schema?.type
  const format = schema?.format
  const enumVals = Array.isArray(schema?.enum) ? schema.enum : null
  const nullable = schema?.nullable === true || (Array.isArray(rawType) && rawType.includes('null'))
  const actualType = Array.isArray(rawType) ? rawType.find((t) => t !== 'null') ?? 'string' : rawType ?? 'string'
  const [localVal, setLocalVal] = useState(currentValue)
  const [arrayInput, setArrayInput] = useState('')

  if (actualType === 'boolean') {
    const opts = [true, false, ...(nullable ? [null] : [])]
    return (
      <div>
        <div className="flex gap-1.5 mt-1">
          {opts.map((v) => (
            <button key={String(v)} type="button" onClick={() => setLocalVal(v)}
              className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${localVal === v ? 'bg-blue-600 border-blue-500 text-white' : 'border-gray-300 dark:border-slate-600 text-gray-500 dark:text-slate-400 hover:border-gray-400 dark:hover:border-slate-500 hover:text-gray-700 dark:hover:text-slate-300'}`}
            >{v === null ? 'null' : String(v)}</button>
          ))}
        </div>
        <EditorActions onCommit={() => onCommit(localVal)} onCancel={onCancel} />
      </div>
    )
  }

  const VISIBILITY_VALS = ['public', 'protected', 'private']
  if (enumVals?.length === VISIBILITY_VALS.length && VISIBILITY_VALS.every((v) => enumVals.includes(v))) {
    const opts = [...enumVals, ...(nullable ? [null] : [])]
    return (
      <div>
        <div className="inline-flex mt-1 rounded-lg border border-gray-200 dark:border-slate-700 overflow-hidden">
          {opts.map((v) => (
            <button key={String(v)} type="button" onClick={() => setLocalVal(v)}
              className={`px-3 py-1.5 text-xs border-r border-gray-200 dark:border-slate-700 last:border-r-0 transition-colors ${localVal === v ? 'bg-blue-600 text-white' : 'bg-gray-50 dark:bg-slate-800 text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-slate-700'}`}
            >{v === null ? 'null' : String(v)}</button>
          ))}
        </div>
        <EditorActions onCommit={() => onCommit(localVal)} onCancel={onCancel} />
      </div>
    )
  }

  if (enumVals?.length) {
    return (
      <div>
        <select value={localVal ?? ''} onChange={(e) => setLocalVal(e.target.value === '' ? null : e.target.value)}
          className="mt-1 w-full bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-md px-2 py-1.5 text-sm text-gray-900 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500">
          {nullable && <option value="">null</option>}
          {enumVals.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <EditorActions onCommit={() => onCommit(localVal)} onCancel={onCancel} />
      </div>
    )
  }

  if (format === 'date-time') {
    const toInput = (v) => (v ? String(v).slice(0, 16) : '')
    const fromInput = (s) => (s ? new Date(s).toISOString() : null)
    return (
      <div>
        <input type="datetime-local" value={toInput(localVal)} onChange={(e) => setLocalVal(fromInput(e.target.value))}
          className="mt-1 w-full bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-md px-2 py-1.5 text-sm text-gray-900 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500" />
        <EditorActions onCommit={() => onCommit(localVal)} onCancel={onCancel} />
      </div>
    )
  }

  if (actualType === 'integer' || actualType === 'number') {
    return (
      <div>
        <input type="number" step={actualType === 'integer' ? 1 : 'any'} value={localVal ?? ''}
          onChange={(e) => setLocalVal(e.target.value === '' ? null : Number(e.target.value))}
          className="mt-1 w-full bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-md px-2 py-1.5 text-sm text-gray-900 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500" />
        <EditorActions onCommit={() => onCommit(localVal)} onCancel={onCancel} />
      </div>
    )
  }

  if (actualType === 'array') {
    const arr = Array.isArray(localVal) ? localVal : []
    const addItem = () => {
      const trimmed = arrayInput.trim()
      if (!trimmed) return
      setLocalVal([...arr, trimmed])
      setArrayInput('')
    }
    return (
      <div className="mt-1">
        <div className="flex flex-wrap gap-1.5 mb-2 min-h-[24px]">
          {arr.length === 0 ? <span className="text-xs text-gray-400 dark:text-slate-500 italic">empty</span> : arr.map((it, i) => (
            <span key={i} className="flex items-center gap-1 px-2 py-0.5 bg-gray-100 dark:bg-slate-700 rounded text-xs text-gray-700 dark:text-slate-200">
              {String(it)}
              <button type="button" onClick={() => setLocalVal(arr.filter((_, j) => j !== i))} className="text-gray-400 dark:text-slate-400 hover:text-red-500 dark:hover:text-red-400 leading-none">&times;</button>
            </span>
          ))}
        </div>
        <div className="flex gap-1.5">
          <input value={arrayInput} onChange={(e) => setArrayInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addItem() } }}
            placeholder="Type item and press Enter"
            className="flex-1 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-md px-2 py-1 text-xs text-gray-900 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500" />
          <button type="button" onClick={addItem} className="px-2 py-1 text-xs rounded-md bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 text-gray-600 dark:text-slate-300 transition-colors">Add</button>
        </div>
        <EditorActions onCommit={() => onCommit(localVal)} onCancel={onCancel} />
      </div>
    )
  }

  return (
    <div>
      <input autoFocus type="text" value={localVal ?? ''} onChange={(e) => setLocalVal(e.target.value)}
        className="mt-1 w-full bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-md px-2 py-1.5 text-sm text-gray-900 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500" />
      <EditorActions onCommit={() => onCommit(localVal)} onCancel={onCancel} />
    </div>
  )
}

function EditableFieldRow({ label, displayValue, schema, isEditing, isPending, canEdit, onEdit, onCommit, onCancel, onRevert }) {
  if (isEditing) {
    return (
      <div className="rounded-lg bg-gray-50 dark:bg-slate-800/40 border border-gray-200 dark:border-slate-700/60 p-2.5">
        <p className="text-[10px] text-gray-400 dark:text-slate-400 uppercase tracking-wide mb-0.5">{label}</p>
        <FieldEditor currentValue={displayValue} schema={schema} onCommit={onCommit} onCancel={onCancel} />
      </div>
    )
  }
  return (
    <div className="group">
      <div className="flex items-center justify-between mb-0.5">
        <p className="text-[10px] text-gray-400 dark:text-slate-500 uppercase tracking-wide">{label}</p>
        <div className="flex items-center gap-0.5">
          {isPending && onRevert && (
            <button type="button" onClick={onRevert}
              className="opacity-0 group-hover:opacity-100 flex items-center justify-center w-5 h-5 rounded text-amber-500 hover:text-amber-400 hover:bg-gray-100 dark:hover:bg-slate-700 transition-all"
              title="Revert to original" aria-label={`Revert ${label}`}>
              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6M3 10l6-6" /></svg>
            </button>
          )}
          {canEdit && (
            <button type="button" onClick={onEdit}
              className="opacity-0 group-hover:opacity-100 flex items-center justify-center w-5 h-5 rounded text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700 transition-all"
              aria-label={`Edit ${label}`}>
              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
            </button>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        {isPending && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0 mt-0.5" title="Unsaved change" />}
        <p className={`text-sm break-all ${isPending ? 'text-amber-600 dark:text-amber-200' : (displayValue === null || displayValue === undefined) ? 'text-gray-400 dark:text-slate-500 italic' : 'text-gray-800 dark:text-slate-200'}`}>
          {formatValue(displayValue)}
        </p>
      </div>
    </div>
  )
}

/**
 * ItemEditModal — portable editable record modal.
 *
 * Props:
 *  navItem          – navItem with itemPathTemplate, itemMethods, itemSchemaProps, label
 *  initialRecord    – the record object (used while fresh data is loading)
 *  api              – { get, patch } from useApiClient()
 *  onClose          – called when the modal is dismissed
 *  onSaved          – optional, called after a successful PATCH
 */
export default function ItemEditModal({ navItem, initialRecord, api, onClose, onSaved }) {
  const itemPath = buildItemPath(navItem.itemPathTemplate, initialRecord._id ?? initialRecord.id)
  const schemaProps = navItem.itemSchemaProps ?? {}
  const hasPatch = navItem.itemMethods?.includes('patch')

  const [record, setRecord] = useState(initialRecord)
  const [loading, setLoading] = useState(true)
  const [pendingEdits, setPendingEdits] = useState({})
  const [editingField, setEditingField] = useState(null)
  const [saving, setSaving] = useState(false)
  const [patchError, setPatchError] = useState(null)
  const [managedOpen, setManagedOpen] = useState(false)
  const [toastSuccess, setToastSuccess] = useState(null)
  const [toastError, setToastError] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.get(itemPath)
      .then((data) => { if (!cancelled) { setRecord(data); setLoading(false) } })
      .catch(() => { if (!cancelled) { setRecord(initialRecord); setLoading(false) } })
    return () => { cancelled = true }
  }, [itemPath])

  useEffect(() => {
    if (!toastSuccess) return undefined
    const t = setTimeout(() => setToastSuccess(null), 3000)
    return () => clearTimeout(t)
  }, [toastSuccess])

  useEffect(() => {
    if (!toastError) return undefined
    const t = setTimeout(() => setToastError(null), 3500)
    return () => clearTimeout(t)
  }, [toastError])

  function commitEdit(key, value) {
    setPendingEdits((prev) => ({ ...prev, [key]: value }))
    setEditingField(null)
  }

  function revertEdit(key) {
    setPendingEdits((prev) => { const n = { ...prev }; delete n[key]; return n })
  }

  async function handleSave() {
    setSaving(true)
    setPatchError(null)
    try {
      await api.patch(itemPath, pendingEdits)
      const fresh = await api.get(itemPath)
      setRecord(fresh)
      setPendingEdits({})
      setEditingField(null)
      setToastSuccess('Changes saved')
      onSaved?.()
    } catch (err) {
      const msg = err?.message ?? 'Save failed'
      setPatchError({ message: msg, details: err?.body?.error?.details ?? [] })
      setToastError(msg)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await api.del(itemPath)
      onSaved?.()
      onClose()
    } catch (err) {
      setToastError(err?.message ?? 'Delete failed')
    } finally {
      setDeleting(false)
    }
  }

  const displayRecord = { ...record, ...pendingEdits }
  const hasPendingEdits = Object.keys(pendingEdits).length > 0
  const canDelete = navItem.itemMethods?.includes('delete')

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-50 bg-black/40 dark:bg-slate-950/70 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />

      {/* Panel */}
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 pointer-events-none">
        <div className="pointer-events-auto w-full max-w-2xl max-h-[90vh] flex flex-col rounded-xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 shadow-2xl">

          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200 dark:border-slate-700 flex-shrink-0">
            <div>
              <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">{navItem.label}</h2>
              <p className="text-[11px] text-gray-400 dark:text-slate-500 font-mono mt-0.5 truncate max-w-[380px]">
                {initialRecord._id ?? initialRecord.id}
              </p>
            </div>
            <button onClick={onClose}
              className="flex items-center justify-center w-7 h-7 rounded-md text-gray-400 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-100 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
              aria-label="Close">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {loading ? (
              <div className="flex items-center gap-2 justify-center py-10">
                <svg className="animate-spin w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                <span className="text-gray-400 dark:text-slate-400 text-sm">Loading…</span>
              </div>
            ) : (
              <>
                {/* Header row */}
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-gray-400 dark:text-slate-500 uppercase tracking-wide">Fields</span>
                  {hasPatch && (
                    <span className="text-[10px] text-gray-300 dark:text-slate-600">Hover a field to edit</span>
                  )}
                </div>

                {/* _name first */}
                {('_name' in record || '_name' in schemaProps) && (
                  <EditableFieldRow
                    label="Name"
                    displayValue={pendingEdits._name !== undefined ? pendingEdits._name : (record._name ?? null)}
                    schema={schemaProps._name}
                    isEditing={editingField === '_name'}
                    isPending={'_name' in pendingEdits}
                    canEdit={hasPatch}
                    onEdit={() => setEditingField('_name')}
                    onCommit={(v) => commitEdit('_name', v)}
                    onCancel={() => setEditingField(null)}
                    onRevert={() => revertEdit('_name')}
                  />
                )}

                {/* Business (unmanaged) fields */}
                <div className="space-y-3">
                  {[...new Set([
                    ...Object.keys(record).filter((k) => !k.startsWith('_')),
                    ...Object.keys(schemaProps).filter((k) => !k.startsWith('_')),
                    ...Object.keys(pendingEdits).filter((k) => !k.startsWith('_')),
                  ])].map((key) => (
                    <EditableFieldRow
                      key={key}
                      label={key}
                      displayValue={pendingEdits[key] !== undefined ? pendingEdits[key] : (key in record ? record[key] : null)}
                      schema={schemaProps[key]}
                      isEditing={editingField === key}
                      isPending={key in pendingEdits}
                      canEdit={hasPatch}
                      onEdit={() => setEditingField(key)}
                      onCommit={(v) => commitEdit(key, v)}
                      onCancel={() => setEditingField(null)}
                      onRevert={() => revertEdit(key)}
                    />
                  ))}
                </div>

                {/* Managed fields (collapsible) */}
                <div className="border-t border-gray-200 dark:border-slate-700 pt-3">
                  <button onClick={() => setManagedOpen((o) => !o)}
                    className="flex items-center gap-1.5 mb-2 group cursor-pointer">
                    <p className="text-[10px] text-gray-400 dark:text-slate-500 uppercase tracking-wide group-hover:text-gray-600 dark:group-hover:text-slate-400 transition-colors">Managed fields</p>
                    <svg className={`w-3 h-3 text-gray-300 dark:text-slate-600 group-hover:text-gray-500 dark:group-hover:text-slate-400 transition-transform ${managedOpen ? 'rotate-180' : ''}`}
                      fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {managedOpen && (
                    <div className="space-y-2">
                      {Object.entries(record)
                        .filter(([k]) => k.startsWith('_') && k !== '_name')
                        .map(([key, val]) => (
                          <EditableFieldRow
                            key={key}
                            label={key}
                            displayValue={pendingEdits[key] !== undefined ? pendingEdits[key] : val}
                            schema={schemaProps[key]}
                            isEditing={editingField === key}
                            isPending={key in pendingEdits}
                            canEdit={hasPatch}
                            onEdit={() => setEditingField(key)}
                            onCommit={(v) => commitEdit(key, v)}
                            onCancel={() => setEditingField(null)}
                            onRevert={() => revertEdit(key)}
                          />
                        ))}
                    </div>
                  )}
                </div>

                {/* Pending edits save bar */}
                {hasPendingEdits && (
                  <div className="border-t border-gray-200 dark:border-slate-700 pt-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={handleSave} disabled={saving}
                        className="px-3 py-1.5 text-xs rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white transition-colors">
                        {saving ? 'Saving…' : `Save ${Object.keys(pendingEdits).length} change${Object.keys(pendingEdits).length > 1 ? 's' : ''}`}
                      </button>
                      <button type="button" onClick={() => { setPendingEdits({}); setEditingField(null); setPatchError(null) }} disabled={saving}
                        className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-slate-600 text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300 hover:border-gray-300 dark:hover:border-slate-500 disabled:opacity-50 transition-colors">
                        Discard
                      </button>
                    </div>
                    {patchError && (
                      <div className="text-red-500 dark:text-red-400 text-sm space-y-1">
                        <p>{patchError.message}</p>
                        {patchError.details?.length > 0 && (
                          <ul className="list-disc list-inside space-y-0.5 text-red-400 dark:text-red-300 text-xs">
                            {patchError.details.map((d, i) => (
                              <li key={i}>{d.field ? `${d.field}: ${d.message}` : d.message}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Footer — delete */}
          {!loading && canDelete && (
            <div className="flex items-center px-5 py-3.5 border-t border-gray-200 dark:border-slate-700 flex-shrink-0">
              <button onClick={() => setConfirmDelete(true)} disabled={deleting}
                className="ml-auto px-3 py-1.5 text-xs rounded-lg bg-rose-700 hover:bg-rose-600 disabled:opacity-50 text-white transition-colors">
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          )}
        </div>
      </div>

      <Toast message={toastSuccess} onClose={() => setToastSuccess(null)} type="success" />
      <Toast message={toastError} onClose={() => setToastError(null)} type="error" />
      <ConfirmDialog
        open={confirmDelete}
        title="Delete this record?"
        message="This action cannot be undone."
        confirmLabel="Yes, delete"
        onConfirm={() => { setConfirmDelete(false); handleDelete() }}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  )
}
