import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AppProvider, useApp } from './context/AppContext'
import { ThemeProvider } from './context/ThemeContext'
import AppLayout from './components/layout/AppLayout'
import SetupScreen from './components/setup/SetupScreen'
import DashboardPage from './pages/DashboardPage'
import ResourcePage from './components/dynamic/ResourcePage'
import TraversalPage from './components/dynamic/TraversalPage'
import ItemPage from './components/dynamic/ItemPage'

function AppShell() {
 const { isReady, oasStatus } = useApp()

 // Show setup / loading / error screen until spec is successfully loaded
 if (!isReady) {
 return <SetupScreen />
 }

 return (
 <Routes>
 <Route element={<AppLayout />}>
 <Route index element={<DashboardPage />} />
 <Route path="/r/:tagSlug" element={<ResourcePage />}>
 <Route path="item/:itemId" element={<ItemPage />} />
 </Route>
 <Route path="/r/:tagSlug/:subResource" element={<TraversalPage />} />
 </Route>
 </Routes>
 )
}

export default function App() {
 return (
 <ThemeProvider>
 <AppProvider>
 <BrowserRouter>
 <AppShell />
 </BrowserRouter>
 </AppProvider>
 </ThemeProvider>
 )
}

