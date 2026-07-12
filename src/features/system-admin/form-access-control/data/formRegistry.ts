import type { FormDefinition } from "../types/formAccessControl.types";

// Illustrative form registry — a handful of catering business forms, each
// with its own field catalog. `locked` fields can never be hidden or
// un-mandated by an admin (see business rule #2 in the FAC design doc).
export const FORMS: FormDefinition[] = [
  {
    key: "item-profile",
    name: "Item Profile",
    description: "Master data form for raw material, packaging and finished goods items.",
    fields: [
      { key: "itemCode", label: "Item Code", defaultVisible: true, defaultMandatory: true, locked: true },
      { key: "itemName", label: "Item Name", defaultVisible: true, defaultMandatory: true, locked: true },
      { key: "category", label: "Category", defaultVisible: true, defaultMandatory: true },
      { key: "uom", label: "Unit of Measure", defaultVisible: true, defaultMandatory: true },
      { key: "hsnCode", label: "HSN Code", defaultVisible: true, defaultMandatory: false },
      { key: "shelfLifeDays", label: "Shelf Life (days)", defaultVisible: true, defaultMandatory: false },
      { key: "storageCondition", label: "Storage Condition", defaultVisible: true, defaultMandatory: false },
      { key: "reorderLevel", label: "Reorder Level", defaultVisible: false, defaultMandatory: false },
      { key: "remarks", label: "Remarks", defaultVisible: false, defaultMandatory: false },
    ],
  },
  {
    key: "supplier-profile",
    name: "Supplier Profile",
    description: "Onboarding and master data form for approved suppliers.",
    fields: [
      { key: "supplierCode", label: "Supplier Code", defaultVisible: true, defaultMandatory: true, locked: true },
      { key: "supplierName", label: "Supplier Name", defaultVisible: true, defaultMandatory: true, locked: true },
      { key: "contactPerson", label: "Contact Person", defaultVisible: true, defaultMandatory: true },
      { key: "phone", label: "Phone", defaultVisible: true, defaultMandatory: true },
      { key: "email", label: "Email", defaultVisible: true, defaultMandatory: false },
      { key: "tradeLicenseNo", label: "Trade License No.", defaultVisible: true, defaultMandatory: false },
      { key: "tinNo", label: "TIN No.", defaultVisible: true, defaultMandatory: false },
      { key: "bankDetails", label: "Bank Details", defaultVisible: false, defaultMandatory: false },
      { key: "rating", label: "Supplier Rating", defaultVisible: false, defaultMandatory: false },
    ],
  },
  {
    key: "purchase-requisition",
    name: "Purchase Requisition",
    description: "Internal request form to raise a purchase requisition for items.",
    fields: [
      { key: "prNo", label: "PR No.", defaultVisible: true, defaultMandatory: true, locked: true },
      { key: "requestedBy", label: "Requested By", defaultVisible: true, defaultMandatory: true, locked: true },
      { key: "department", label: "Department", defaultVisible: true, defaultMandatory: true },
      { key: "requiredDate", label: "Required Date", defaultVisible: true, defaultMandatory: true },
      { key: "priority", label: "Priority", defaultVisible: true, defaultMandatory: false },
      { key: "budgetCode", label: "Budget Code", defaultVisible: true, defaultMandatory: false },
      { key: "justification", label: "Justification", defaultVisible: true, defaultMandatory: false },
      { key: "preferredSupplier", label: "Preferred Supplier", defaultVisible: false, defaultMandatory: false },
      { key: "attachment", label: "Attachment", defaultVisible: false, defaultMandatory: false },
    ],
  },
  {
    key: "grn",
    name: "Goods Received Note",
    description: "Warehouse form recording receipt of goods against a purchase order.",
    fields: [
      { key: "grnNo", label: "GRN No.", defaultVisible: true, defaultMandatory: true, locked: true },
      { key: "poRef", label: "PO Ref", defaultVisible: true, defaultMandatory: true, locked: true },
      { key: "receivedDate", label: "Received Date", defaultVisible: true, defaultMandatory: true },
      { key: "receivedBy", label: "Received By", defaultVisible: true, defaultMandatory: true },
      { key: "qualityCheck", label: "Quality Check", defaultVisible: true, defaultMandatory: false },
      { key: "batchNo", label: "Batch No.", defaultVisible: true, defaultMandatory: false },
      { key: "expiryDate", label: "Expiry Date", defaultVisible: true, defaultMandatory: false },
      { key: "rejectionReason", label: "Rejection Reason", defaultVisible: false, defaultMandatory: false },
      { key: "warehouseNote", label: "Warehouse Note", defaultVisible: false, defaultMandatory: false },
    ],
  },
  {
    key: "meal-production-request",
    name: "Meal Production Request",
    description: "Kitchen-facing form to request production for an upcoming meal count.",
    fields: [
      { key: "flightNo", label: "Flight No.", defaultVisible: true, defaultMandatory: true, locked: true },
      { key: "mealDate", label: "Meal Date", defaultVisible: true, defaultMandatory: true, locked: true },
      { key: "mealSlot", label: "Meal Slot", defaultVisible: true, defaultMandatory: true },
      { key: "paxCount", label: "Pax Count", defaultVisible: true, defaultMandatory: true },
      { key: "specialMealCount", label: "Special Meal Count", defaultVisible: true, defaultMandatory: false },
      { key: "menuCode", label: "Menu Code", defaultVisible: true, defaultMandatory: false },
      { key: "packagingNote", label: "Packaging Note", defaultVisible: false, defaultMandatory: false },
      { key: "remarks", label: "Remarks", defaultVisible: false, defaultMandatory: false },
    ],
  },
];
