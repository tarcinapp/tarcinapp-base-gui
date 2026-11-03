import { createContext, useContext, useEffect, useState } from 'react'

const ThemeContext = createContext(null)

const STORAGE_KEY = 'tarcinapp_theme'

function getInitialTheme() {
 try {
 const stored = localStorage.getItem(STORAGE_KEY)
 if (stored === 'light' || stored === 'dark') return stored
 } catch {
 // ignore
 }
 // Default: dark (existing look)
 return 'dark'
}

export function ThemeProvider({ children }) {
 const [theme, setTheme] = useState(getInitialTheme)

 useEffect(() => {
 const root = document.documentElement
 if (theme === 'dark') {
 root.classList.add('dark')
 } else {
 root.classList.remove('dark')
 }
 try {
 localStorage.setItem(STORAGE_KEY, theme)
 } catch {
 // ignore
 }
 }, [theme])

 function toggleTheme() {
 setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
 }

 return (
 <ThemeContext.Provider value={{ theme, toggleTheme }}>
 {children}
 </ThemeContext.Provider>
 )
}

export function useTheme() {
 const ctx = useContext(ThemeContext)
 if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
 return ctx
}
