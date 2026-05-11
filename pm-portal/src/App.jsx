import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/layout/Layout'

// Pages - Dashboard
import Dashboard from './pages/Dashboard'

// Pages - 공통 업무
import Inbound from './pages/common/Inbound'
import Outbound from './pages/common/Outbound'
import Quote from './pages/common/Quote'
import Issues from './pages/common/Issues'
import Todo from './pages/common/Todo'

// Pages - 고객사
import PurchaseOrders from './pages/customer/PurchaseOrders'
import Shortage from './pages/customer/Shortage'
import BOM from './pages/customer/BOM'

// Pages - 기초자료
import Items from './pages/master/Items'
import Vendors from './pages/master/Vendors'
import PriceHistory from './pages/master/PriceHistory'

// Pages - ERP
import ERPExport from './pages/ERPExport'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        {/* 대시보드 */}
        <Route index element={<Dashboard />} />

        {/* 공통 업무 */}
        <Route path="inbound"  element={<Inbound />} />
        <Route path="outbound" element={<Outbound />} />
        <Route path="quote"    element={<Quote />} />
        <Route path="issues"   element={<Issues />} />
        <Route path="todo"     element={<Todo />} />

        {/* 고객사별 */}
        <Route path="customer/:customerId">
          <Route path="po"      element={<PurchaseOrders />} />
          <Route path="short"   element={<Shortage />} />
          <Route path="bom"     element={<BOM />} />
          <Route index          element={<Navigate to="po" replace />} />
        </Route>

        {/* 기초자료 */}
        <Route path="master">
          <Route path="items"   element={<Items />} />
          <Route path="vendors" element={<Vendors />} />
          <Route path="price"   element={<PriceHistory />} />
        </Route>

        {/* ERP 연동 */}
        <Route path="erp" element={<ERPExport />} />
      </Route>
    </Routes>
  )
}
