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
  LineChart,
  Wallet,
  Receipt,
  BadgeCheck,
  PieChart,
  ShieldCheck,
  ThermometerSun,
  PackageCheck,
  Coffee,
  Clock,
  Plane,
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
      { key: '/meal-planning',       label: 'Meal Planning',    icon: I(UtensilsCrossed) },
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
    ],
  },

  // ── 4. Supply Chain ────────────────────────────────────────────────────────
  {
    key: 'supply',
    label: 'Supply Chain',
    icon: I(ShoppingCart),
    children: [
      { key: '/supply-chain-overview',  label: 'Supply Chain Dashboard', icon: I(LayoutDashboard) },
      { key: '/purchase-requisition',   label: 'Purchase Requisition',   icon: I(FileText) },
      { key: '/request-for-quotation',  label: 'Request for Quotation',  icon: I(MailQuestion) },
      { key: '/quotation-entry',        label: 'Quotation Entry',        icon: I(ClipboardList) },
      { key: '/comparative-statement',  label: 'Comparative Statement',  icon: I(Scale) },
      { key: '/procurement',            label: 'Purchase Orders',        icon: I(ShoppingCart) },
      { key: '/receive-item',           label: 'Receive Items',          icon: I(Truck) },
      { key: '/purchase-return',        label: 'Purchase Return',        icon: I(Undo2) },
      { key: '/purchase-reports',       label: 'Purchase Reports',       icon: I(LineChart) },
    ],
  },

  // ── 5. Accounts ────────────────────────────────────────────────────────────
  {
    key: 'accounts',
    label: 'Accounts',
    icon: I(Wallet),
    children: [
      { key: '/accounts-overview',  label: 'Accounts Dashboard',    icon: I(LayoutDashboard) },
      { key: '/accounts-invoices',  label: 'Invoices & Payments',   icon: I(Receipt) },
      { key: '/accounts-approvals', label: 'Payment Approvals',     icon: I(BadgeCheck) },
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
      { key: '/food-safety-overview', label: 'Food Safety Dashboard',     icon: I(LayoutDashboard) },
      { key: '/hygiene-monitoring',   label: 'Daily Hygiene Monitoring',  icon: I(ClipboardCheck) },
      { key: '/cooking-temp',         label: 'Cooking Temp & Sensory',    icon: I(ThermometerSun) },
      { key: '/dispatch-monitoring',  label: 'Dispatch Monitoring',       icon: I(Truck) },
    ],
  },

  // ── 7. Dispatch ────────────────────────────────────────────────────────────
  {
    key: 'dispatch',
    label: 'Packaging & Dispatch',
    icon: I(PackageCheck),
    children: [
      { key: '/packaging-dispatch-overview', label: 'Dispatch Dashboard', icon: I(LayoutDashboard) },
      { key: '/dispatch',                    label: 'Dispatch', icon: I(PackageCheck) },
    ],
  },

  // ── 8. Airline Consumables ─────────────────────────────────────────────────
  {
    key: 'airline-consumables',
    label: 'Airline Consumables',
    icon: I(Coffee),
    children: [
      { key: '/airline-consumables-overview', label: 'Consumables Dashboard', icon: I(LayoutDashboard) },
      { key: '/airline-consumables',   label: 'Inventory',         icon: I(Boxes) },
      { key: '/consumable-usage',      label: 'Usage Tracking',    icon: I(Send) },
      { key: '/consumable-allocation', label: 'Flight Allocation', icon: I(Plane) },
    ],
  },

  // ── 9. Airline Equipments ──────────────────────────────────────────────────
  {
    key: 'airline-equipments',
    label: 'Airline Equipments',
    icon: I(ScanBarcode),
    children: [
      { key: '/airline-equipments-overview', label: 'Equipments Dashboard', icon: I(LayoutDashboard) },
      { key: '/airline-equipments',     label: 'Assets',         icon: I(Boxes) },
      { key: '/equipment-maintenance',  label: 'Maintenance',    icon: I(Wrench) },
      { key: '/equipment-returns',      label: 'Returns',        icon: I(Undo2) },
      { key: '/equipment-damage',       label: 'Damage Reports', icon: I(ShieldAlert) },
    ],
  },

  // ── 10. Maintenance ────────────────────────────────────────────────────────
  {
    key: 'maintenance',
    label: 'Maintenance & Assets',
    icon: I(Wrench),
    children: [
      { key: '/maintenance-overview', label: 'Maintenance Dashboard', icon: I(LayoutDashboard) },
      { key: '/maintenance',          label: 'Maintenance', icon: I(Wrench) },
    ],
  },

  // ── 11. Reports ────────────────────────────────────────────────────────────
  {
    key: 'reports',
    label: 'Reports',
    icon: I(BarChart3),
    children: [
      { key: '/reports', label: 'Reports', icon: I(BarChart3) },
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
      { key: '/config-company',    label: 'Company Profile',  icon: I(Building2) },
      { key: '/config-airline',    label: 'Airline',          icon: I(Plane) },
      { key: '/config-office',     label: 'Office',           icon: I(Building2) },
      { key: '/config-warehouse',  label: 'Warehouse',        icon: I(Warehouse) },
      { key: '/config-price',      label: 'Price Setup',      icon: I(BadgeDollarSign) },
      { key: '/config-approval',   label: 'Approval Setup',   icon: I(GitBranch) },
      { key: '/config-meal-slots', label: 'Meal Slots',       icon: I(Clock) },
    ],
  },
];
