import type { ElementKind, RbacElement } from "./access-control";

// ─────────────────────────────────────────────────────────────────────────────
// Page content catalog — the exhaustive list of manageable UI elements for every
// page, used by User Access Control so an admin can show/hide each role's access
// down to individual KPI cards, table columns, form fields, action buttons and
// page sections.
//
//   • Column ids ("col:<key>") use the REAL DataTable column keys, so toggling a
//     column on a standard data table hides it live (DataTable filters by these).
//   • KPI / field / action / section ids are stable slugs per page; pages gate
//     their rendering with canElement(role, route, id, "view").
//
// This catalog is registered into the RBAC element registry at load (see
// access-control.ts), so the matrix is fully populated even for pages the admin
// has never opened. Extend a page's list here and it appears automatically.
// ─────────────────────────────────────────────────────────────────────────────

type Group = {
  columns?: [string, string][];
  kpis?: [string, string][];
  fields?: [string, string][];
  actions?: [string, string][];
  sections?: [string, string][];
};

// Compact source map: route → element groups as [id, label] tuples.
const SRC: Record<string, Group> = {
  "/": {
    kpis: [
      ["kpi-flights", "Flights Today"], ["kpi-meals", "Meals Prepared"],
      ["kpi-delayed", "Delayed Flights"], ["kpi-qc", "QC Issues"],
      ["kpi-pos", "Pending POs"], ["kpi-inv", "Inventory Alerts"],
      ["kpi-dispatch", "Dispatch Active"], ["kpi-cost", "Stock Value"],
    ],
    actions: [["action-export-report", "Export Report"]],
    sections: [
      ["section-active-orders", "Active Orders"], ["section-production-mix", "Production Mix"],
      ["section-meal-production-trend", "Meal Production Trend"], ["section-activity-feed", "Activity Feed"],
      ["section-production-progress", "Production Progress"], ["section-procurement-pipeline", "Procurement Pipeline"],
    ],
  },
  "/operations-overview": {
    columns: [["col:order", "Order"], ["col:flight", "Flight"], ["col:sector", "Sector"], ["col:etd", "ETD"], ["col:pax", "Pax"], ["col:status", "Status"]],
    kpis: [["kpi-total-orders", "Total Orders"], ["kpi-total-flights", "Total Flights"], ["kpi-todays-flights", "Today's Flights"], ["kpi-todays-crew", "Today's Crew"], ["kpi-pending", "Pending"], ["kpi-approved", "Approved"], ["kpi-in-production", "In Production"], ["kpi-special-meals", "Special Meals"]],
    sections: [["section-14-day-flight-volume-trend", "14-Day Flight Volume Trend"], ["section-flights-by-status", "Flights by Status"], ["section-top-sectors-by-legs", "Top Sectors (by Legs)"], ["section-todays-active-flights", "Today's Active Flights"]],
  },
  "/order-management": {
    columns: [["col:flight", "Flight"], ["col:airline", "Airline"], ["col:sector", "Sector"], ["col:date", "Date"], ["col:etd", "ETD"], ["col:pax", "PAX"], ["col:spec-meals", "Spec. Meals"], ["col:action", "Action"]],
    actions: [["action-bulk", "Bulk Upload"], ["action-create", "Create Order"]],
    fields: [["field-scope", "Scope"], ["field-airline", "Airline"], ["field-date", "Date"], ["field-flight-number", "Flight Number"], ["field-from", "From"], ["field-to", "To"], ["field-etd", "ETD"], ["field-pax", "PAX"], ["field-special-meals", "Special Meals"], ["field-direction", "Direction"]],
    sections: [["section-flight-orders", "Flight Orders"], ["section-crew-meals", "Crew Meals"]],
  },
  "/meal-planning": {
    actions: [["action-new-meal", "New Menu"]],
    fields: [["field-day", "Day"], ["field-flight-type", "Flight Type"], ["field-for", "For"], ["field-meal-percentage", "Meal Percentage"], ["field-serving-time", "Serving Time"]],
    sections: [["section-meal-configuration", "Meal Configuration"], ["section-special-meals", "Special Meals"], ["section-dessert", "Dessert"]],
  },
  "/production-overview": {
    columns: [["col:run", "Run #"], ["col:production-order", "Production Order"], ["col:item", "Item"], ["col:shift", "Shift"], ["col:produced-by", "Produced By"], ["col:date", "Date"], ["col:qty", "Qty"]],
    kpis: [["kpi-production-orders", "Production Orders"], ["kpi-pending", "Pending"], ["kpi-in-preparation", "In Preparation"], ["kpi-ready-for-qc", "Ready for QC"], ["kpi-completed", "Completed"], ["kpi-units-produced", "Units Produced"], ["kpi-fulfilment", "Fulfilment"], ["kpi-qc-pass-rate", "QC Pass Rate"]],
    sections: [["section-orders-by-status", "Orders by Status"], ["section-top-produced-items", "Top Produced Items"], ["section-recent-production-runs", "Recent Production Runs"]],
  },
  "/bom": {
    columns: [["col:sl", "SL"], ["col:date", "Date"], ["col:bom-name", "BOM Name"], ["col:item-name", "Item Name"], ["col:uom", "UoM"], ["col:lot-size", "Lot Size"], ["col:bom-value", "BOM Value"], ["col:office-warehouse", "Office / Warehouse"], ["col:created-by", "Created By"], ["col:action", "Action"]],
    kpis: [["kpi-total-boms", "Total BOMs"], ["kpi-active", "Active"], ["kpi-inactive", "Inactive"]],
    actions: [["action-export", "Export"], ["action-create-bom", "Create BOM"], ["action-save", "Save"]],
    fields: [["field-bom-name", "BOM Name"], ["field-item-type", "Item Type"], ["field-category", "Category"], ["field-sub-category", "Sub Category"], ["field-fg-sfg-item", "FG/SFG Item"], ["field-lot-size", "Lot Size"]],
    sections: [["section-create-bill-of-material", "Create Bill of Material"], ["section-input-materials-setup", "Input Materials Setup"]],
  },
  "/production-entry": {
    columns: [["col:__sl", "SL"], ["col:id", "Order No"], ["col:date", "Date"], ["col:officeId", "Office / Warehouse"], ["col:bom", "BOM"], ["col:outputItemName", "Production Item"], ["col:orderQty", "Order Qty"], ["col:producedQty", "Produced Qty"], ["col:status", "Status"]],
    actions: [["action-create-order", "Create Order"], ["action-view-details", "View Details"], ["action-save", "Save"]],
    fields: [["field-order-date", "Order Date"], ["field-bom-name", "BOM Name"], ["field-remarks", "Remarks"], ["field-production-item", "Production Item"], ["field-order-quantity", "Order Quantity"]],
    sections: [["section-production-information", "Production Information"], ["section-production-output-item", "Production Output Item"], ["section-material-item-information", "Material Item Information"]],
  },
  "/production-entry-new": {
    columns: [["col:id", "Entry No"], ["col:date", "Date"], ["col:productionOrderId", "Production Order"], ["col:officeId", "Office / Warehouse"], ["col:producedQty", "Produced Qty"], ["col:batchNo", "Batch"], ["col:shift", "Shift"], ["col:producedBy", "Produced By"], ["col:actions", "Actions"]],
    kpis: [["kpi-total-entries", "Total Entries"], ["kpi-total-produced", "Total Produced"], ["kpi-fulfillable-orders", "Fulfillable Orders"]],
    actions: [["action-create-entry", "Create Entry"], ["action-save-entry", "Save Entry"]],
    fields: [["field-production-order", "Production Order"], ["field-produced-quantity", "Produced Quantity"], ["field-batch-no", "Batch No."], ["field-shift", "Shift"], ["field-produced-by", "Produced By"], ["field-remarks", "Remarks"]],
    sections: [["section-log-production-entry", "Log Production Entry"]],
  },
  "/production-reports": {
    columns: [["col:id", "Entry No"], ["col:date", "Date"], ["col:bom", "BOM"], ["col:producedQty", "Produced Qty"], ["col:status", "Status"]],
    kpis: [["kpi-total-entries", "Total Entries"], ["kpi-total-produced-qty", "Total Produced Qty"], ["kpi-closed", "Closed"], ["kpi-in-progress", "In Progress"]],
    actions: [["action-export", "Export"]],
    sections: [["section-production-output-by-bom", "Production Output by BOM"], ["section-status-distribution", "Status Distribution"], ["section-daily-production-trend", "Daily Production Trend"], ["section-entries-in-period", "Entries in Period"]],
  },
  "/inventory-overview": {
    columns: [["col:item", "Item"], ["col:category", "Category"], ["col:storage", "Storage"], ["col:stock", "Stock"], ["col:reorder", "Reorder"], ["col:deficit", "Deficit"], ["col:status", "Status"]],
    kpis: [["kpi-total-skus", "Total SKUs"], ["kpi-inventory-value", "Inventory Value"], ["kpi-low-stock", "Low Stock"], ["kpi-critical", "Critical"], ["kpi-expiring-7d", "Expiring ≤ 7d"], ["kpi-expiring-30d", "Expiring ≤ 30d"], ["kpi-pending-demand", "Pending Demand"], ["kpi-open-transfers", "Open Transfers"]],
    sections: [["section-inventory-value-by-category-top-6", "Inventory Value by Category (Top 6)"], ["section-skus-by-storage-type", "SKUs by Storage Type"], ["section-low-stock-replenishment-needed", "Low Stock — Replenishment Needed"]],
  },
  "/demand-orders": {
    columns: [["col:id", "Request #"], ["col:requestedBy", "Requested By"], ["col:officeId", "Office / Warehouse"], ["col:role", "From"], ["col:date", "Date"], ["col:status", "Status"], ["col:items", "Items"]],
    kpis: [["kpi-total-requests", "Total Requests"], ["kpi-pending-approval", "Pending Approval"], ["kpi-pending-review", "Pending Review"], ["kpi-escalated-to-supply-chain", "Escalated to Supply Chain"], ["kpi-fulfilled", "Fulfilled"]],
    actions: [["action-new-demand", "New Demand"], ["action-add", "Add"], ["action-create-demand", "Create Demand"]],
    fields: [["field-requested-by", "Requested By"], ["field-note", "Note"], ["field-items", "Items"]],
    sections: [["section-demand-requests-store-review", "Demand Requests — Store Review"]],
  },
  "/item-issue": {
    columns: [["col:demandRef", "Demand Ref"], ["col:officeId", "Office / Warehouse"], ["col:from", "From"], ["col:to", "To"], ["col:items", "Items"], ["col:issuedBy", "Issued By"], ["col:date", "Date"], ["col:status", "Status"]],
    kpis: [["kpi-total-issues", "Total Issues"], ["kpi-pending-demands", "Pending Demands"], ["kpi-issued", "Issued"]],
    actions: [["action-new-issue", "New Issue"], ["action-issue-items", "Issue Items"], ["action-add", "Add"], ["action-mark-as-issued", "Mark as Issued"]],
    fields: [["field-to-kitchen-section", "To (Kitchen Section)"], ["field-issued-by", "Issued By"], ["field-demand-reference", "Demand Reference"], ["field-add-item", "Add Item"], ["field-qty", "Qty"]],
    sections: [["section-pending-demands", "Pending Demands"], ["section-issued-items", "Issued Items"]],
  },
  "/transfer-request": {
    columns: [["col:id", "TR #"], ["col:date", "Date"], ["col:from", "Route"], ["col:requestedBy", "Requested By"], ["col:lines", "Items"], ["col:status", "Status"]],
    kpis: [["kpi-total-requests", "Total Requests"], ["kpi-pending-approval", "Pending Approval"], ["kpi-approved", "Approved"], ["kpi-completed", "Completed"]],
    actions: [["action-new-request", "New Request"], ["action-save-draft", "Save Draft"], ["action-submit", "Submit"], ["action-add", "Add"]],
    fields: [["field-from-location", "From Location"], ["field-to-location", "To Location"], ["field-requested-by", "Requested By"], ["field-reason-purpose", "Reason / Purpose"], ["field-item", "Item"], ["field-quantity", "Quantity"]],
    sections: [["section-request-details", "Request Details"], ["section-items", "Items"]],
  },
  "/transfer": {
    columns: [["col:id", "TRF #"], ["col:date", "Date"], ["col:officeId", "Office / Warehouse"], ["col:trRef", "TR Ref"], ["col:from", "Route"], ["col:issuedBy", "Issued By"], ["col:receivedBy", "Received By"], ["col:lines", "Items"], ["col:status", "Status"]],
    kpis: [["kpi-total-transfers", "Total Transfers"], ["kpi-pending", "Pending"], ["kpi-in-transit", "In Transit"], ["kpi-completed", "Completed"]],
    actions: [["action-new-transfer", "New Transfer"], ["action-save-pending", "Save Pending"], ["action-mark-in-transit", "Mark In Transit"], ["action-complete", "Complete"], ["action-add-item", "Add Item"], ["action-receive", "Receive"], ["action-create-return", "Create Return"]],
    fields: [["field-transfer-kind", "Transfer Kind"], ["field-from-location", "From Location"], ["field-to-location", "To Location"], ["field-issued-by", "Issued By"], ["field-received-by", "Received By"], ["field-item", "Item"]],
    sections: [["section-transfer-details", "Transfer Details"], ["section-items", "Items"], ["section-transfer-out", "Transfer Out"], ["section-transfer-in-transit", "Transfer In Transit"], ["section-return-list", "Return List"], ["section-transfer-in-received", "Transfer In / Received"]],
  },
  "/inventory": {
    columns: [["col:id", "Code"], ["col:name", "Item"], ["col:officeId", "Office / Warehouse"], ["col:category", "Category"], ["col:uom", "UOM"], ["col:stock", "Stock"], ["col:in-qty", "In Qty"], ["col:out-qty", "Out Qty"], ["col:reorder", "Reorder Lvl"], ["col:method", "Method"], ["col:status", "Status"]],
    kpis: [["kpi-total-items", "Total Items"], ["kpi-low-stock", "Low Stock"], ["kpi-critical", "Critical"], ["kpi-near-expiry-30d", "Near Expiry (30d)"], ["kpi-stock-value-fefo", "Stock Value (FEFO)"]],
    actions: [["action-add-item", "Add Item"], ["action-save-changes", "Save Changes"]],
    fields: [["field-item-name", "Item Name"], ["field-category", "Category"], ["field-uom", "UOM"], ["field-current-stock", "Current Stock"], ["field-reorder-level", "Reorder Level"], ["field-stock-threshold", "Stock Threshold (%)"], ["field-batch-no", "Batch No."], ["field-expiry-date", "Expiry Date"], ["field-storage", "Storage"]],
  },
  "/stock-adjustment": {
    columns: [["col:id", "Adj #"], ["col:date", "Date"], ["col:itemCode", "Item Code"], ["col:item", "Item"], ["col:adjustQty", "Adjustment"], ["col:reason", "Reason"], ["col:reference", "Reference"], ["col:adjustedBy", "Adjusted By"], ["col:status", "Status"]],
    kpis: [["kpi-total-adjustments", "Total Adjustments"], ["kpi-approved", "Approved"], ["kpi-pending-approval", "Pending Approval"], ["kpi-rejected", "Rejected"]],
    actions: [["action-new-adjustment", "New Adjustment"], ["action-submit-for-approval", "Submit for Approval"]],
    fields: [["field-item", "Item"], ["field-adjustment-type", "Adjustment Type"], ["field-quantity", "Quantity"], ["field-reason", "Reason"], ["field-reference", "Reference #"], ["field-adjusted-by", "Adjusted By"], ["field-remarks", "Remarks"]],
  },
  "/supply-chain-overview": {
    columns: [["col:po-num", "PO #"], ["col:vendor", "Vendor"], ["col:date", "Date"], ["col:items", "Items"], ["col:amount", "Amount"], ["col:status", "Status"]],
    kpis: [["kpi-total-pos", "Total POs"], ["kpi-po-value", "PO Value"], ["kpi-pending-approval", "Pending Approval"], ["kpi-ordered", "Ordered"], ["kpi-received", "Received"], ["kpi-open-prs", "Open PRs"], ["kpi-grns", "GRNs"], ["kpi-avg-vendor-rating", "Avg Vendor Rating"]],
    sections: [["section-pos-by-status", "POs by Status"], ["section-spend-by-vendor-top-6", "Spend by Vendor (Top 6)"], ["section-recent-purchase-orders", "Recent Purchase Orders"]],
  },
  "/purchase-requisition": {
    columns: [["col:id", "PR No"], ["col:date", "Date"], ["col:officeId", "Office / Warehouse"], ["col:requestedBy", "Requested By"], ["col:lines", "Items"], ["col:totalAmount", "Est. Amount"], ["col:priority", "Priority"], ["col:status", "Status"]],
    kpis: [["kpi-total-prs", "Total PRs"], ["kpi-draft", "Draft"], ["kpi-pending-approval", "Pending Approval"], ["kpi-approved", "Approved"]],
    actions: [["action-create-requisition", "Create Requisition"], ["action-save-draft", "Save Draft"], ["action-submit-for-approval", "Submit for Approval"]],
    fields: [["field-pr-date", "PR Date"], ["field-required-by", "Required By"], ["field-requested-by", "Requested By"], ["field-priority", "Priority"], ["field-justification-remarks", "Justification / Remarks"], ["field-item", "Item"], ["field-qty", "Qty"], ["field-uom", "UoM"], ["field-est-rate", "Est. Rate"]],
    sections: [["section-requisition-information", "Requisition Information"], ["section-line-items", "Line Items"]],
  },
  "/request-for-quotation": {
    columns: [["col:id", "RFQ #"], ["col:date", "Date"], ["col:prRef", "PR Ref"], ["col:lines", "Items"], ["col:invitedSuppliers", "Suppliers"], ["col:deadline", "Deadline"], ["col:status", "Status"]],
    kpis: [["kpi-total-rfqs", "Total RFQs"], ["kpi-open", "Open"], ["kpi-drafts", "Drafts"], ["kpi-closed", "Closed"]],
    actions: [["action-new-rfq", "New RFQ"], ["action-save-draft", "Save Draft"], ["action-send-to-suppliers", "Send to Suppliers"], ["action-add-line", "Add Line"]],
    fields: [["field-date", "Date"], ["field-pr-reference", "PR Reference"], ["field-response-deadline", "Response Deadline"], ["field-invite-suppliers", "Invite Suppliers"], ["field-notes", "Notes"]],
    sections: [["section-new-request-for-quotation", "New Request for Quotation"], ["section-items-requested", "Items Requested"]],
  },
  "/quotation-entry": {
    columns: [["col:id", "Quotation #"], ["col:date", "Date"], ["col:rfqRef", "RFQ Ref"], ["col:supplier", "Supplier"], ["col:lines", "Items"], ["col:total", "Total (৳)"], ["col:validity", "Valid Till"], ["col:leadTimeDays", "Lead Time"], ["col:status", "Status"]],
    kpis: [["kpi-total-quotations", "Total Quotations"], ["kpi-submitted", "Submitted"], ["kpi-selected", "Selected"], ["kpi-aggregate-value", "Aggregate Value"]],
    actions: [["action-new-quotation", "New Quotation"], ["action-save-draft", "Save Draft"], ["action-submit", "Submit"], ["action-add-line", "Add Line"]],
    fields: [["field-date", "Date"], ["field-rfq-reference", "RFQ Reference"], ["field-supplier", "Supplier"], ["field-valid-till", "Valid Till"], ["field-lead-time-days", "Lead Time (days)"], ["field-payment-terms", "Payment Terms"], ["field-notes", "Notes"]],
    sections: [["section-new-quotation", "New Quotation"], ["section-quoted-items", "Quoted Items"]],
  },
  "/comparative-statement": {
    columns: [["col:id", "CS #"], ["col:date", "Date"], ["col:rfqRef", "RFQ Ref"], ["col:preparedBy", "Prepared By"], ["col:lines", "Lines"], ["col:awardedTotal", "Awarded (৳)"], ["col:status", "Status"]],
    kpis: [["kpi-total-statements", "Total Statements"], ["kpi-pending-approval", "Pending Approval"], ["kpi-approved", "Approved"], ["kpi-awarded-value", "Awarded Value"]],
    actions: [["action-new-cs", "New CS"], ["action-save-draft", "Save Draft"], ["action-submit-for-approval", "Submit for Approval"], ["action-add-item", "Add Item"]],
    fields: [["field-date", "Date"], ["field-rfq-reference", "RFQ Reference"], ["field-prepared-by", "Prepared By"], ["field-suppliers-compared", "Suppliers Compared"], ["field-remarks", "Remarks"]],
    sections: [["section-new-comparative-statement", "New Comparative Statement"], ["section-item-comparison-matrix", "Item Comparison Matrix"]],
  },
  "/procurement": {
    columns: [["col:id", "PO #"], ["col:vendor", "Vendor"], ["col:requisitionRef", "Req Ref"], ["col:officeId", "Office / Warehouse"], ["col:items", "Items"], ["col:amount", "Amount (৳)"], ["col:date", "Date"], ["col:status", "Status"]],
    kpis: [["kpi-open-pos", "Open POs"], ["kpi-pending-approval", "Pending Approval"], ["kpi-active-vendors", "Active Vendors"]],
    actions: [["action-export", "Export"], ["action-new-po", "New PO"], ["action-create-po", "Create PO"], ["action-add-item", "Add Item"], ["action-save-draft", "Save Draft"], ["action-submit-for-approval", "Submit for Approval"]],
    fields: [["field-requisition-ref", "Requisition Ref"], ["field-vendor", "Vendor"], ["field-delivery-date", "Est. Receive Date"], ["field-notes", "Notes"]],
    sections: [["section-requisitions-from-store", "Requisitions from Store"], ["section-purchase-orders", "Purchase Orders"]],
  },
  "/receive-item": {
    columns: [["col:id", "GRN #"], ["col:po", "PO Ref"], ["col:vendor", "Vendor"], ["col:officeId", "Office / Warehouse"], ["col:item", "Item"], ["col:qty", "Qty"], ["col:uom", "UOM"], ["col:temp", "Temp °C"], ["col:expiry", "Expiry"], ["col:receivedBy", "Received By"], ["col:status", "QC Status"]],
    kpis: [["kpi-receipts-today", "Receipts Today"], ["kpi-accepted", "Accepted"], ["kpi-on-hold", "On Hold"], ["kpi-rejected", "Rejected"]],
    actions: [["action-new-grn", "New GRN"], ["action-add-row", "Add Row"], ["action-save-grn", "Save GRN"]],
    fields: [["field-po-reference", "PO Reference"], ["field-vendor", "Vendor (auto-filled)"], ["field-received-by", "Received By"]],
    sections: [["section-items-received", "Items Received"]],
  },
  "/purchase-return": {
    columns: [["col:id", "Return #"], ["col:date", "Date"], ["col:poRef", "PO Ref"], ["col:supplier", "Supplier"], ["col:lines", "Items"], ["col:totalValue", "Value (৳)"], ["col:status", "Status"]],
    kpis: [["kpi-total-returns", "Total Returns"], ["kpi-open", "Open"], ["kpi-completed", "Completed"], ["kpi-returned-value", "Returned Value"]],
    actions: [["action-new-return", "New Return"], ["action-save-draft", "Save Draft"], ["action-submit", "Submit"], ["action-add-line", "Add Line"]],
    fields: [["field-date", "Date"], ["field-po-reference", "PO Reference"], ["field-supplier", "Supplier"], ["field-remarks", "Remarks"]],
    sections: [["section-new-purchase-return", "New Purchase Return"], ["section-returned-items", "Returned Items"]],
  },
  "/purchase-reports": {
    columns: [["col:supplier", "Supplier"], ["col:category", "Category"], ["col:pos", "POs"], ["col:spend", "Spend (৳)"], ["col:share", "Share"], ["col:id", "PO #"], ["col:date", "Date"], ["col:vendor", "Vendor"], ["col:items", "Items"], ["col:amount", "Amount (৳)"], ["col:status", "Status"]],
    kpis: [["kpi-total-spend", "Total Spend"], ["kpi-purchase-orders", "Purchase Orders"], ["kpi-avg-order-value", "Avg Order Value"], ["kpi-active-vendors", "Active Vendors"]],
    actions: [["action-export", "Export"]],
    sections: [["section-monthly-spend-trend", "Monthly Spend Trend"], ["section-po-status-mix", "PO Status Mix"], ["section-supplier-wise-spend-top-10", "Supplier-wise Spend (Top 10)"], ["section-category-wise-spend", "Category-wise Spend"], ["section-recent-purchase-orders", "Recent Purchase Orders"]],
  },
  "/accounts-overview": {
    columns: [["col:po", "PO #"], ["col:vendor", "Vendor"], ["col:invoice-date", "Invoice Date"], ["col:amount", "Amount"], ["col:age-days", "Age (days)"], ["col:status", "Status"]],
    kpis: [["kpi-invoiced-pos", "Invoiced POs"], ["kpi-total-invoiced", "Total Invoiced"], ["kpi-paid", "Paid"], ["kpi-outstanding", "Outstanding"], ["kpi-collection-rate", "Collection Rate"], ["kpi-pending-approvals", "Pending Approvals"], ["kpi-grns", "GRNs"], ["kpi-past-due-60d", "Past Due 60d+"]],
    sections: [["section-payment-aging-outstanding", "Payment Aging (Outstanding)"], ["section-spend-by-vendor-top-6", "Spend by Vendor (Top 6)"], ["section-outstanding-invoices", "Outstanding Invoices"]],
  },
  "/accounts-invoices": {
    columns: [["col:id", "Invoice #"], ["col:vendor", "Vendor"], ["col:poRef", "PO Ref"], ["col:flight", "Flight"], ["col:amount", "Amount (৳)"], ["col:paymentMethod", "Method"], ["col:submittedBy", "Submitted By"], ["col:date", "Date"], ["col:dueDate", "Due Date"], ["col:status", "Status"]],
    kpis: [["kpi-total-invoiced", "Total Invoiced"], ["kpi-pending-review", "Pending Review"], ["kpi-approved", "Approved"], ["kpi-total-paid", "Total Paid"]],
    actions: [["action-export", "Export"], ["action-record-invoice", "Record Invoice"]],
    fields: [["field-vendor", "Vendor"], ["field-linked-po", "Linked PO"], ["field-flight-ref", "Flight Ref"], ["field-invoice-date", "Invoice Date"], ["field-due-date", "Due Date"], ["field-amount", "Amount (৳)"], ["field-payment-method", "Payment Method"], ["field-submitted-by", "Submitted By"], ["field-notes", "Notes"]],
  },
  "/accounts-expenses": {
    columns: [["col:vendor", "Vendor"], ["col:invoices", "Invoices"], ["col:total", "Total (৳)"], ["col:paid", "Paid (৳)"], ["col:outstanding", "Outstanding (৳)"], ["col:status", "Status"]],
    kpis: [["kpi-total-invoiced", "Total Invoiced"], ["kpi-total-paid", "Total Paid"], ["kpi-outstanding", "Outstanding"], ["kpi-rejected-amount", "Rejected Amount"]],
    actions: [["action-export", "Export"]],
    sections: [["section-vendor-spend-breakdown", "Vendor Spend Breakdown"], ["section-payment-method-breakdown", "Payment Method Breakdown"], ["section-status-summary", "Status Summary"], ["section-recent-payments", "Recent Payments"]],
  },
  "/accounts": {
    columns: [["col:id", "PO Number"], ["col:vendor", "Vendor"], ["col:flightRef", "Flight Reference"], ["col:itemsCount", "Items Count"], ["col:totalAmount", "Total Amount (৳)"], ["col:createdBy", "Created By"], ["col:date", "Date"], ["col:status", "Status"]],
    kpis: [["kpi-total-pos", "Total POs"], ["kpi-total-boms", "Total BOMs"], ["kpi-pending-invoices", "Pending Invoices"]],
    actions: [["action-export", "Export"], ["action-create-new-po", "Create New PO"]],
    fields: [["field-vendor", "Vendor"], ["field-flight-reference", "Flight Reference"], ["field-po-date", "PO Date"], ["field-payment-terms", "Payment Terms"], ["field-notes", "Notes"], ["field-bom-reference", "BOM Reference (optional)"]],
    sections: [["section-purchase-orders", "Purchase Orders"], ["section-bom", "BOM"], ["section-payments-approvals", "Payments & Approvals"]],
  },
  "/food-safety-overview": {
    columns: [["col:id", "ID"], ["col:time", "Time"], ["col:activity", "Activity"], ["col:remarks", "Remarks"], ["col:status", "Status"]],
    kpis: [["kpi-cooking-temp-tests", "Cooking-Temp Tests"], ["kpi-pass-rate", "Pass Rate"], ["kpi-failed-tests", "Failed Tests"], ["kpi-temp-deviations", "Temp Deviations"], ["kpi-avg-core-temp", "Avg Core Temp"], ["kpi-hygiene-checks", "Hygiene Checks"], ["kpi-hygiene-pending", "Hygiene Pending"], ["kpi-hygiene-completion", "Hygiene Completion"]],
    sections: [["section-cooking-temp-test-outcome-by-item", "Cooking-Temp Test Outcome by Item"], ["section-hygiene-check-status", "Hygiene Check Status"], ["section-recent-hygiene-checks", "Recent Hygiene Checks"]],
  },
  "/hygiene-monitoring": {
    columns: [["col:sl", "SL"], ["col:checklist", "Checklist"], ["col:remarks", "Remarks"], ["col:actions", "Actions"]],
    actions: [["action-mobile-app-view", "Mobile App View"], ["action-add-new", "Add New"], ["action-save-draft", "Save Draft"], ["action-confirm-submit", "Confirm & Submit"]],
    fields: [["field-checklist-item-description", "Checklist Item Description"], ["field-time-schedule", "Time Schedule (Optional)"]],
    sections: [["section-submitted-reports", "Submitted Reports"]],
  },
  "/cooking-temp": {
    columns: [["col:id", "Log #"], ["col:batch", "Batch No."], ["col:item", "Item"], ["col:cookingTime", "Cooking Time"], ["col:standardTemp", "Standard °C"], ["col:measuredTemp", "Measured °C"], ["col:cookedBy", "Cooked By"], ["col:sensoryPass", "Sensory"], ["col:checkedBy", "Checked By (Sup-Hygiene)"]],
    kpis: [["kpi-tests-today", "Tests Today"], ["kpi-pass-rate", "Pass Rate"], ["kpi-avg-core-temp", "Avg Core Temp"], ["kpi-failed", "Failed"]],
    actions: [["action-haccp-standard-configuration", "HACCP Standard Configuration"], ["action-mobile-app-view", "Mobile App View"], ["action-record-test", "Record Test"]],
    fields: [["field-item", "Item"], ["field-standard-temp-c", "Standard Temp (°C)"]],
    sections: [["section-batches-pending-qc", "Batches Pending QC"]],
  },
  "/dispatch-monitoring": {
    columns: [["col:flight", "Flight"], ["col:pkg-date", "Pkg. Date"], ["col:qty", "Qty"], ["col:vehicle", "Vehicle"], ["col:clean", "Clean"], ["col:chilled", "Chilled (1–4°C)"], ["col:frozen", "Frozen (-10±2°C)"], ["col:load-start", "Load Start"], ["col:load-end", "Load End"], ["col:veh-begin", "Veh. Begin"], ["col:veh-end", "Veh. End"], ["col:result", "Result"], ["col:gate-08-temp", "Gate 08 Temp"], ["col:unloading", "Unloading"], ["col:apt-exec", "APT Exec."], ["col:remarks", "Remarks"], ["col:actions", "Actions"]],
    kpis: [["kpi-total-dispatches", "Total Dispatches"], ["kpi-result-satisfied", "Result Satisfied"], ["kpi-not-satisfied", "Not Satisfied"], ["kpi-vehicle-issues", "Vehicle Issues"]],
    actions: [["action-mobile-app-view", "Mobile App View"], ["action-add-dispatch-entry", "Add Dispatch Entry"], ["action-save-dispatch-entry", "Save Dispatch Entry"], ["action-save-and-accept", "Save (Airport Receive)"]],
    fields: [["field-departure-time", "Departure Time"], ["field-flight-number", "Flight Number"], ["field-date-of-packaging", "Date of Packaging"], ["field-meal-types-quantities", "Meal Types & Quantities"], ["field-vehicle-no", "Vehicle No."], ["field-vehicle-clean", "Vehicle Clean"], ["field-chilled-temp-c", "Chilled Temp (°C)"], ["field-frozen-temp-c", "Frozen Temp (°C)"], ["field-load-start", "Load Start"], ["field-load-end", "Load End"], ["field-veh-temp-begin-c", "Veh. Temp Begin (°C)"], ["field-veh-temp-end-c", "Veh. Temp End (°C)"], ["field-result-satisfy", "Result Satisfy"], ["field-gate-08-temp-c", "Gate 08 Temp (°C)"], ["field-time-of-unloading", "Time of Unloading"]],
    sections: [["section-catering-point-dispatch-entry", "Catering Point Dispatch Entry"], ["section-flight-packaging", "Flight & Packaging"], ["section-vehicle-details", "Vehicle Details"], ["section-product-core-temperature", "Product Core Temperature"], ["section-loading-times-vehicle-temperature", "Loading Times & Vehicle Temperature"], ["section-result-check", "Result Check"], ["section-dispatch-log", "Dispatch Log"], ["section-airport-point-receiving-entry", "Airport Point Receiving Entry"], ["section-airport-gate-details-gate-no-08", "Airport Gate Details — Gate No. 08"], ["section-receipt-log", "Receipt Log"]],
  },
  "/packaging-dispatch-overview": {
    columns: [["col:dispatch", "Dispatch #"], ["col:flight", "Flight"], ["col:trays", "Trays"], ["col:carts", "Carts"], ["col:vehicle", "Vehicle"], ["col:driver", "Driver"], ["col:status", "Status"]],
    kpis: [["kpi-total-loads", "Total Loads"], ["kpi-preparing", "Preparing"], ["kpi-in-transit", "In Transit"], ["kpi-delivered", "Delivered"], ["kpi-trays-out", "Trays Out"], ["kpi-vehicles", "Vehicles"], ["kpi-qc-pass", "QC Pass"], ["kpi-qc-fail", "QC Fail"]],
    sections: [["section-dispatch-mix-by-status", "Dispatch Mix by Status"], ["section-vehicle-load-trays", "Vehicle Load (Trays)"], ["section-active-dispatches", "Active Dispatches"]],
  },
  "/dispatch": {
    columns: [["col:dep-time", "Dep Time"], ["col:flight", "Flight"], ["col:order", "Order"], ["col:production", "Production"], ["col:meal-type", "Meal Type"], ["col:meal-name", "Meal Name"], ["col:qty", "Qty"], ["col:warehouse", "Warehouse"], ["col:status", "Status"], ["col:food-safety-qc", "Food Safety & QC"], ["col:actions", "Actions"]],
    kpis: [["kpi-active-dispatches", "Active Dispatches"], ["kpi-trays-prepared", "Trays Prepared"], ["kpi-vehicles-on-trip", "Vehicles On Trip"], ["kpi-delivered-today", "Delivered Today"]],
    actions: [["action-new-dispatch", "New Dispatch"], ["action-initiate-packaging", "Initiate Packaging"], ["action-initiate-qc", "Initiate QC"], ["action-initiate-dispatch", "Initiate Dispatch"], ["action-save-create-dispatch", "Save & Create Dispatch"]],
    fields: [["field-date", "Date"], ["field-select-flight", "Select Flight"], ["field-pax-main-meal", "PAX Main Meal"], ["field-crew-meals", "Crew Meals"], ["field-special-meals", "Special Meals"], ["field-additional-items", "Additional Items"]],
    sections: [["section-production-status", "Production Status"], ["section-pax-main-meal", "PAX Main Meal"], ["section-crew-meals", "Crew Meals"], ["section-special-meals", "Special Meals"], ["section-additional-items", "Additional Items"], ["section-dispatched-records", "Dispatched Records"]],
  },
  "/airline-consumables-overview": {
    columns: [["col:sku", "SKU"], ["col:item", "Item"], ["col:category", "Category"], ["col:stock", "Stock"], ["col:reorder", "Reorder"], ["col:deficit", "Deficit"], ["col:status", "Status"]],
    kpis: [["kpi-total-skus", "Total SKUs"], ["kpi-total-stock", "Total Stock"], ["kpi-stock-value", "Stock Value"], ["kpi-in-reorder", "In Reorder"], ["kpi-healthy-skus", "Healthy SKUs"], ["kpi-total-usage", "Total Usage"], ["kpi-flights-served", "Flights Served"], ["kpi-categories", "Categories"]],
    sections: [["section-stock-on-hand-by-category", "Stock On Hand by Category"], ["section-usage-by-cabin-class", "Usage by Cabin Class"], ["section-reorder-required", "Reorder Required"]],
  },
  "/consumable-usage": {
    columns: [["col:sl", "SL"], ["col:usage-id", "Usage ID"], ["col:date", "Date"], ["col:flight", "Flight"], ["col:sector", "Sector"], ["col:class", "Class"], ["col:item", "Item"], ["col:qty", "Qty"], ["col:value", "Value"]],
    kpis: [["kpi-usage-entries", "Usage Entries"], ["kpi-flights-covered", "Flights Covered"], ["kpi-total-units-loaded", "Total Units Loaded"], ["kpi-total-value", "Total Value"]],
    actions: [["action-new-usage-entry", "New Usage Entry"], ["action-save-entry", "Save Entry"]],
    fields: [["field-date", "Date"], ["field-cabin-class", "Cabin Class"], ["field-flight", "Flight #"], ["field-sector", "Sector"], ["field-consumable-item", "Consumable Item"], ["field-qty-loaded", "Qty Loaded"]],
    sections: [["section-new-consumable-usage-entry", "New Consumable Usage Entry"]],
  },
  "/consumable-allocation": {
    columns: [["col:flight-item", "Flight / Item"], ["col:sector", "Sector"], ["col:class", "Class"], ["col:qty", "Qty"], ["col:unit-cost", "Unit Cost"], ["col:total", "Total"]],
    kpis: [["kpi-flights", "Flights"], ["kpi-item-lines", "Item Lines"], ["kpi-total-value", "Total Value"]],
  },
  "/airline-equipments-overview": {
    columns: [["col:return-num", "Return #"], ["col:flight", "Flight"], ["col:asset", "Asset"], ["col:returned-by", "Returned By"], ["col:date-time", "Date / Time"], ["col:condition", "Condition"]],
    kpis: [["kpi-total-equipment", "Total Equipment"], ["kpi-in-service", "In Service"], ["kpi-in-maintenance", "In Maintenance"], ["kpi-damaged", "Damaged"], ["kpi-service-due-30d", "Service Due ≤30d"], ["kpi-open-damage", "Open Damage"], ["kpi-damaged-returns", "Damaged Returns"], ["kpi-retired", "Retired"]],
    sections: [["section-equipment-mix-by-status", "Equipment Mix by Status"], ["section-assets-by-category", "Assets by Category"], ["section-recent-equipment-returns", "Recent Equipment Returns"]],
  },
  "/airline-equipments": {
    columns: [["col:sl", "SL"], ["col:asset-id", "Asset ID"], ["col:name", "Name"], ["col:category", "Category"], ["col:serial", "Serial"], ["col:rfid-tag", "RFID Tag"], ["col:location", "Location"], ["col:next-maint", "Next Maint."], ["col:status", "Status"]],
    kpis: [["kpi-total-assets", "Total Assets"], ["kpi-in-service", "In Service"], ["kpi-maintenance-due-30d", "Maintenance Due (30d)"], ["kpi-damaged", "Damaged"]],
    actions: [["action-register-asset", "Register Asset"], ["action-save", "Save"]],
    fields: [["field-name", "Name"], ["field-category", "Category"], ["field-status", "Status"], ["field-serial-no", "Serial No."], ["field-rfid-tag", "RFID Tag"], ["field-current-location", "Current Location"], ["field-last-maintenance", "Last Maintenance"], ["field-next-maintenance", "Next Maintenance"]],
    sections: [["section-register-equipment-asset", "Register Equipment Asset"]],
  },
  "/equipment-maintenance": {
    columns: [["col:asset", "Asset"], ["col:category", "Category"], ["col:location", "Location"], ["col:last-maint", "Last Maint."], ["col:next-maint", "Next Maint."], ["col:days", "Days"], ["col:log-id", "Log ID"], ["col:service-date", "Service Date"], ["col:work-type", "Work Type"], ["col:performed-by", "Performed By"], ["col:next-due", "Next Due"], ["col:notes", "Notes"]],
    kpis: [["kpi-overdue", "Overdue"], ["kpi-due-in-30d", "Due in 30d"], ["kpi-all-caught-up", "All Caught Up"]],
    actions: [["action-log-maintenance", "Log Maintenance"], ["action-save-log", "Save Log"]],
    fields: [["field-asset", "Asset"], ["field-service-date", "Service Date"], ["field-next-maintenance", "Next Maintenance"], ["field-work-type", "Work Type"], ["field-performed-by", "Performed By"], ["field-notes", "Notes"]],
    sections: [["section-recent-maintenance-logs", "Recent Maintenance Logs"], ["section-log-maintenance-event", "Log Maintenance Event"]],
  },
  "/equipment-returns": {
    columns: [["col:sl", "SL"], ["col:return-id", "Return ID"], ["col:date", "Date"], ["col:flight", "Flight"], ["col:asset", "Asset"], ["col:returned-by", "Returned By"], ["col:condition", "Condition"], ["col:remarks", "Remarks"]],
    kpis: [["kpi-total-returns", "Total Returns"], ["kpi-good-condition", "Good Condition"], ["kpi-minor-issues", "Minor Issues"], ["kpi-damaged", "Damaged"]],
    actions: [["action-log-return", "Log Return"], ["action-save-return", "Save Return"]],
    fields: [["field-date-time", "Date / Time"], ["field-flight", "Flight #"], ["field-asset", "Asset"], ["field-condition", "Condition"], ["field-returned-by", "Returned By"], ["field-remarks", "Remarks"]],
    sections: [["section-log-equipment-return", "Log Equipment Return"]],
  },
  "/equipment-damage": {
    columns: [["col:sl", "SL"], ["col:report-id", "Report ID"], ["col:date", "Date"], ["col:asset", "Asset"], ["col:severity", "Severity"], ["col:reported-by", "Reported By"], ["col:description", "Description"], ["col:status", "Status"]],
    kpis: [["kpi-total-reports", "Total Reports"], ["kpi-open", "Open"], ["kpi-under-repair", "Under Repair"], ["kpi-repaired", "Repaired"]],
    actions: [["action-file-report", "File Report"], ["action-save-report", "Save Report"]],
    fields: [["field-date", "Date"], ["field-severity", "Severity"], ["field-asset", "Asset"], ["field-status", "Status"], ["field-reported-by", "Reported By"], ["field-damage-description", "Damage Description"]],
    sections: [["section-file-damage-report", "File Damage Report"]],
  },
  "/maintenance-overview": {
    columns: [["col:asset", "Asset"], ["col:type", "Type"], ["col:location", "Location"], ["col:last-service", "Last Service"], ["col:next-service", "Next Service"], ["col:days", "Days"], ["col:status", "Status"]],
    kpis: [["kpi-total-assets", "Total Assets"], ["kpi-operational", "Operational"], ["kpi-service-due", "Service Due"], ["kpi-in-maintenance", "In Maintenance"], ["kpi-due-in-30-days", "Due in 30 days"], ["kpi-overdue", "Overdue"], ["kpi-utilisation", "Utilisation"], ["kpi-asset-types", "Asset Types"]],
    sections: [["section-asset-inventory-by-type", "Asset Inventory by Type"], ["section-status-distribution", "Status Distribution"], ["section-upcoming-maintenance-schedule", "Upcoming Maintenance Schedule"]],
  },
  "/maintenance": {
    columns: [["col:id", "Asset #"], ["col:name", "Name"], ["col:type", "Type"], ["col:location", "Location"], ["col:lastSvc", "Last Service"], ["col:nextSvc", "Next Service"], ["col:status", "Status"]],
    kpis: [["kpi-total-assets", "Total Assets"], ["kpi-operational", "Operational"], ["kpi-service-due", "Service Due"], ["kpi-in-maintenance", "In Maintenance"]],
    actions: [["action-new-ticket", "New Ticket"]],
  },
  "/reports": {
    actions: [["action-pdf", "PDF"], ["action-excel", "Excel"], ["action-csv", "CSV"]],
  },
  "/report-builder": {
    actions: [["action-all", "All"], ["action-none", "None"], ["action-generate-report", "Generate report"], ["action-add-filter", "Add filter"], ["action-csv", "CSV"], ["action-excel", "Excel"], ["action-pdf", "PDF"]],
    fields: [["field-dataset", "Dataset"], ["field-role-scopes-columns", "Role (scopes columns)"], ["field-columns", "Columns"]],
    sections: [["section-filters", "Filters"]],
  },
  "/users": {
    columns: [["col:id", "ID"], ["col:fullName", "User"], ["col:email", "Contact"], ["col:role", "Role"], ["col:location", "Location"], ["col:lastLogin", "Last Login"], ["col:status", "Status"]],
    kpis: [["kpi-total-users", "Total Users"], ["kpi-active", "Active"], ["kpi-admins", "Admins"]],
    actions: [["action-create-user", "Create User"], ["action-save", "Save"]],
    fields: [["field-user-id", "User ID"], ["field-username", "Username"], ["field-full-name", "Full Name"], ["field-email", "Email"], ["field-phone", "Phone"], ["field-role", "Role"], ["field-primary-location", "Primary Location"], ["field-active-on-creation", "Active on creation"], ["field-password", "Password"], ["field-confirm-password", "Confirm Password"]],
    sections: [["section-profile", "Profile"], ["section-access", "Access"], ["section-password", "Password"]],
  },
  "/audit": {
    columns: [["col:severity", "Severity flag"], ["col:at", "When"], ["col:user", "User"], ["col:module", "Module"], ["col:action", "Action"], ["col:target", "Target"], ["col:result", "Result"], ["col:ip", "Origin"]],
    kpis: [["kpi-events-today", "Events Today"], ["kpi-active-users", "Active Users"], ["kpi-critical-events", "Critical Events"], ["kpi-failed-actions", "Failed Actions"]],
    actions: [["action-reset", "Reset"]],
    fields: [["field-module", "Module"], ["field-action", "Action"], ["field-severity", "Severity"], ["field-from", "From"], ["field-to", "To"]],
  },
  "/approval-management": {
    columns: [["col:ref-title", "Ref / Title"], ["col:category", "Category"], ["col:requested-by", "Requested By"], ["col:date", "Date"], ["col:amount-items", "Amount / Items"], ["col:actions", "Actions"]],
    kpis: [["kpi-pending-approvals", "Pending Approvals"], ["kpi-approved-today", "Approved Today"], ["kpi-rejected-today", "Rejected Today"], ["kpi-value-pending", "Value Pending"]],
    actions: [["action-approve", "Approve"], ["action-reject", "Reject"], ["action-fulfill-from-store", "Fulfill From Store"], ["action-escalate-to-supply-chain", "Escalate To Supply Chain"], ["action-close", "Close"]],
    fields: [["field-reason", "Reason"], ["field-rejection-reason", "Rejection Reason"]],
    sections: [["section-recently-processed", "Recently Processed"]],
  },
  "/config-item": {
    columns: [["col:id", "ID"], ["col:code", "Code"], ["col:name", "Item Name"], ["col:itemType", "Type"], ["col:category", "Category"], ["col:uom", "UOM"], ["col:warehouseId", "Office / Warehouse"], ["col:binLocation", "Bin"], ["col:batchTracked", "Tracking"], ["col:allocationMethod", "Method"], ["col:status", "Status"]],
    kpis: [["kpi-total-items", "Total Items"], ["kpi-active", "Active"], ["kpi-inactive", "Inactive"], ["kpi-categories", "Categories"], ["kpi-sub-categories", "Sub Categories"]],
    actions: [["action-opening-stock", "Opening Stock"], ["action-bulk-upload", "Bulk Upload"], ["action-create-item", "Create Item"], ["action-save", "Save"]],
    fields: [["field-item-code", "Item Code"], ["field-item-name", "Item Name"], ["field-item-type", "Item Type"], ["field-category", "Category"], ["field-sub-category", "Sub Category"], ["field-minor-category", "Minor Category"], ["field-primary-uom", "Primary UOM"], ["field-reorder-level", "Reorder Level"], ["field-expiry-date", "Expiry Date"], ["field-stock-threshold", "Stock Threshold (%)"], ["field-office", "Office"], ["field-warehouse", "Warehouse"], ["field-bin-location", "Bin Location"], ["field-stock-tracking", "Stock Tracking"], ["field-allocation-method", "Allocation Method"]],
    sections: [["section-create-item", "Create Item"], ["section-alternative-uoms", "Alternative UOMs"], ["section-stock-storage", "Stock & Storage"]],
  },
  "/config-supplier": {
    columns: [["col:id", "ID"], ["col:code", "Code"], ["col:name", "Supplier Name"], ["col:category", "Category"], ["col:contactPerson", "Contact"], ["col:phone", "Phone"], ["col:status", "Status"]],
    kpis: [["kpi-total-suppliers", "Total Suppliers"], ["kpi-active", "Active"], ["kpi-inactive", "Inactive"]],
    actions: [["action-create-supplier", "Create Supplier"], ["action-save", "Save"]],
    fields: [["field-supplier-code", "Supplier Code"], ["field-supplier-name", "Supplier Name"], ["field-category", "Category"], ["field-tax-tin", "Tax / TIN"], ["field-contact-person", "Contact Person"], ["field-phone", "Phone"], ["field-email", "Email"], ["field-address", "Address"]],
    sections: [["section-create-supplier", "Create Supplier"]],
  },
  "/config-company": {
    actions: [["action-save-changes", "Save Changes"]],
    fields: [["field-legal-name", "Legal Name"], ["field-trade-name", "Trade Name"], ["field-registration-no", "Registration No."], ["field-bin", "BIN"], ["field-tax-tin", "Tax / TIN"], ["field-vat-id", "VAT ID"], ["field-email", "Email"], ["field-phone", "Phone"], ["field-website", "Website"], ["field-registered-address", "Registered Address"], ["field-base-currency", "Base Currency"], ["field-fiscal-year-start", "Fiscal Year Start (MM-DD)"], ["field-document-logo-text", "Document Logo Text"]],
    sections: [["section-legal-entity", "Legal Entity"], ["section-contact", "Contact"], ["section-financial-defaults", "Financial Defaults"]],
  },
  "/config-airline": {
    columns: [["col:id", "ID"], ["col:code", "Code"], ["col:iata", "IATA"], ["col:name", "Airline Name"], ["col:country", "Country"], ["col:status", "Status"]],
    kpis: [["kpi-total-airlines", "Total Airlines"], ["kpi-active", "Active"], ["kpi-inactive", "Inactive"]],
    actions: [["action-create-airline", "Create Airline"], ["action-save", "Save"]],
    fields: [["field-code", "Code"], ["field-iata-code", "IATA Code"], ["field-country", "Country"], ["field-airline-name", "Airline Name"]],
    sections: [["section-create-airline", "Create Airline"]],
  },
  "/config-office": {
    columns: [["col:id", "ID"], ["col:code", "Code"], ["col:name", "Office Name"], ["col:companyId", "Company"], ["col:city", "City"], ["col:manager", "Manager"], ["col:status", "Status"]],
    kpis: [["kpi-total-offices", "Total Offices"], ["kpi-active", "Active"], ["kpi-inactive", "Inactive"]],
    actions: [["action-create-office", "Create Office"], ["action-save", "Save"]],
    fields: [["field-code", "Code"], ["field-office-name", "Office Name"], ["field-company", "Company"], ["field-city", "City"], ["field-manager", "Manager"], ["field-phone", "Phone"], ["field-address", "Address"]],
    sections: [["section-create-office", "Create Office"]],
  },
  "/config-warehouse": {
    columns: [["col:id", "ID"], ["col:code", "Code"], ["col:name", "Warehouse Name"], ["col:type", "Type"], ["col:officeId", "Office"], ["col:city", "City"], ["col:manager", "Manager"], ["col:status", "Status"]],
    kpis: [["kpi-warehouses", "Warehouses"], ["kpi-cold-stores", "Cold Stores"], ["kpi-kitchens", "Kitchens"]],
    actions: [["action-create-warehouse", "Create Warehouse"], ["action-save", "Save"]],
    fields: [["field-code", "Code"], ["field-warehouse-name", "Warehouse Name"], ["field-office", "Office"], ["field-type", "Type"], ["field-city", "City"], ["field-manager", "Manager"], ["field-phone", "Phone"], ["field-address", "Address"]],
    sections: [["section-create-warehouse", "Create Warehouse"]],
  },
  "/config-price": {
    columns: [["col:id", "Price #"], ["col:itemCode", "Item Code"], ["col:item", "Item"], ["col:supplier", "Supplier"], ["col:unitPrice", "Unit Price"], ["col:effectiveFrom", "Effective"], ["col:status", "Status"]],
    kpis: [["kpi-total-prices", "Total Prices"], ["kpi-active", "Active"], ["kpi-scheduled", "Scheduled"]],
    actions: [["action-bulk-upload", "Bulk Upload"], ["action-create-price", "Create Price"], ["action-save", "Save"]],
    fields: [["field-item", "Item"], ["field-supplier", "Supplier"], ["field-unit-price", "Unit Price (BDT)"], ["field-effective-from", "Effective From"], ["field-effective-to", "Effective To"]],
    sections: [["section-create-price", "Create Price"]],
  },
  "/config-approval": {
    columns: [["col:id", "Workflow #"], ["col:module", "Module"], ["col:name", "Workflow Name"], ["col:stages", "Approval Chain"], ["col:active", "Status"]],
    actions: [["action-create-workflow", "Create Workflow"], ["action-save", "Save"], ["action-add-stage", "Add Stage"]],
    fields: [["field-module", "Module"], ["field-workflow-name", "Workflow Name"], ["field-approver-role", "Approver Role"], ["field-amount-limit", "Amount Limit (optional)"]],
    sections: [["section-workflow", "Workflow"], ["section-approval-stages", "Approval Stages"]],
  },
  "/config-meal-slots": {
    columns: [["col:hash", "#"], ["col:meal-name", "Meal Name"], ["col:start-hour", "Start Hour"], ["col:end-hour", "End Hour"], ["col:window", "Window"], ["col:actions", "Actions"]],
    actions: [["action-defaults", "Defaults"], ["action-add-meal", "Add Meal"], ["action-save", "Save"]],
    fields: [["field-meal-name", "Meal Name"], ["field-start-hour", "Start Hour"], ["field-end-hour", "End Hour"]],
  },
  "/config-production-basis": {
    columns: [["col:item", "Item"], ["col:basis", "Basis"], ["col:actions", "Actions"]],
    actions: [["action-reset", "Reset"], ["action-add-override", "Add Override"]],
    fields: [["field-default-basis", "Default basis"], ["field-item", "Item"], ["field-produce-by", "Produce by"]],
  },
  "/config-packaging": {
    fields: [["field-print-scan", "Label print & scan"]],
  },
  "/operational-report": {
    kpis: [["kpi:flights", "Flights"], ["kpi:in-pipeline", "In Pipeline"], ["kpi:dispatched", "Dispatched"], ["kpi:departed", "Departed / Completed"]],
    columns: [["col:flight", "Flight"], ["col:sector", "Sector"], ["col:date-etd", "Date · ETD"], ["col:load", "Load"], ["col:lifecycle", "Lifecycle"], ["col:status", "Status"], ["col:view", "View"]],
    fields: [["field-search", "Search"], ["field-date-from", "From"], ["field-date-to", "To"], ["field-flight-type", "Flight Type"], ["field-airline", "Airline"], ["field-status", "Status"]],
    actions: [["action-view-lifecycle", "View Lifecycle"]],
  },
};

const KIND_ORDER: { key: keyof Group; kind: ElementKind }[] = [
  { key: "kpis", kind: "kpi" },
  { key: "columns", kind: "column" },
  { key: "fields", kind: "field" },
  { key: "actions", kind: "action" },
  { key: "sections", kind: "section" },
];

/** route → flat element list, derived from SRC and tagged with its kind. */
export const PAGE_CONTENT_CATALOG: Record<string, RbacElement[]> = Object.fromEntries(
  Object.entries(SRC).map(([route, group]) => {
    const els: RbacElement[] = [];
    for (const { key, kind } of KIND_ORDER) {
      for (const [id, label] of group[key] ?? []) els.push({ id, label, kind });
    }
    return [route, els];
  }),
);
