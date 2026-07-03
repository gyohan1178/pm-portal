import { useEffect, useState, lazy } from 'react'
import { Routes, Route, Navigate, useParams } from 'react-router-dom'
import { supabase } from './lib/supabase'
import { useProfile, hasRole } from './hooks/useProfile'
import Layout from './components/layout/Layout'
import Login from './pages/Login'
import PendingApproval from './pages/PendingApproval'

const ControlTower = lazy(() => import('./pages/control-tower/ControlTower'))
const WhatIfSim = lazy(() => import('./pages/control-tower/WhatIfSim'))
const Insights = lazy(() => import('./pages/control-tower/Insights'))
const Inbound = lazy(() => import('./pages/common/Inbound'))
const CommonSearch = lazy(() => import('./pages/common/CommonSearch'))
const ShortageForecast = lazy(() => import('./pages/common/ShortageForecast'))
const Outbound = lazy(() => import('./pages/common/Outbound'))
const Issue = lazy(() => import('./pages/common/Issue'))
const MissingParts = lazy(() => import('./pages/common/MissingParts'))
const Inventory = lazy(() => import('./pages/common/Inventory'))
const Quote = lazy(() => import('./pages/common/Quote'))
const CustomerPO = lazy(() => import('./pages/customer/CustomerPO'))
const PurchasePage = lazy(() => import('./pages/customer/PurchasePage'))
const Shortage = lazy(() => import('./pages/customer/Shortage'))
const BOM = lazy(() => import('./pages/customer/BOM'))
const ReqBOM = lazy(() => import('./pages/customer/ReqBOM'))
const Forecast = lazy(() => import('./pages/customer/Forecast'))
const Items = lazy(() => import('./pages/master/Items'))
const Vendors = lazy(() => import('./pages/master/Vendors'))
const PriceHistory = lazy(() => import('./pages/master/PriceHistory'))
const CostAnalysis = lazy(() => import('./pages/master/CostAnalysis'))
const ERPExport = lazy(() => import('./pages/ERPExport'))
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'))
const UserManagement = lazy(() => import('./pages/admin/UserManagement'))
const WeeklyReport = lazy(() => import('./pages/WeeklyReport'))
const WeeklyUpload = lazy(() => import('./pages/WeeklyUpload'))
const PurchaseDashboard = lazy(() => import('./pages/PurchaseDashboard'))
const SalesDashboard = lazy(() => import('./pages/SalesDashboard'))
const Help = lazy(() => import('./pages/Help'))
const ProductionDashboard = lazy(() => import('./pages/production/ProductionDashboard'))
const ProductionCustomer = lazy(() => import('./pages/production/ProductionCustomer'))
const ProductionBoard = lazy(() => import('./pages/production/ProductionBoard'))

function ControlTowerRoute() {
  const { scope } = useParams()
  return <ControlTower scope={scope || 'ax'} />
}

function ProtectedRoute({ session, children }) {
  if (!session) return <Navigate to="/login" replace />
  return children
}

function AdminRoute({ profile, children }) {
  if (!hasRole(profile, 'admin')) return <Navigate to="/" replace />
  return children
}

export default function App() {
  const [session, setSession] = useState(undefined) // undefined = 로딩중

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => subscription.unsubscribe()
  }, [])

  const { data: profile, isLoading: profileLoading } = useProfile(session)

  // 세션 확인 중
  if (session === undefined) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="text-slate-400 text-sm">로딩 중...</div>
    </div>
  )

  // 로그인했지만 프로필 로딩 중
  if (session && profileLoading) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="text-slate-400 text-sm">계정 확인 중...</div>
    </div>
  )

  // 로그인했지만 승인 안 됨 (pending/rejected) → 대기 화면
  if (session && profile && profile.status !== 'approved') {
    return <PendingApproval profile={profile} />
  }

  return (
    <Routes>
      <Route path="/login" element={session ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/board" element={<ProtectedRoute session={session}><ProductionBoard /></ProtectedRoute>} />
      <Route element={<ProtectedRoute session={session}><Layout profile={profile} /></ProtectedRoute>}>
        <Route index element={<ControlTower scope="all" />} />
        <Route path="search"    element={<CommonSearch />} />
        <Route path="forecast-shortage" element={<ShortageForecast />} />
        <Route path="inbound"   element={<Inbound />} />
        <Route path="outbound"  element={<Outbound />} />
        <Route path="issue"     element={<Issue />} />
        <Route path="missing"   element={<MissingParts />} />
        <Route path="inventory" element={<Inventory />} />
        <Route path="quote"     element={<Quote />} />
        <Route path="cost"      element={<CostAnalysis />} />
        <Route path="control-tower"        element={<ControlTower scope="all" />} />
        <Route path="control-tower/:scope" element={<ControlTowerRoute />} />
        <Route path="what-if"              element={<WhatIfSim />} />
        <Route path="what-if/:scope"       element={<WhatIfSim />} />
        <Route path="insights"             element={<Insights />} />
        <Route path="customer/:customerId">
          <Route path="cpo"      element={<CustomerPO />} />
          <Route path="purchase" element={<PurchasePage />} />
          <Route path="short"    element={<Shortage />} />
          <Route path="bom"      element={<BOM />} />
          <Route path="reqbom"   element={<ReqBOM />} />
          <Route path="forecast" element={<Forecast />} />
          <Route index           element={<Navigate to="cpo" replace />} />
        </Route>
        <Route path="master">
          <Route path="items"   element={<Items />} />
          <Route path="vendors" element={<Vendors />} />
          <Route path="price"   element={<PriceHistory />} />
        </Route>
        <Route path="erp" element={<ERPExport />} />
        <Route path="admin" element={<AdminRoute profile={profile}><AdminDashboard /></AdminRoute>} />
        <Route path="users" element={<AdminRoute profile={profile}><UserManagement /></AdminRoute>} />
        <Route path="weekly" element={<WeeklyReport />} />
        <Route path="weekly/upload" element={<WeeklyUpload />} />
        <Route path="purchase-dashboard" element={<PurchaseDashboard />} />
        <Route path="sales" element={<SalesDashboard />} />
        <Route path="help" element={<Help />} />
        <Route path="production" element={<ProductionDashboard />} />
        <Route path="production/:code" element={<ProductionCustomer />} />
      </Route>
    </Routes>
  )
}
