/**
 * navConfig.tsx — USB Catering / Harvest Catering
 * ─────────────────────────────────────────────────────────────────────────────
 * Single source of truth for the sidebar navigation tree. Maps every catering
 * module and sub-feature to a route path under src/routes/*.
 *
 * Icons use lucide-react (matches the rest of the catering UI) rendered as
 * ReactElements so AppLayout's antd Menu can consume them.
 */

import type { ReactElement } from 'react';
import {
  LayoutDashboard,
  Upload,
  UtensilsCrossed,
  Factory,
  Layers,
  ClipboardCheck,
  BarChart3,
  Boxes,
  FileText,
  Send,
  ArrowLeftRight,
  MoveRight,
  Package,
  SlidersHorizontal,
  ShoppingCart,
  MailQuestion,
  ClipboardList,
  Scale,
  Truck,
  Undo2,
  UserCog,
  KeyRound,
  LockKeyhole,
  LineChart,
  Wallet,
  Receipt,
  BadgeCheck,
  PieChart,
  Landmark,
  ShieldCheck,
  ThermometerSun,
  PackageCheck,
  Coffee,
  Clock,
  Plane,
  PlaneTakeoff,
  LayoutGrid,
  ScanBarcode,
  Wrench,
  ShieldAlert,
  Users,
  ScrollText,
  Settings,
  Tag,
  Building2,
  Warehouse,
  BadgeDollarSign,
  GitBranch,
  Trash2,
  Replace,
  TrendingUp,
  Hourglass,
} from 'lucide-react';

export interface NavSubItem {
  /** Used as both the menu `key` and the navigation target path (leaf) or sub-menu identifier (parent). */
  key: string;
  label: string;
  icon?: ReactElement;
  /** If present, this item renders as a collapsible sub-menu rather than a leaf route. */
  children?: NavSubItem[];
}

export interface NavModule {
  key: string;
  label: string;
  icon: ReactElement;
  children: NavSubItem[];
}

// Lucide icons render at ~1em by default; pin a size that matches antd Menu's icon sizing (14px).
const I = (Icon: typeof LayoutDashboard) => <Icon size={14} strokeWidth={1.75} />;

export const NAV_MODULES: NavModule[] = [
  // ── 0. Dashboard ───────────────────────────────────────────────────────────
  {
    key: 'dashboard',
    label: 'Dashboard',
    icon: I(LayoutDashboard),
    children: [
      { key: '/', label: 'Overview', icon: I(LayoutDashboard) },
    ],
  },

  // ── 1. Operations ──────────────────────────────────────────────────────────
  {
    key: 'operations',
    label: 'Operations',
    icon: I(UtensilsCrossed),
    children: [
      { key: '/operations-overview', label: 'Operations Dashboard', icon: I(LayoutDashboard) },
      { key: '/order-management',    label: 'Order Management',     icon: I(Upload) },
      { key: '/meal-planning',       label: 'Menu Planning',    icon: I(UtensilsCrossed) },
      { key: '/delay-management',    label: 'Delay Management',     icon: I(Clock) },
      { key: '/lmc',                 label: 'Last Minute Change (LMC)', icon: I(Replace) },
    ],
  },

  // ── 2. Production Management ───────────────────────────────────────────────
  {
    key: 'production',
    label: 'Production',
    icon: I(Factory),
    children: [
      { key: '/production-overview',   label: 'Production Dashboard',        icon: I(LayoutDashboard) },
      { key: '/bom',                   label: 'Bill of Materials',           icon: I(Layers) },
      { key: '/production-entry',      label: 'Production Order',            icon: I(ClipboardCheck) },
      { key: '/production-entry-new',  label: 'Production Entry',            icon: I(ClipboardCheck) },
      { key: '/production-reports',    label: 'Production Reports',          icon: I(BarChart3) },
    ],
  },

  // ── Procurement (top-level, directly below Production) ──────────────────────
  {
    key: 'supply',
    label: 'Local Purchase',
    icon: I(ShoppingCart),
    children: [
      { key: '/supply-chain-overview',  label: 'Purchase Dashboard',     icon: I(LayoutDashboard) },
      { key: '/purchase-requisition',   label: 'Purchase Requisition',   icon: I(FileText) },
      { key: '/request-for-quotation',  label: 'Request for Quotation',  icon: I(MailQuestion) },
      { key: '/quotation-entry',        label: 'Quotation Entry',        icon: I(ClipboardList) },
      { key: '/comparative-statement',  label: 'Comparative Statement',  icon: I(Scale) },
      { key: '/procurement',            label: 'Purchase Orders',        icon: I(ShoppingCart) },
      { key: '/receive-item',           label: 'Receive Items',          icon: I(Truck) },
      { key: '/quality-control',        label: 'Quality Control',        icon: I(ShieldCheck) },
      { key: '/purchase-return',        label: 'Purchase Return',        icon: I(Undo2) },
      { key: '/purchase-payment',       label: 'Purchase Payment',       icon: I(Wallet) },
      { key: '/purchase-reports',       label: 'Purchase Reports',       icon: I(LineChart) },
    ],
  },

  // ── 3. Inventory & Store ───────────────────────────────────────────────────
  {
    key: 'inventory',
    label: 'Inventory & Store',
    icon: I(Boxes),
    children: [
      { key: '/inventory-overview', label: 'Inventory Dashboard', icon: I(LayoutDashboard) },
      { key: '/demand-orders',     label: 'Demand Requests',  icon: I(FileText) },
      { key: '/item-issue',        label: 'Item Issue',       icon: I(Send) },
      { key: '/transfer-request',  label: 'Transfer Request', icon: I(ArrowLeftRight) },
      { key: '/transfer',          label: 'Transfer',         icon: I(MoveRight) },
      { key: '/inventory',         label: 'Stock Overview',   icon: I(Package) },
      { key: '/stock-adjustment',  label: 'Stock Adjustment', icon: I(SlidersHorizontal) },
      { key: '/stock-ageing',      label: 'Stock Ageing and Alerts', icon: I(Hourglass) },
    ],
  },

  // ── Accounts (under Inventory & Store) ──────────────────────────────────────
  {
    key: 'accounts',
    label: 'Accounts',
    icon: I(Wallet),
    children: [
      { key: '/accounts-overview',  label: 'Accounts Dashboard',    icon: I(LayoutDashboard) },
      { key: '/accounts-invoices',  label: 'Invoices & Payments',   icon: I(Receipt) },
      { key: '/accounts-income',    label: 'Income & Receipts',     icon: I(TrendingUp) },
      { key: '/accounts-cash-bank', label: 'Finance & Banking',      icon: I(Landmark) },
      { key: '/accounts-expenses',  label: 'Expense Overview',      icon: I(PieChart) },
      { key: '/accounts',           label: 'Accounts Summary',      icon: I(Wallet) },
    ],
  },

  // ── 6. Food Safety & QC ────────────────────────────────────────────────────
  {
    key: 'qc',
    label: 'Food Safety & QC',
    icon: I(ShieldCheck),
    children: [
      { key: '/food-safety-overview',           label: 'Food Safety Dashboard',               icon: I(LayoutDashboard) },
      { key: '/hygiene-monitoring',            label: 'Daily Hygiene Monitoring',            icon: I(ClipboardCheck) },
      { key: '/personal-hygiene-monitoring',   label: 'Health & Personal Hygiene Monitoring', icon: I(Users) },
      { key: '/cooking-temp',                  label: 'Cooking Temp & Sensory',              icon: I(ThermometerSun) },
    ],
  },

  // ── 7. Dispatch ────────────────────────────────────────────────────────────
  {
    key: 'dispatch',
    label: 'Packaging & Dispatch',
    icon: I(PackageCheck),
    children: [
      { key: '/packaging-dispatch-overview', label: 'Dispatch Dashboard', icon: I(LayoutDashboard) },
      { key: '/packaging',                   label: 'Packaging', icon: I(Package) },
      { key: '/dispatch',                    label: 'Dispatch', icon: I(PackageCheck) },
      { key: '/dispatch-monitoring',         label: 'Dispatch Monitoring', icon: I(Truck) },
    ],
  },

  // ── 8. Galley Planning (galley plan + airline consumables) ─────────────────
  {
    key: 'airline-consumables',
    label: 'Galley Planning',
    icon: I(Coffee),
    children: [
      { key: '/airline-consumables-overview', label: 'Galley Dashboard',  icon: I(LayoutDashboard) },
      { key: '/galley-planning',              label: 'Galley Plan',       icon: I(LayoutGrid) },
      { key: '/galley-qc',                    label: 'Loading QC & Sign-Off', icon: I(ClipboardCheck) },
      { key: '/consumable-allocation', label: 'Flight Allocation', icon: I(Plane) },
      { key: '/consumable-returns',    label: 'Returns',           icon: I(Undo2) },
      { key: '/galley-loading-standards', label: 'Loading Standards', icon: I(Scale) },
    ],
  },

  // ── 9. Asset Management (Airline Equipments + Maintenance & Assets) ──────────
  {
    key: 'fleet-operations',
    label: 'Asset Management',
    icon: I(Package),
    children: [
      { key: '/fleet-overview',        label: 'Asset Overview',     icon: I(LayoutDashboard) },
      { key: '/airline-equipments',    label: 'Asset Registration', icon: I(Boxes) },
      { key: '/asset-assignment',      label: 'Asset Assign',       icon: I(Send) },
      { key: '/asset-disposal',        label: 'Asset Disposal',     icon: I(Trash2) },
      { key: '/equipment-maintenance', label: 'Maintenance',        icon: I(Wrench) },
      { key: '/equipment-damage',      label: 'Damage Reports',     icon: I(ShieldAlert) },
    ],
  },

  // ── 10. Wastage Management ─────────────────────────────────────────────────
  {
    key: 'wastage-management',
    label: 'Wastage Management',
    icon: I(Trash2),
    children: [
      { key: '/wastage-analytics',  label: 'Wastage Analytics',         icon: I(BarChart3) },
      { key: '/wastage-management', label: 'Damaged Product Disposal',  icon: I(ClipboardCheck) },
      { key: '/damaged-product-sales', label: 'Damaged Product Sales', icon: I(ShoppingCart) },
    ],
  },

  // ── 11. Reports ────────────────────────────────────────────────────────────
  {
    key: 'reports',
    label: 'Reports',
    icon: I(BarChart3),
    children: [
      { key: '/reports', label: 'Reports', icon: I(BarChart3) },
      { key: '/report-builder', label: 'Report Builder', icon: I(FileText) },
    ],
  },

  // ── 12. Admin ──────────────────────────────────────────────────────────────
  {
    key: 'admin',
    label: 'Administration',
    icon: I(Settings),
    children: [
      { key: '/users',               label: 'User Management',     icon: I(Users) },
      { key: '/audit',               label: 'Audit Logs',          icon: I(ScrollText) },
      { key: '/approval-management', label: 'Approval Management', icon: I(BadgeCheck) },
    ],
  },

  // ── 13. Configuration ──────────────────────────────────────────────────────
  {
    key: 'config',
    label: 'Configuration',
    icon: I(Settings),
    children: [
      { key: '/config-item',       label: 'Item Profile',     icon: I(Tag) },
      { key: '/config-supplier',   label: 'Supplier Profile', icon: I(Truck) },
      { key: '/config-customer',   label: 'Customer Profile', icon: I(Users) },
      { key: '/config-company',    label: 'Company Profile',  icon: I(Building2) },
      { key: '/config-airline',    label: 'Airline',          icon: I(Plane) },
      { key: '/config-aircraft',   label: 'Aircraft',         icon: I(PlaneTakeoff) },
      { key: '/config-office',     label: 'Office',           icon: I(Building2) },
      { key: '/config-warehouse',  label: 'Warehouse',        icon: I(Warehouse) },
      { key: '/config-price',      label: 'Price Setup',      icon: I(BadgeDollarSign) },
      { key: '/config-approval',   label: 'Approval Setup',   icon: I(GitBranch) },
      { key: '/config-meal-slots', label: 'Meal Config',       icon: I(Clock) },
      { key: '/config-production-basis', label: 'Production Basis', icon: I(Scale) },
      { key: '/config-role-setup', label: 'Role Setup', icon: I(UserCog) },
      { key: '/config-role-permission-editor', label: 'Role Permission Editor', icon: I(KeyRound) },
      { key: '/config-form-access-control', label: 'Form Access Control', icon: I(LockKeyhole) },
    ],
  },
];
