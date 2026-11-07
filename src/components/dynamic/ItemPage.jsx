import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useApp } from '../../context/AppContext'
import { parseOasSpec } from '../../utils/oasParser'
import { useApiClient } from '../../services/apiClient'
import { useResourceList } from '../../hooks/useResourceList'
import Toast from '../ui/Toast'
import ConfirmDialog from '../ui/ConfirmDialog'

function buildItemPath(template, id) {
 return template.replace(/\{[^}]+\}/, encodeURIComponent(id))
}

function formatValue(val) {
 if (Array.isArray(val)) return val.length === 0 ? '\u2014' : val.join(', ')
 if (val === null || val === undefined) return '\u2014'
 if (typeof val === 'object') return JSON.stringify(val)
 return String(val)
}

function EditorActions({ onCommit, onCancel }) {
 return (
 <div className="flex gap-2 mt-2">
 <button
 type="button"
 onClick={onCommit}
 className="px-2.5 py-1 text-xs bg-blue-600 hover:bg-blue-500 text-white transition-colors"
 >
 Apply
 </button>
 <button
 type="button"
 onClick={onCancel}
 className="px-2.5 py-1 text-xs border border-gray-200 dark:border-slate-600 text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300 hover:border-gray-400 dark:hover:border-slate-500 transition-colors"
 >
 Cancel
 </button>
 </div>
 )
}

function FieldEditor({ currentValue, schema, onCommit, onCancel }) {
 const rawType = schema?.type
 const format = schema?.format
 const enumVals = Array.isArray(schema?.enum) ? schema.enum : null
 const nullable =
 schema?.nullable === true ||
 (Array.isArray(rawType) && rawType.includes('null'))
 const actualType = Array.isArray(rawType)
 ? rawType.find((t) => t !== 'null') ?? 'string'
 : rawType ?? 'string'

 const [localVal, setLocalVal] = useState(currentValue)
 const [arrayInput, setArrayInput] = useState('')

 // Boolean
 if (actualType === 'boolean') {
 const opts = [true, false, ...(nullable ? [null] : [])]
 return (
 <div>
 <div className="flex gap-1.5 mt-1">
 {opts.map((v) => (
 <button
 key={String(v)}
 type="button"
 onClick={() => setLocalVal(v)}
 className={`px-2.5 py-1 text-xs border transition-colors ${
 localVal === v
 ? 'bg-blue-600 border-blue-500 text-white'
 : 'border-gray-200 dark:border-slate-600 text-gray-500 dark:text-slate-400 hover:border-gray-400 dark:hover:border-slate-500 hover:text-gray-700 dark:hover:text-slate-300'
 }`}
 >
 {v === null ? 'null' : String(v)}
 </button>
 ))}
 </div>
 <EditorActions onCommit={() => onCommit(localVal)} onCancel={onCancel} />
 </div>
 )
 }

 // Visibility (public / protected / private) → button group
 const VISIBILITY_VALS = ['public', 'protected', 'private']
 if (
 enumVals?.length === VISIBILITY_VALS.length &&
 VISIBILITY_VALS.every((v) => enumVals.includes(v))
 ) {
 const opts = [...enumVals, ...(nullable ? [null] : [])]
 return (
 <div>
 <div className="inline-flex mt-1 border border-gray-200 dark:border-slate-700 overflow-hidden">
 {opts.map((v) => (
 <button
 key={String(v)}
 type="button"
 onClick={() => setLocalVal(v)}
 className={`px-3 py-1.5 text-xs border-r border-gray-200 dark:border-slate-700 last:border-r-0 transition-colors ${
 localVal === v
 ? 'bg-blue-600 text-white'
 : 'bg-gray-50 dark:bg-slate-800 text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-slate-700'
 }`}
 >
 {v === null ? 'null' : String(v)}
 </button>
 ))}
 </div>
 <EditorActions onCommit={() => onCommit(localVal)} onCancel={onCancel} />
 </div>
 )
 }

 // Enum
 if (enumVals?.length) {
 return (
 <div>
 <select
 value={localVal ?? ''}
 onChange={(e) => setLocalVal(e.target.value === '' ? null : e.target.value)}
 className="mt-1 w-full bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 px-2 py-1.5 text-sm text-gray-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
 >
 {nullable && <option value="">null</option>}
 {enumVals.map((v) => (
 <option key={v} value={v}>{v}</option>
 ))}
 </select>
 <EditorActions onCommit={() => onCommit(localVal)} onCancel={onCancel} />
 </div>
 )
 }

 // Date-time
 if (format === 'date-time') {
 const toInput = (v) => (v ? String(v).slice(0, 16) : '')
 const fromInput = (s) => (s ? new Date(s).toISOString() : null)
 return (
 <div>
 <input
 type="datetime-local"
 value={toInput(localVal)}
 onChange={(e) => setLocalVal(fromInput(e.target.value))}
 className="mt-1 w-full bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 px-2 py-1.5 text-sm text-gray-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
 />
 <EditorActions onCommit={() => onCommit(localVal)} onCancel={onCancel} />
 </div>
 )
 }

 // Number / Integer
 if (actualType === 'integer' || actualType === 'number') {
 return (
 <div>
 <input
 type="number"
 step={actualType === 'integer' ? 1 : 'any'}
 value={localVal ?? ''}
 onChange={(e) =>
 setLocalVal(e.target.value === '' ? null : Number(e.target.value))
 }
 className="mt-1 w-full bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 px-2 py-1.5 text-sm text-gray-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
 />
 <EditorActions onCommit={() => onCommit(localVal)} onCancel={onCancel} />
 </div>
 )
 }

 // Array
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
 {arr.length === 0 ? (
 <span className="text-xs text-gray-400 dark:text-slate-500 italic">empty — add items below</span>
 ) : (
 arr.map((it, i) => (
 <span
 key={i}
 className="flex items-center gap-1 px-2 py-0.5 bg-gray-100 dark:bg-slate-700 text-xs text-gray-800 dark:text-slate-200"
 >
 {String(it)}
 <button
 type="button"
 onClick={() => setLocalVal(arr.filter((_, j) => j !== i))}
 className="text-gray-400 dark:text-slate-400 hover:text-red-500 dark:hover:text-red-400 transition-colors leading-none ml-0.5"
 >
 ×
 </button>
 </span>
 ))
 )}
 </div>
 <div className="flex gap-1.5">
 <input
 value={arrayInput}
 onChange={(e) => setArrayInput(e.target.value)}
 onKeyDown={(e) => {
 if (e.key === 'Enter') { e.preventDefault(); addItem() }
 }}
 placeholder="Type item and press Enter"
 className="flex-1 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 px-2 py-1 text-xs text-gray-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
 />
 <button
 type="button"
 onClick={addItem}
 className="px-2 py-1 text-xs bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 text-gray-700 dark:text-slate-300 transition-colors"
 >
 Add
 </button>
 </div>
 <EditorActions onCommit={() => onCommit(localVal)} onCancel={onCancel} />
 </div>
 )
 }

 // String / default
 return (
 <div>
 <input
 autoFocus
 type="text"
 value={localVal ?? ''}
 onChange={(e) => setLocalVal(e.target.value)}
 className="mt-1 w-full bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 px-2 py-1.5 text-sm text-gray-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
 />
 <EditorActions onCommit={() => onCommit(localVal)} onCancel={onCancel} />
 </div>
 )
}

const PencilIcon = () => (
 <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
 <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
 </svg>
)

const RevertIcon = () => (
 <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
 <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6M3 10l6-6" />
 </svg>
)

const ADD_FIELD_TYPES = [
 { key: 'string', label: 'String' },
 { key: 'number', label: 'Number' },
 { key: 'boolean', label: 'Boolean' },
 { key: 'array', label: 'Array' },
 { key: 'object', label: 'Object' },
 { key: 'null', label: 'Null' },
]

function AddFieldRow({ onAdd }) {
 const [open, setOpen] = useState(false)
 const [fieldName, setFieldName] = useState('')
 const [fieldType, setFieldType] = useState('string')
 const [stringVal, setStringVal] = useState('')
 const [numberVal, setNumberVal] = useState('')
 const [boolVal, setBoolVal] = useState(true)
 const [arrayItems, setArrayItems] = useState([])
 const [arrayInput, setArrayInput] = useState('')
 const [objectVal, setObjectVal] = useState('{}')

 function reset() {
 setFieldName('')
 setFieldType('string')
 setStringVal('')
 setNumberVal('')
 setBoolVal(true)
 setArrayItems([])
 setArrayInput('')
 setObjectVal('{}')
 }

 function getValue() {
 switch (fieldType) {
 case 'number': return numberVal === '' ? 0 : Number(numberVal)
 case 'boolean': return boolVal
 case 'array': return arrayItems
 case 'object': try { return JSON.parse(objectVal) } catch { return objectVal }
 case 'null': return null
 default: return stringVal
 }
 }

 function handleConfirm() {
 const name = fieldName.trim()
 if (!name) return
 onAdd(name, getValue())
 reset()
 }

 const addArrayItem = () => {
 const trimmed = arrayInput.trim()
 if (!trimmed) return
 setArrayItems((prev) => [...prev, trimmed])
 setArrayInput('')
 }

 if (!open) {
 return (
 <button
 type="button"
 onClick={() => setOpen(true)}
 className="flex items-center gap-1 mt-1 text-xs text-gray-400 dark:text-slate-500 hover:text-gray-700 dark:hover:text-slate-300 transition-colors"
 >
 <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
 <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
 </svg>
 Add field
 </button>
 )
 }

 return (
 <div className="bg-gray-50 dark:bg-slate-800/40 border border-dashed border-gray-200 dark:border-slate-600 p-3 space-y-2.5">
 <div>
 <p className="text-[10px] text-gray-400 dark:text-slate-500 uppercase tracking-wide mb-1">Field name</p>
 <input
 autoFocus
 type="text"
 value={fieldName}
 onChange={(e) => setFieldName(e.target.value)}
 onKeyDown={(e) => { if (e.key === 'Enter') handleConfirm() }}
 placeholder="e.g. rating"
 className="w-full bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 px-2 py-1.5 text-sm text-gray-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
 />
 </div>

 <div>
 <p className="text-[10px] text-gray-400 dark:text-slate-500 uppercase tracking-wide mb-1">Type</p>
 <div className="inline-flex border border-gray-200 dark:border-slate-700 overflow-hidden">
 {ADD_FIELD_TYPES.map(({ key, label }) => (
 <button
 key={key}
 type="button"
 onClick={() => setFieldType(key)}
 className={`px-2.5 py-1 text-xs border-r border-gray-200 dark:border-slate-700 last:border-r-0 transition-colors ${
 fieldType === key
 ? 'bg-blue-600 text-white'
 : 'bg-gray-50 dark:bg-slate-800 text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-slate-700'
 }`}
 >
 {label}
 </button>
 ))}
 </div>
 </div>

 {fieldType === 'string' && (
 <div>
 <p className="text-[10px] text-gray-400 dark:text-slate-500 uppercase tracking-wide mb-1">Value</p>
 <input
 type="text"
 value={stringVal}
 onChange={(e) => setStringVal(e.target.value)}
 className="w-full bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 px-2 py-1.5 text-sm text-gray-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
 />
 </div>
 )}
 {fieldType === 'number' && (
 <div>
 <p className="text-[10px] text-gray-400 dark:text-slate-500 uppercase tracking-wide mb-1">Value</p>
 <input
 type="number"
 step="any"
 value={numberVal}
 onChange={(e) => setNumberVal(e.target.value)}
 className="w-full bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 px-2 py-1.5 text-sm text-gray-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
 />
 </div>
 )}
 {fieldType === 'boolean' && (
 <div>
 <p className="text-[10px] text-gray-400 dark:text-slate-500 uppercase tracking-wide mb-1">Value</p>
 <div className="flex gap-1.5">
 {[true, false].map((v) => (
 <button
 key={String(v)}
 type="button"
 onClick={() => setBoolVal(v)}
 className={`px-2.5 py-1 text-xs border transition-colors ${
 boolVal === v
 ? 'bg-blue-600 border-blue-500 text-white'
 : 'border-gray-200 dark:border-slate-600 text-gray-500 dark:text-slate-400 hover:border-gray-400 dark:hover:border-slate-500 hover:text-gray-700 dark:hover:text-slate-300'
 }`}
 >
 {String(v)}
 </button>
 ))}
 </div>
 </div>
 )}
 {fieldType === 'array' && (
 <div>
 <p className="text-[10px] text-gray-400 dark:text-slate-500 uppercase tracking-wide mb-1">Items</p>
 <div className="flex flex-wrap gap-1.5 mb-2 min-h-[24px]">
 {arrayItems.length === 0 ? (
 <span className="text-xs text-gray-400 dark:text-slate-500 italic">No items yet</span>
 ) : (
 arrayItems.map((it, i) => (
 <span key={i} className="flex items-center gap-1 px-2 py-0.5 bg-gray-100 dark:bg-slate-700 text-xs text-gray-800 dark:text-slate-200">
 {String(it)}
 <button
 type="button"
 onClick={() => setArrayItems((prev) => prev.filter((_, j) => j !== i))}
 className="text-gray-400 dark:text-slate-400 hover:text-red-500 dark:hover:text-red-400 transition-colors leading-none"
 >
 &times;
 </button>
 </span>
 ))
 )}
 </div>
 <div className="flex gap-1.5">
 <input
 value={arrayInput}
 onChange={(e) => setArrayInput(e.target.value)}
 onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addArrayItem() } }}
 placeholder="Type item and press Enter"
 className="flex-1 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 px-2 py-1 text-xs text-gray-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
 />
 <button type="button" onClick={addArrayItem} className="px-2 py-1 text-xs bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 text-gray-700 dark:text-slate-300 transition-colors">Add</button>
 </div>
 </div>
 )}
 {fieldType === 'object' && (
 <div>
 <p className="text-[10px] text-gray-400 dark:text-slate-500 uppercase tracking-wide mb-1">Value (JSON)</p>
 <textarea
 value={objectVal}
 onChange={(e) => setObjectVal(e.target.value)}
 rows={3}
 className="w-full bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 px-2 py-1.5 text-xs font-mono text-gray-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
 />
 </div>
 )}
 {fieldType === 'null' && (
 <p className="text-xs text-gray-400 dark:text-slate-500 italic">Value will be set to null</p>
 )}

 <div className="flex gap-2">
 <button
 type="button"
 onClick={handleConfirm}
 disabled={!fieldName.trim()}
 className="px-2.5 py-1 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white transition-colors"
 >
 Add
 </button>
 <button
 type="button"
 onClick={() => { reset(); setOpen(false) }}
 className="px-2.5 py-1 text-xs border border-gray-200 dark:border-slate-600 text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300 hover:border-gray-400 dark:hover:border-slate-500 transition-colors"
 >
 Cancel
 </button>
 </div>
 </div>
 )
}

function EditableFieldRow({ label, displayValue, schema, isEditing, isPending, canEdit, onEdit, onCommit, onCancel, onRevert }) {
 if (isEditing) {
 return (
 <div className="bg-gray-50 dark:bg-slate-800/40 border border-gray-200 dark:border-slate-700/60 p-2.5">
 <p className="text-[10px] text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-0.5">{label}</p>
 <FieldEditor
 currentValue={displayValue}
 schema={schema}
 onCommit={onCommit}
 onCancel={onCancel}
 />
 </div>
 )
 }

 return (
 <div className="group">
 <div className="flex items-center justify-between mb-0.5">
 <p className="text-[10px] text-gray-400 dark:text-slate-500 uppercase tracking-wide">{label}</p>
 <div className="flex items-center gap-0.5">
 {isPending && onRevert && (
 <button
 type="button"
 onClick={onRevert}
 className="opacity-0 group-hover:opacity-100 flex items-center justify-center w-5 h-5 text-amber-500 hover:text-amber-300 hover:bg-gray-100 dark:hover:bg-slate-700 transition-all"
 aria-label={`Revert ${label}`}
 title="Revert to original"
 >
 <RevertIcon />
 </button>
 )}
 {canEdit && (
 <button
 type="button"
 onClick={onEdit}
 className="opacity-0 group-hover:opacity-100 flex items-center justify-center w-5 h-5 text-gray-400 dark:text-slate-500 hover:text-gray-700 dark:hover:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700 transition-all"
 aria-label={`Edit ${label}`}
 >
 <PencilIcon />
 </button>
 )}
 </div>
 </div>
 <div className="flex items-center gap-1.5">
 {isPending && (
 <span className="w-1.5 h-1.5 bg-amber-400 shrink-0 mt-0.5" title="Unsaved change" />
 )}
 <p className={`text-sm break-all ${
 isPending ? 'text-amber-700 dark:text-amber-200' :
 (displayValue === null || displayValue === undefined) ? 'text-gray-400 dark:text-slate-500 italic' :
 'text-gray-800 dark:text-slate-200'
 }`}>
 {formatValue(displayValue)}
 </p>
 </div>
 </div>
 )
}

export default function ItemPage() {
 const { tagSlug, itemId } = useParams()
 const navigate = useNavigate()
 const { oasSpec } = useApp()
 const api = useApiClient()
 const { navItems } = parseOasSpec(oasSpec)
 const navItem = navItems.find((n) => n.id === tagSlug)

 const itemPath = useMemo(() => {
 if (!navItem?.itemPathTemplate || !itemId) return null
 return buildItemPath(navItem.itemPathTemplate, itemId)
 }, [navItem?.itemPathTemplate, itemId])

 const fetcher = useCallback(() => {
 if (!itemPath) return Promise.resolve([])
 return api.get(itemPath).then((obj) => [obj])
 }, [api, itemPath])

 const { data, loading, error, refresh } = useResourceList(fetcher)
 const item = data[0] ?? {}

 const [tab, setTab] = useState('fields')
 const [managedFieldsOpen, setManagedFieldsOpen] = useState(false)
 const [bodyText, setBodyText] = useState('{}')
 const [actionError, setActionError] = useState(null)
 const [actionSuccess, setActionSuccess] = useState(null)
 const [acting, setActing] = useState(false)
 const [confirmDelete, setConfirmDelete] = useState(false)
 const [toastError, setToastError] = useState(null)

 // Inline edit state
 const [editingField, setEditingField] = useState(null)
 const [pendingEdits, setPendingEdits] = useState({})
 const [patchSaving, setPatchSaving] = useState(false)
 const [patchError, setPatchError] = useState(null)
 const [toastSuccess, setToastSuccess] = useState(null)
 const [activating, setActivating] = useState(false)
 const [deactivating, setDeactivating] = useState(false)
 const [pendingActivate, setPendingActivate] = useState(false)
 const [pendingDeactivate, setPendingDeactivate] = useState(false)

 useEffect(() => {
 if (data[0]) {
 setBodyText(JSON.stringify(data[0], null, 2))
 setPendingEdits({})
 setEditingField(null)
 }
 }, [data])

 useEffect(() => {
 if (!toastError) return undefined
 const timeoutId = window.setTimeout(() => setToastError(null), 3500)
 return () => window.clearTimeout(timeoutId)
 }, [toastError])

 useEffect(() => {
 if (!toastSuccess) return undefined
 const timeoutId = window.setTimeout(() => setToastSuccess(null), 3500)
 return () => window.clearTimeout(timeoutId)
 }, [toastSuccess])

 function close() {
 navigate(`/r/${tagSlug}`)
 }

 async function runAction(type) {
 setActionError(null)
 setActionSuccess(null)
 setActing(true)
 try {
 if (type === 'delete') {
 await api.del(itemPath)
 close()
 return
 }
 const payload = JSON.parse(bodyText || '{}')
 if (type === 'patch') {
 await api.patch(itemPath, payload)
 setActionSuccess('PATCH successful')
 } else if (type === 'put') {
 await api.put(itemPath, payload)
 setActionSuccess('PUT successful')
 }
 await refresh()
 } catch (err) {
 const message = err?.message ?? 'Operation failed'
 setActionError(message)
 setToastError(message)
 } finally {
 setActing(false)
 }
 }

 async function handleInlinePatch() {
 setPatchSaving(true)
 setPatchError(null)
 try {
 await api.patch(itemPath, pendingEdits)
 await refresh()
 setPendingEdits({})
 setEditingField(null)
 setToastSuccess('Changes saved successfully')
 } catch (err) {
 const message = err?.message ?? 'Save failed'
 setPatchError({
 message,
 details: err?.body?.error?.details ?? [],
 })
 setToastError(message)
 } finally {
 setPatchSaving(false)
 }
 }

 async function handleActivate() {
 setActivating(true)
 try {
 const bothEmpty = !item._validFromDateTime && !item._validUntilDateTime
 const payload = bothEmpty
 ? { _validFromDateTime: new Date().toISOString() }
 : { _validUntilDateTime: null }
 await api.patch(itemPath, payload)
 await refresh()
 setToastSuccess(bothEmpty ? 'Activated successfully' : 'Reactivated successfully')
 } catch (err) {
 setToastError(err?.message ?? 'Activate failed')
 } finally {
 setActivating(false)
 }
 }

 async function handleDeactivate() {
 setDeactivating(true)
 try {
 await api.patch(itemPath, { _validUntilDateTime: new Date().toISOString() })
 await refresh()
 setToastSuccess('Deactivated successfully')
 } catch (err) {
 setToastError(err?.message ?? 'Deactivate failed')
 } finally {
 setDeactivating(false)
 }
 }

 function commitEdit(key, value) {
 setPendingEdits((prev) => ({ ...prev, [key]: value }))
 setEditingField(null)
 }

 function revertEdit(key) {
 setPendingEdits((prev) => {
 const next = { ...prev }
 delete next[key]
 return next
 })
 }

 if (!navItem || !itemPath) return null

 const schemaProps = navItem.itemSchemaProps ?? {}
 const hasEdit = navItem.itemMethods?.some((m) => ['patch', 'put', 'delete'].includes(m))
 const hasPatch = navItem.itemMethods?.includes('patch')
 const bothEmpty = !item._validFromDateTime && !item._validUntilDateTime
 const bothPopulated = !!item._validFromDateTime && !!item._validUntilDateTime
 const isReactivate = bothPopulated
 const canActivate = hasPatch && '_validFromDateTime' in schemaProps && (bothEmpty || bothPopulated)
 const canDeactivate = hasPatch && '_validUntilDateTime' in schemaProps && !!item._validFromDateTime && new Date(item._validFromDateTime) <= new Date()
 const decodedId = decodeURIComponent(itemId ?? '')
 const hasPendingEdits = Object.keys(pendingEdits).length > 0

 return (
 <>
 {/* Backdrop */}
 <div
 className="fixed inset-0 z-40 bg-black/40 dark:bg-slate-950/70 backdrop-blur-sm"
 onClick={close}
 aria-hidden="true"
 />

 {/* Modal panel */}
 <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
 <div className="pointer-events-auto w-full max-w-2xl max-h-[90vh] flex flex-col bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 shadow-2xl">

 {/* Header */}
 <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200 dark:border-slate-700 flex-shrink-0">
 <div>
 <h2 className="text-sm font-semibold text-gray-800 dark:text-slate-100">{navItem.label}</h2>
 <p className="text-[11px] text-gray-400 dark:text-slate-500 font-mono mt-0.5 truncate max-w-[380px]">{decodedId}</p>
 </div>
 <button
 onClick={close}
 className="flex items-center justify-center w-7 h-7 text-gray-400 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-100 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
 aria-label="Close"
 >
 <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
 <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
 </svg>
 </button>
 </div>

 {/* Tab bar */}
 <div className="flex border-b border-gray-200 dark:border-slate-700 flex-shrink-0 px-5">
 {['fields', ...(hasEdit ? ['edit'] : [])].map((t) => (
 <button
 key={t}
 onClick={() => setTab(t)}
 className={`py-2.5 px-1 mr-5 text-xs font-medium border-b-2 transition-colors ${
 tab === t
 ? 'border-blue-500 text-blue-500 dark:text-blue-400'
 : 'border-transparent text-gray-400 dark:text-slate-500 hover:text-gray-700 dark:hover:text-slate-300'
 }`}
 >
 {t === 'fields' ? (
 <span className="flex items-center gap-1.5">
 Fields
 {hasPendingEdits && (
 <span className="w-1.5 h-1.5 bg-amber-400" title="Unsaved changes" />
 )}
 </span>
 ) : 'JSON'}
 </button>
 ))}
 </div>

 {/* Content */}
 <div className="flex-1 overflow-y-auto p-5 space-y-4">
 {tab === 'fields' && (
 <>
 <div className="flex items-center justify-between">
 <span className="text-[10px] text-gray-400 dark:text-slate-500 uppercase tracking-wide">Fields</span>
 <div className="flex items-center gap-1">
 {(canActivate || canDeactivate) && (
 <div className="inline-flex border border-gray-200 dark:border-slate-700 overflow-hidden">
 {canActivate && (
 <button
 onClick={() => setPendingActivate(true)}
 disabled={activating}
 className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-800/40 dark:hover:bg-emerald-700/50 text-emerald-700 hover:text-emerald-900 dark:text-emerald-300 dark:hover:text-emerald-100 disabled:opacity-50 transition-colors"
 title={isReactivate ? 'Clear valid-until date' : 'Set valid from now'}
 >
 <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
 <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
 </svg>
 {activating ? (isReactivate ? 'Reactivating…' : 'Activating…') : (isReactivate ? 'Reactivate' : 'Activate')}
 </button>
 )}
 {canActivate && canDeactivate && <span className="w-px bg-gray-200 dark:bg-slate-700" />}
 {canDeactivate && (
 <button
 onClick={() => setPendingDeactivate(true)}
 disabled={deactivating}
 className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-amber-100 hover:bg-amber-200 dark:bg-amber-900/30 dark:hover:bg-amber-800/50 text-amber-700 hover:text-amber-900 dark:text-amber-400 dark:hover:text-amber-200 disabled:opacity-50 transition-colors"
 title="Set valid until now"
 >
 <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
 <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
 </svg>
 {deactivating ? 'Deactivating…' : 'Deactivate'}
 </button>
 )}
 </div>
 )}
 <button
 onClick={refresh}
 className="flex items-center justify-center w-7 h-7 text-gray-400 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
 title="Refresh"
 aria-label="Refresh"
 >
 <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
 <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
 </svg>
 </button>
 </div>
 </div>

 {loading ? (
 <p className="text-gray-500 dark:text-slate-400 text-sm">Loading…</p>
 ) : error ? (
 <p className="text-red-400 text-sm">{error}</p>
 ) : (
 <>
 {/* Business fields */}
 <div className="space-y-3">
 {('_name' in item || '_name' in schemaProps) && (
 <EditableFieldRow
 label="Name"
 displayValue={pendingEdits._name !== undefined ? pendingEdits._name : (item._name ?? null)}
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
 {[
 ...new Set([
 ...Object.keys(item).filter((k) => !k.startsWith('_')),
 ...Object.keys(schemaProps).filter((k) => !k.startsWith('_')),
 ...Object.keys(pendingEdits).filter((k) => !k.startsWith('_')),
 ]),
 ].map((key) => (
 <EditableFieldRow
 key={key}
 label={key}
 displayValue={pendingEdits[key] !== undefined ? pendingEdits[key] : (key in item ? item[key] : null)}
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
 {hasPatch && navItem.itemAllowsAdditionalProps && (
 <AddFieldRow onAdd={(name, val) => commitEdit(name, val)} />
 )}
 {/* Managed fields */}
 <div className="border-t border-gray-200 dark:border-slate-700 pt-3">
 <button
 onClick={() => setManagedFieldsOpen((o) => !o)}
 className="flex items-center gap-1.5 mb-2 group cursor-pointer"
 aria-label={managedFieldsOpen ? 'Collapse managed fields' : 'Expand managed fields'}
 >
 <p className="text-[10px] text-gray-400 dark:text-slate-500 uppercase tracking-wide group-hover:text-gray-600 dark:group-hover:text-slate-400 transition-colors">Managed fields</p>
 <svg
 className={`w-3 h-3 text-gray-300 dark:text-slate-600 group-hover:text-gray-500 dark:group-hover:text-slate-400 transition-colors transition-transform ${managedFieldsOpen ? 'rotate-180' : ''}`}
 fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"
 >
 <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
 </svg>
 </button>
 {managedFieldsOpen && (
 <div className="space-y-2">
 {Object.entries(item)
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

 {/* Inline PATCH save bar */}
 {hasPendingEdits && (
 <div className="border-t border-gray-200 dark:border-slate-700 pt-4 space-y-3">
 <div className="flex items-center gap-2">
 <button
 type="button"
 onClick={handleInlinePatch}
 disabled={patchSaving}
 className="px-3 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white transition-colors"
 >
 {patchSaving
 ? 'Saving\u2026'
 : `Save ${Object.keys(pendingEdits).length} change${Object.keys(pendingEdits).length > 1 ? 's' : ''}`}
 </button>
 <button
 type="button"
 onClick={() => { setPendingEdits({}); setEditingField(null); setPatchError(null) }}
 disabled={patchSaving}
 className="px-3 py-1.5 text-xs border border-gray-200 dark:border-slate-600 text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300 hover:border-gray-400 dark:hover:border-slate-500 disabled:opacity-50 transition-colors"
 >
 Discard
 </button>
 </div>
 {patchError && (
 <div className="text-red-400 text-sm space-y-1">
 <p>{patchError.message}</p>
 {patchError.details?.length > 0 && (
 <ul className="list-disc list-inside space-y-0.5 text-red-300 text-xs">
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
 </>
 )}

 {tab === 'edit' && (
 <>
 <p className="text-xs text-gray-400 dark:text-slate-500">Request body (JSON)</p>
 <textarea
 value={bodyText}
 onChange={(e) => setBodyText(e.target.value)}
 rows={10}
 className="w-full bg-gray-50 dark:bg-slate-950 border border-gray-200 dark:border-slate-800 p-3 text-xs font-mono text-gray-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
 placeholder={'{\n"_name":"Updated name"\n}'}
 />
 {actionError && <p className="text-red-400 text-xs">{actionError}</p>}
 {actionSuccess && <p className="text-emerald-400 text-xs">{actionSuccess}</p>}
 </>
 )}
 </div>

 {/* Footer */}
 {tab === 'edit' && (
 <div className="flex items-center gap-2 px-5 py-3.5 border-t border-gray-200 dark:border-slate-700 flex-shrink-0">
 {navItem.itemMethods.includes('put') && (
 <button
 onClick={() => runAction('put')}
 disabled={acting}
 className="px-3 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white"
 >
 Replace
 </button>
 )}
 {navItem.itemMethods.includes('delete') && (
 <button
 onClick={() => setConfirmDelete(true)}
 disabled={acting}
 className="ml-auto px-3 py-1.5 text-xs bg-rose-700 hover:bg-rose-600 disabled:opacity-50 text-white"
 >
 DELETE
 </button>
 )}
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
 onConfirm={() => { setConfirmDelete(false); runAction('delete') }}
 onCancel={() => setConfirmDelete(false)}
 />
 <ConfirmDialog
 open={pendingActivate}
 title={isReactivate ? 'Reactivate this record?' : 'Activate this record?'}
 message={
 isReactivate
 ? 'This will clear the valid-until date, making the record active again. You can undo this later by editing the field.'
 : 'This will set the valid-from date to now. You can undo this later by editing the field.'
 }
 confirmLabel={isReactivate ? 'Yes, reactivate' : 'Yes, activate'}
 confirmVariant="success"
 onConfirm={() => { setPendingActivate(false); handleActivate() }}
 onCancel={() => setPendingActivate(false)}
 />
 <ConfirmDialog
 open={pendingDeactivate}
 title="Deactivate this record?"
 message="This will set the valid-until date to now, making the record inactive. You can undo this later by editing the field."
 confirmLabel="Yes, deactivate"
 confirmVariant="warning"
 onConfirm={() => { setPendingDeactivate(false); handleDeactivate() }}
 onCancel={() => setPendingDeactivate(false)}
 />
 </>
 )
}
