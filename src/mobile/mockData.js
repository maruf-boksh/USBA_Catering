// Mock data for the mobile mini-app.
// Numbers match the web dashboard: 33 flights, 140 meals, 1 delayed/174 pax,
// 1 QC open / 3 resolved, 3 pending POs, 3 inventory alerts, 1 active dispatch, stock 338.2L.

export const MOCK_KPIS = {
  totalFlights:     33,
  totalMeals:       140,
  delayedFlights:   1,
  delayedPax:       174,
  qcOpenIssues:     1,
  qcResolvedToday:  3,
  pendingPOs:       3,
  inventoryAlerts:  3,
  activeDispatches: 1,
  stockValueLakhs:  '338.2',
  pendingApprovals: 3,
  onTimeRate:       97,
};

export const MOCK_FLIGHTS = [
  { id: 'BS401', airline: 'US-Bangla Airlines', route: 'DAC → DXB', departure: '06:30', status: 'boarding',   pax: 180, meals: 198, sector: 'International' },
  { id: 'BS202', airline: 'US-Bangla Airlines', route: 'DAC → KUL', departure: '08:15', status: 'scheduled',  pax: 160, meals: 176, sector: 'International' },
  { id: 'BS105', airline: 'US-Bangla Airlines', route: 'DAC → LHR', departure: '09:45', status: 'delayed',    pax: 174, meals: 191, sector: 'International' },
  { id: 'BS310', airline: 'US-Bangla Airlines', route: 'DAC → CGP', departure: '10:30', status: 'scheduled',  pax: 72,  meals: 79,  sector: 'Domestic' },
  { id: 'BS207', airline: 'US-Bangla Airlines', route: 'DAC → CXB', departure: '11:00', status: 'scheduled',  pax: 68,  meals: 74,  sector: 'Domestic' },
  { id: 'BS415', airline: 'US-Bangla Airlines', route: 'DAC → JSR', departure: '12:15', status: 'scheduled',  pax: 64,  meals: 70,  sector: 'Domestic' },
];

export const MOCK_ORDERS = [
  { id: 'ORD-2024-0891', flight: 'BS401', airline: 'US-Bangla Airlines', route: 'DAC → DXB', departure: '06:30', pax: 180, mealType: 'Economy Breakfast', status: 'confirmed', sector: 'International' },
  { id: 'ORD-2024-0892', flight: 'BS202', airline: 'US-Bangla Airlines', route: 'DAC → KUL', departure: '08:15', pax: 160, mealType: 'Economy Lunch',     status: 'confirmed', sector: 'International' },
  { id: 'ORD-2024-0893', flight: 'BS105', airline: 'US-Bangla Airlines', route: 'DAC → LHR', departure: '09:45', pax: 174, mealType: 'Business Dinner',   status: 'pending',   sector: 'International' },
  { id: 'ORD-2024-0894', flight: 'BS310', airline: 'US-Bangla Airlines', route: 'DAC → CGP', departure: '10:30', pax: 72,  mealType: 'Economy Snack',     status: 'confirmed', sector: 'Domestic' },
  { id: 'ORD-2024-0895', flight: 'BS207', airline: 'US-Bangla Airlines', route: 'DAC → CXB', departure: '11:00', pax: 68,  mealType: 'Economy Breakfast', status: 'draft',     sector: 'Domestic' },
];

export const MOCK_MEAL_PLANS = [
  { id: 'MP-001', slot: 'Breakfast', type: 'Economy',  items: ['Paratha Roll', 'Fruit Cup', 'Orange Juice', 'Butter Packet'], calories: 420, allergens: ['Gluten', 'Dairy'] },
  { id: 'MP-002', slot: 'Lunch',     type: 'Economy',  items: ['Chicken Biryani', 'Dal', 'Raita', 'Water'],                  calories: 680, allergens: ['Dairy'] },
  { id: 'MP-003', slot: 'Dinner',    type: 'Business', items: ['Prawn Starter', 'Beef Steak', 'Cheesecake', 'Wine'],          calories: 920, allergens: ['Shellfish', 'Dairy', 'Gluten'] },
  { id: 'MP-004', slot: 'Snack',     type: 'Economy',  items: ['Sandwich', 'Chips', 'Juice Box'],                             calories: 310, allergens: ['Gluten'] },
];

export const MOCK_PRODUCTION_ORDERS = [
  { id: 'PO-0234', item: 'Economy Breakfast Box', qty: 198, produced: 198, section: 'Cold Kitchen', status: 'completed',    flight: 'BS401', dueBy: '05:45' },
  { id: 'PO-0235', item: 'Economy Lunch Tray',    qty: 176, produced: 140, section: 'Hot Kitchen',  status: 'in-progress', flight: 'BS202', dueBy: '07:30' },
  { id: 'PO-0236', item: 'Business Dinner Set',   qty: 191, produced: 0,   section: 'Hot Kitchen',  status: 'pending',     flight: 'BS105', dueBy: '09:00' },
  { id: 'PO-0237', item: 'Economy Snack Pack',    qty: 79,  produced: 0,   section: 'Bakery',       status: 'pending',     flight: 'BS310', dueBy: '10:00' },
];

// Full "View" detail per production order — mirrors the web production-entry
// View (Production Information, Output, Material Requirements, Cost/COGS).
// Keyed by order id. Material qty is the total requirement for the order.
export const MOCK_PRODUCTION_DETAILS = {
  'PO-0234': {
    date: '2026-07-13', office: 'Head Office Dhaka', warehouse: 'Cold Kitchen',
    bom: 'Economy Breakfast Box', outputCode: 'FG-BFB-01',
    raw: [
      { code: 'RM-2050', name: 'Croissant',      uom: 'pcs',     qty: 198, rate: 12 },
      { code: 'RM-2051', name: 'Scrambled Egg',  uom: 'portion', qty: 198, rate: 15 },
      { code: 'RM-2052', name: 'Yogurt Cup',     uom: 'pcs',     qty: 198, rate: 18 },
      { code: 'RM-2053', name: 'Orange Juice',   uom: 'pcs',     qty: 198, rate: 10 },
    ],
    pkg: [
      { code: 'PK-1010', name: 'Meal Box (Economy)', uom: 'pcs', qty: 198, rate: 8 },
      { code: 'PK-1011', name: 'Cutlery Set',        uom: 'set', qty: 198, rate: 5 },
    ],
  },
  'PO-0235': {
    date: '2026-07-13', office: 'Head Office Dhaka', warehouse: 'Hot Kitchen',
    bom: 'Economy Lunch Tray', outputCode: 'FG-LNT-01',
    raw: [
      { code: 'RM-3010', name: 'Steamed Rice',    uom: 'portion', qty: 176, rate: 10 },
      { code: 'RM-3011', name: 'Grilled Chicken', uom: 'portion', qty: 176, rate: 45 },
      { code: 'RM-3012', name: 'Mixed Vegetables',uom: 'portion', qty: 176, rate: 12 },
      { code: 'RM-3013', name: 'Gravy',           uom: 'portion', qty: 176, rate: 8 },
    ],
    pkg: [
      { code: 'PK-1020', name: 'Meal Tray', uom: 'pcs', qty: 176, rate: 9 },
      { code: 'PK-1021', name: 'Foil Lid',  uom: 'pcs', qty: 176, rate: 4 },
    ],
  },
  'PO-0236': {
    date: '2026-07-13', office: 'Head Office Dhaka', warehouse: 'Hot Kitchen',
    bom: 'Business Dinner Set', outputCode: 'FG-BDS-01',
    raw: [
      { code: 'RM-4010', name: 'Basmati Rice',   uom: 'portion', qty: 191, rate: 14 },
      { code: 'RM-4011', name: 'Beef Steak',     uom: 'portion', qty: 191, rate: 85 },
      { code: 'RM-4012', name: 'Roasted Potato', uom: 'portion', qty: 191, rate: 15 },
      { code: 'RM-4013', name: 'Dinner Roll',    uom: 'pcs',     qty: 191, rate: 6 },
    ],
    pkg: [
      { code: 'PK-1030', name: 'Business Casserole', uom: 'pcs', qty: 191, rate: 22 },
      { code: 'PK-1031', name: 'Cutlery Kit',        uom: 'kit', qty: 191, rate: 10 },
    ],
  },
  'PO-0237': {
    date: '2026-07-13', office: 'Head Office Dhaka', warehouse: 'Bakery',
    bom: 'Economy Snack Pack', outputCode: 'FG-SNK-01',
    raw: [
      { code: 'RM-5010', name: 'Sandwich',  uom: 'pcs', qty: 79, rate: 20 },
      { code: 'RM-5011', name: 'Cookie',    uom: 'pcs', qty: 79, rate: 8 },
      { code: 'RM-5012', name: 'Juice Box', uom: 'pcs', qty: 79, rate: 10 },
    ],
    pkg: [
      { code: 'PK-1040', name: 'Snack Box', uom: 'pcs', qty: 79, rate: 6 },
      { code: 'PK-1041', name: 'Napkin',    uom: 'pcs', qty: 79, rate: 2 },
    ],
  },
};

export const MOCK_QC_CHECKS = [
  { id: 'QC-001', item: 'Economy Breakfast Box', flight: 'BS401', result: 'pass', temp: '4°C', checkedBy: 'Khalid H.',  time: '05:45',
    batchItems: [
      { name: 'Croissant',     standardTemp: '≥65°C', recordedTemp: '68°C' },
      { name: 'Scrambled Egg', standardTemp: '≥70°C', recordedTemp: '74°C' },
      { name: 'Yogurt',        standardTemp: '≤7°C',  recordedTemp: '4°C'  },
      { name: 'Orange Juice',  standardTemp: '≤7°C',  recordedTemp: '4°C'  },
    ],
  },
  { id: 'QC-002', item: 'Economy Lunch Tray', flight: 'BS202', result: 'open', temp: '8°C', checkedBy: 'Rashida B.', time: '07:20', issue: 'Temperature above 7°C threshold',
    batchItems: [
      { name: 'Rice',       standardTemp: '≤7°C', recordedTemp: '8°C' },
      { name: 'Chicken',    standardTemp: '≤7°C', recordedTemp: '8°C' },
      { name: 'Vegetables', standardTemp: '≤7°C', recordedTemp: '8°C' },
      { name: 'Firni',      standardTemp: '≤7°C', recordedTemp: '8°C' },
    ],
  },
  { id: 'QC-003', item: 'Business Dinner Set', flight: 'BS105', result: 'pass', temp: '3°C', checkedBy: 'Khalid H.',  time: '08:10',
    batchItems: [
      { name: 'Rice',             standardTemp: '≤7°C', recordedTemp: '3°C' },
      { name: 'Beef Steak',       standardTemp: '≤7°C', recordedTemp: '3°C' },
      { name: 'Garden Salad',     standardTemp: '≤7°C', recordedTemp: '3°C' },
      { name: 'Chocolate Mousse', standardTemp: '≤7°C', recordedTemp: '3°C' },
    ],
  },
  { id: 'QC-004', item: 'Economy Snack Pack', flight: 'BS310', result: 'pass', temp: '5°C', checkedBy: 'Rashida B.', time: '09:00',
    batchItems: [
      { name: 'Sandwich',    standardTemp: '≤7°C', recordedTemp: '5°C' },
      { name: 'Fruit Cup',   standardTemp: '≤7°C', recordedTemp: '5°C' },
      { name: 'Cookie',      standardTemp: '≤7°C', recordedTemp: '5°C' },
      { name: 'Apple Juice', standardTemp: '≤7°C', recordedTemp: '5°C' },
    ],
  },
];

export const MOCK_HYGIENE_SLOTS = [
  {
    id: 'H1', label: 'Morning Setup',   time: '05:00–06:00', completed: true,
    checks: ['Work surfaces sanitised', 'Equipment temperature checked', 'Staff PPE verified', 'Temperature log completed', 'Pest check done'],
  },
  {
    id: 'H2', label: 'Pre-Lunch Check', time: '10:00–11:00', completed: true,
    checks: ['Work surfaces sanitised', 'Equipment temperature checked', 'Staff PPE verified', 'Temperature log completed', 'Pest check done'],
  },
  {
    id: 'H3', label: 'Post-Lunch',      time: '14:00–15:00', completed: false,
    checks: ['Work surfaces sanitised', 'Equipment temperature checked', 'Staff PPE verified', 'Temperature log completed', 'Pest check done'],
  },
  {
    id: 'H4', label: 'Evening Wrap',    time: '19:00–20:00', completed: false,
    checks: ['Work surfaces sanitised', 'Equipment temperature checked', 'Staff PPE verified', 'Temperature log completed', 'Pest check done'],
  },
];

export const MOCK_COOKING_TEMPS = [
  { id: 'CT-001', item: 'Chicken Korma',     target: '≥75°C', actual: '82°C', status: 'pass', time: '06:15', chef: 'Ahmed R.' },
  { id: 'CT-002', item: 'Vegetable Biryani', target: '≥75°C', actual: '78°C', status: 'pass', time: '06:40', chef: 'Ahmed R.' },
  { id: 'CT-003', item: 'Beef Steak',        target: '≥63°C', actual: '61°C', status: 'fail', time: '07:00', chef: 'Nusrat K.' },
  { id: 'CT-004', item: 'Prawn Malai Curry', target: '≥75°C', actual: '80°C', status: 'pass', time: '07:30', chef: 'Ahmed R.' },
];

export const MOCK_DISPATCHES = [
  {
    id: 'DSP-0091', flight: 'BS401', route: 'DAC → DXB', departure: '06:30', items: 198,
    status: 'dispatched', approvalStage: 4,
    vehicleNo: 'HiLoader-01', vehicleClean: 'Yes',
    chilledTemp: '3.2°C', frozenTemp: '-10.5°C',
    vehicleTempBegin: '4.1°C', vehicleTempEnd: '4.5°C',
    resultSatisfy: 'Yes', packagingDate: '2026-06-11',
    loadStart: '05:20', loadEnd: '05:45',
    dispatchedAt: '05:50', driver: 'Rajan M.',
  },
  {
    id: 'DSP-0092', flight: 'BS202', route: 'DAC → KUL', departure: '08:15', items: 140,
    status: 'loading', approvalStage: 2,
    vehicleNo: 'HiLoader-02', vehicleClean: 'Yes',
    chilledTemp: '3.8°C', frozenTemp: '-9.8°C',
    vehicleTempBegin: '5.2°C', vehicleTempEnd: null,
    resultSatisfy: 'Yes', packagingDate: '2026-06-11',
    loadStart: '07:10', loadEnd: null,
    dispatchedAt: null, driver: 'Tamim A.',
  },
  {
    id: 'DSP-0093', flight: 'BS105', route: 'DAC → LHR', departure: '09:45', items: 0,
    status: 'pending', approvalStage: 0,
    vehicleNo: null, vehicleClean: null,
    chilledTemp: null, frozenTemp: null,
    vehicleTempBegin: null, vehicleTempEnd: null,
    resultSatisfy: null, packagingDate: '2026-06-11',
    loadStart: null, loadEnd: null,
    dispatchedAt: null, driver: null,
  },
];

export const MOCK_APPROVALS = [
  // ── Existing (kept as-is) ─────────────────────────────────────────────────
  { id: 'APR-001', type: 'Purchase Order',   ref: 'PO-2024-0156',  amount: '৳ 45,200',   requestedBy: 'Store Manager',      date: '2024-11-20', status: 'pending', module: 'supply-chain' },
  { id: 'APR-002', type: 'Payment Approval', ref: 'INV-2024-0089', amount: '৳ 1,28,500', requestedBy: 'Finance Officer',    date: '2024-11-20', status: 'pending', module: 'accounts' },
  { id: 'APR-003', type: 'Demand Request',   ref: 'DMD-2024-0234', amount: null,          requestedBy: 'Kitchen Supervisor', date: '2024-11-19', status: 'pending', module: 'inventory' },
  // ── Brought over from web Approval Management (Administration → all categories) ──
  { id: 'APR-004', type: 'Flight Orders',            ref: 'ORD-9101',        amount: null,          requestedBy: 'Ops Officer',        date: '2024-11-20', status: 'pending', module: 'orders' },
  { id: 'APR-005', type: 'Crew Orders',              ref: 'CRW-2024-014',    amount: null,          requestedBy: 'Crew Scheduler',     date: '2024-11-20', status: 'pending', module: 'orders' },
  { id: 'APR-006', type: 'Request for Quotation',    ref: 'RFQ-2024-021',    amount: null,          requestedBy: 'Procurement',        date: '2024-11-19', status: 'pending', module: 'procurement' },
  { id: 'APR-007', type: 'Quotation',                ref: 'QT-2024-033',     amount: '৳ 2,10,000', requestedBy: 'Procurement',        date: '2024-11-19', status: 'pending', module: 'procurement' },
  { id: 'APR-008', type: 'Purchase Requisition',     ref: 'PR-2024-007',     amount: '৳ 2,45,000', requestedBy: 'S. Ahmed',           date: '2024-11-19', status: 'pending', module: 'procurement' },
  { id: 'APR-009', type: 'Goods Receipt',            ref: 'GRN-2024-118',    amount: null,          requestedBy: 'S. Ahmed',           date: '2024-11-19', status: 'pending', module: 'procurement' },
  { id: 'APR-010', type: 'Transfer Request',         ref: 'TR-7001',         amount: null,          requestedBy: 'S. Ahmed',           date: '2024-11-19', status: 'pending', module: 'inventory' },
  { id: 'APR-011', type: 'Stock Adjustment',         ref: 'ADJ-2024-045',    amount: null,          requestedBy: 'Store Manager',      date: '2024-11-18', status: 'pending', module: 'inventory' },
  { id: 'APR-012', type: 'Production Order',         ref: 'PRO-2024-000045', amount: null,          requestedBy: 'Production Lead',    date: '2024-11-18', status: 'pending', module: 'production' },
  { id: 'APR-013', type: 'Bill of Materials',        ref: 'BOM-007',         amount: null,          requestedBy: 'S. Ahmed',           date: '2024-11-18', status: 'pending', module: 'production' },
  { id: 'APR-014', type: 'User Account',             ref: 'USR-008',         amount: null,          requestedBy: 'HR Team',            date: '2024-11-19', status: 'pending', module: 'administration' },
  { id: 'APR-015', type: 'Dispatch',                 ref: 'DSP-0001',        amount: null,          requestedBy: 'Dispatch Officer',   date: '2024-11-20', status: 'pending', module: 'dispatch' },
  { id: 'APR-016', type: 'Maintenance',              ref: 'MNT-2024-012',    amount: '৳ 35,000',   requestedBy: 'Maintenance Dept',   date: '2024-11-18', status: 'pending', module: 'assets' },
  { id: 'APR-017', type: 'Return Items',             ref: 'RET-2024-030',    amount: null,          requestedBy: 'Cabin Crew',         date: '2024-11-19', status: 'pending', module: 'consumable-returns' },
  { id: 'APR-018', type: 'Purchase Return',          ref: 'PRET-2024-009',   amount: '৳ 12,400',   requestedBy: 'Store Manager',      date: '2024-11-18', status: 'pending', module: 'procurement' },
  { id: 'APR-019', type: 'Galley Loading',           ref: 'GL-BS105-001',    amount: null,          requestedBy: 'Galley Team',        date: '2024-11-20', status: 'pending', module: 'galley' },
  { id: 'APR-020', type: 'Personal Hygiene',         ref: 'PH-2024-051',     amount: null,          requestedBy: 'Hygiene Officer',    date: '2024-11-20', status: 'pending', module: 'food-safety' },
  { id: 'APR-021', type: 'Daily Hygiene Monitoring', ref: 'DHM-2024-014',    amount: null,          requestedBy: 'Food Safety Team',   date: '2024-11-20', status: 'pending', module: 'food-safety' },
  { id: 'APR-022', type: 'Damaged Product Disposal', ref: 'WST-2024-022',    amount: '৳ 8,600',    requestedBy: 'Kitchen Supervisor', date: '2024-11-19', status: 'pending', module: 'wastage' },
  { id: 'APR-023', type: 'Delay Refreshment',        ref: 'DLY-2024-006',    amount: null,          requestedBy: 'Flight Ops',         date: '2024-11-19', status: 'pending', module: 'operations' },
  { id: 'APR-024', type: 'Last-Minute Change',       ref: 'LMC-2024-018',    amount: null,          requestedBy: 'Ops Officer',        date: '2024-11-20', status: 'pending', module: 'operations' },
];

// Full document data revealed when an approval's ID is tapped — mirrors the
// web Approval Management detail view (header fields + line items / sub-fields).
// Keyed by the approval's ref id. Existing PO-/INV-/DMD- refs are resolved by
// their own resolvers in ApprovalsScreen and are intentionally not repeated.
export const MOCK_APPROVAL_DOCS = {
  // ── Previous cards — now unified to the web "View" detail format ───────────
  'PO-2024-0156': {
    docType: 'Purchase Order', status: 'pending',
    sections: [
      { title: 'Order Details', rows: [['PO Number', 'PO-2024-0156'], ['Category', 'Purchase Order'], ['Vendor', 'Fresh Foods Ltd'], ['Requested By', 'Store Manager'], ['Date', '2024-11-20'], ['Amount', '৳ 45,200'], ['Items', '4 items'], ['Status', 'Pending']] },
      { title: 'Summary', rows: [['Order', 'Fresh Foods Ltd — 4 line items']] },
      { title: 'Line Items', rows: [['Tomato', '200 Kg — ৳ 60/Kg'], ['Onion', '150 Kg — ৳ 70/Kg'], ['Potato', '300 Kg — ৳ 40/Kg'], ['Spice Mix', '20 Kg — ৳ 300/Kg']] },
      { title: 'Delivery Info', rows: [['Deliver To', 'US-Bangla Catering — Main Kitchen'], ['Expected', 'Within 2 business days'], ['Contact', 'Store Manager']] },
    ],
  },
  'INV-2024-0089': {
    docType: 'Payment Approval', status: 'pending',
    sections: [
      { title: 'Invoice Details', rows: [['Invoice No.', 'INV-2024-0089'], ['Category', 'Payment Approval'], ['Issued By', 'Continental Aviation Services'], ['Requested By', 'Finance Officer'], ['Date', '2024-11-20'], ['Due Date', '2024-12-20'], ['Amount', '৳ 1,28,500'], ['Status', 'Pending']] },
      { title: 'Charges Breakdown', rows: [['Catering Service', '৳ 85,000'], ['Cold Chain Logistics', '৳ 22,500'], ['Special Meal Prep', '৳ 21,000'], ['Total Due', '৳ 1,28,500']] },
      { title: 'Bank Details', rows: [['Bank', 'Dutch-Bangla Bank Ltd.'], ['Account No.', '207.110.22836'], ['Branch', 'Tejgaon, Dhaka'], ['Routing No.', '090261450']] },
    ],
  },
  'DMD-2024-0234': {
    docType: 'Demand Request', status: 'pending',
    sections: [
      { title: 'Request Details', rows: [['Request No.', 'DMD-2024-0234'], ['Category', 'Demand Request'], ['Item', 'Chicken (Fresh)'], ['Quantity', '50 kg'], ['Requested By', 'Kitchen Supervisor'], ['Date', '2024-11-19'], ['Status', 'Pending']] },
      { title: 'Fulfillment Info', rows: [['Priority', 'Medium'], ['Source', 'Central Store / Local Purchase'], ['Required For', 'Flight Catering Operations'], ['Approved By', '—']] },
    ],
  },
  'ORD-9101': {
    docType: 'Flight Orders', status: 'pending',
    sections: [
      { title: 'Order Summary', rows: [['Order No.', 'ORD-9101'], ['Airline', 'US-Bangla'], ['Date', '2024-11-20'], ['Flights', '2 flights'], ['Total Pax', '328'], ['Status', 'Pending']] },
      { title: 'Flight Details', rows: [['BS-901', 'DAC → DXB · ETD 11:21 · 168 pax'], ['BS-902', 'DXB → DAC · ETD 12:21 · 160 pax']] },
      { title: 'Meal Summary', rows: [['Passenger Meals', '328'], ['Special Meals', '18'], ['Crew Meals', '12']] },
    ],
  },
  'CRW-2024-014': {
    docType: 'Crew Orders', status: 'pending',
    sections: [
      { title: 'Request Details', rows: [['Crew Order No.', 'CRW-2024-014'], ['Flight', 'BS-901 · DAC → DXB'], ['Requested By', 'Crew Scheduler'], ['Date', '2024-11-20'], ['Status', 'Pending']] },
      { title: 'Crew Meal Details', rows: [['Cockpit Crew', '2'], ['Cabin Crew', '6'], ['Meal Type', 'Crew Standard'], ['Special', 'Vegetarian × 1']] },
    ],
  },
  'RFQ-2024-021': {
    docType: 'Request for Quotation', status: 'pending',
    sections: [
      { title: 'RFQ Details', rows: [['RFQ No.', 'RFQ-2024-021'], ['Requested By', 'Procurement'], ['Date', '2024-11-19'], ['Vendors Invited', '4'], ['Status', 'Pending']] },
      { title: 'Items Requested', rows: [['Basmati Rice', '800 Kg'], ['Cooking Oil', '200 L'], ['Chicken Breast', '600 Kg']] },
      { title: 'Response Window', rows: [['Issued', '2024-11-19'], ['Closes', '2024-11-22'], ['Terms', 'Net 30']] },
    ],
  },
  'QT-2024-033': {
    docType: 'Quotation', status: 'pending',
    sections: [
      { title: 'Quotation Details', rows: [['Quotation No.', 'QT-2024-033'], ['Vendor', 'Fresh Foods Ltd'], ['Date', '2024-11-19'], ['Total Value', '৳ 2,10,000'], ['Validity', '15 days'], ['Status', 'Pending']] },
      { title: 'Line Items', rows: [['Tomato', '500 Kg — ৳ 60/Kg'], ['Onion', '300 Kg — ৳ 70/Kg'], ['Chicken Breast', '400 Kg — ৳ 320/Kg']] },
      { title: 'Terms', rows: [['Payment', 'Net 30'], ['Delivery', '2 business days'], ['Warranty', 'N/A']] },
    ],
  },
  'PR-2024-007': {
    docType: 'Purchase Requisition', status: 'pending',
    sections: [
      { title: 'Request Details', rows: [['Requisition No.', 'PR-2024-007'], ['Requested By', 'S. Ahmed'], ['Date', '2024-11-19'], ['Total Items', '4 line items'], ['Est. Value', '৳ 2,45,000'], ['Status', 'Pending']] },
      { title: 'Line Items', rows: [['Basmati Rice', '800 Kg'], ['Cooking Oil', '200 L'], ['Lentils (Masoor)', '150 Kg'], ['Sugar', '100 Kg']] },
    ],
  },
  'GRN-2024-118': {
    docType: 'Goods Receipt', status: 'pending',
    sections: [
      { title: 'Receipt Details', rows: [['GRN No.', 'GRN-2024-118'], ['Against PO', 'PO-2024-0445'], ['Received By', 'S. Ahmed'], ['Date', '2024-11-19'], ['Lines', '9 of 10 accepted'], ['Status', 'Pending']] },
      { title: 'Line Items', rows: [['Basmati Rice', '800 Kg · Accepted'], ['Cooking Oil', '200 L · Accepted'], ['Chicken Breast', '600 Kg · Accepted'], ['Tomato', '480 Kg · Short 20 Kg'], ['Salmon Fillet', '60 Kg · On hold for QC']] },
    ],
  },
  'TR-7001': {
    docType: 'Transfer Request', status: 'pending',
    sections: [
      { title: 'Transfer Details', rows: [['Transfer No.', 'TR-7001'], ['From', 'Central Warehouse'], ['To', 'Hot Kitchen'], ['Requested By', 'S. Ahmed'], ['Date', '2024-11-19'], ['Status', 'Pending']] },
      { title: 'Line Items', rows: [['Basmati Rice', '200 Kg'], ['Cooking Oil', '50 L']] },
    ],
  },
  'ADJ-2024-045': {
    docType: 'Stock Adjustment', status: 'pending',
    sections: [
      { title: 'Adjustment Details', rows: [['Adjustment No.', 'ADJ-2024-045'], ['Warehouse', 'Central Warehouse'], ['Requested By', 'Store Manager'], ['Date', '2024-11-18'], ['Reason', 'Physical count variance'], ['Status', 'Pending']] },
      { title: 'Adjusted Items', rows: [['Disposable Gloves', '−4 boxes · Damaged'], ['Aluminium Foil', '+2 rolls · Recount'], ['Chicken (Fresh)', '−5 Kg · Spoilage']] },
    ],
  },
  'PRO-2024-000045': {
    docType: 'Production Order', status: 'pending',
    sections: [
      { title: 'Production Details', rows: [['Order No.', 'PRO-2024-000045'], ['Production Item', 'Grilled Chicken'], ['BOM', 'Grilled Chicken'], ['Order Qty', '270'], ['Kitchen', 'Hot Kitchen'], ['Status', 'Pending']] },
      { title: 'Schedule', rows: [['Office', 'Head Office Dhaka'], ['Date', '2024-11-18'], ['Produced Qty', '0'], ['Remaining', '270']] },
    ],
  },
  'BOM-007': {
    docType: 'Bill of Materials', status: 'pending',
    sections: [
      { title: 'BOM Details', rows: [['BOM No.', 'BOM-007'], ['Product', 'Vegetable Cutlet'], ['Version', 'v1.0 (Draft)'], ['Materials', '8'], ['Requested By', 'S. Ahmed'], ['Status', 'Pending']] },
      { title: 'Materials (per portion)', rows: [['Potato', '60 g'], ['Mixed Vegetables', '40 g'], ['Breadcrumbs', '15 g'], ['Spice Mix', '5 g'], ['Cooking Oil', '10 ml'], ['Corn Flour', '8 g'], ['Salt', '2 g'], ['Green Chili', '3 g']] },
    ],
  },
  'USR-008': {
    docType: 'User Account', status: 'pending',
    sections: [
      { title: 'Request Details', rows: [['Request No.', 'USR-008'], ['Requested By', 'HR Team'], ['Date', '2024-11-19'], ['Action', 'Create account'], ['Status', 'Pending']] },
      { title: 'Account Info', rows: [['Full Name', 'R. Karim'], ['Role', 'Store & Inventory'], ['Location', 'Central Warehouse']] },
    ],
  },
  'DSP-0001': {
    docType: 'Dispatch', status: 'pending',
    sections: [
      { title: 'Dispatch Details', rows: [['Dispatch No.', 'DSP-0001'], ['Flight', 'BS-148'], ['Sector', 'CGP → DAC'], ['Vehicle', 'DHA-2234'], ['Requested By', 'Dispatch Officer'], ['Status', 'Pending']] },
      { title: 'Load Summary', rows: [['Meals', '168'], ['Cold Chain', '≤ +8°C'], ['Gate Temp', '4.5°C'], ['Dispatch Time', '12:43']] },
    ],
  },
  'MNT-2024-012': {
    docType: 'Maintenance', status: 'pending',
    sections: [
      { title: 'Maintenance Details', rows: [['Job No.', 'MNT-2024-012'], ['Asset', 'Blast Chiller BC-02'], ['Type', 'Corrective'], ['Requested By', 'Maintenance Dept'], ['Est. Cost', '৳ 35,000'], ['Status', 'Pending']] },
      { title: 'Work Scope', rows: [['Issue', 'Compressor not cooling'], ['Priority', 'High'], ['Vendor', 'CoolTech Services'], ['Downtime', 'Est. 1 day']] },
    ],
  },
  'RET-2024-030': {
    docType: 'Return Items', status: 'pending',
    sections: [
      { title: 'Return Details', rows: [['Return No.', 'RET-2024-030'], ['Flight', 'BS-201'], ['Sector', 'DAC → DXB'], ['Returned By', 'Cabin Crew'], ['Date', '2024-11-19'], ['Status', 'Pending']] },
      { title: 'Returned Items', rows: [['Mineral Water 250ml', '40 Bottle · Reusable 40'], ['Meal Box', '12 pcs · Reusable 0'], ['Blanket', '8 pcs · Reusable 8']] },
    ],
  },
  'PRET-2024-009': {
    docType: 'Purchase Return', status: 'pending',
    sections: [
      { title: 'Return Details', rows: [['Return No.', 'PRET-2024-009'], ['Vendor', 'Pak Packaging Co'], ['Against PO', 'PO-2024-0155'], ['Requested By', 'Store Manager'], ['Value', '৳ 12,400'], ['Status', 'Pending']] },
      { title: 'Returned Items', rows: [['Aluminium Foil', '20 rolls · Defective'], ['Meal Box', '100 pcs · Wrong size']] },
    ],
  },
  'GL-BS105-001': {
    docType: 'Galley Loading', status: 'pending',
    sections: [
      { title: 'Galley Loading Details', rows: [['Record No.', 'GL-BS105-001'], ['Flight', 'BS-105'], ['Sector', 'DAC → CXB'], ['Prepared By', 'Galley Team'], ['Status', 'Pending']] },
      { title: 'Sign-off', rows: [['Prepared By', 'M. Karim'], ['Physically Handed', 'R. Karim'], ['Flight Checked', 'S. Ahmed'], ['Handed Over', 'T. Islam']] },
      { title: 'Loading Summary', rows: [['Trolleys', '6'], ['Meals', '150'], ['Stage', 'Awaiting approval']] },
    ],
  },
  'PH-2024-051': {
    docType: 'Personal Hygiene', status: 'pending',
    sections: [
      { title: 'Inspection Details', rows: [['Record No.', 'PH-2024-051'], ['Staff', 'R. Karim'], ['Area', 'Hot Kitchen'], ['Inspected By', 'Hygiene Officer'], ['Date', '2024-11-20'], ['Status', 'Pending']] },
      { title: 'Checklist', rows: [['Uniform Clean', 'Yes'], ['Hand Wash', 'Yes'], ['Gloves Worn', 'Yes'], ['Hair Net', 'Yes'], ['Illness Declared', 'No']] },
    ],
  },
  'DHM-2024-014': {
    docType: 'Daily Hygiene Monitoring', status: 'pending',
    sections: [
      { title: 'Monitoring Details', rows: [['Record No.', 'DHM-2024-014'], ['Order ID', 'ORD-9101'], ['Area', 'Cold Kitchen'], ['Monitored By', 'Food Safety Team'], ['Date', '2024-11-20'], ['Status', 'Pending']] },
      { title: 'Time Slots', rows: [['08:00', 'Completed'], ['12:00', 'Completed'], ['16:00', 'Completed'], ['20:00', 'Pending']] },
      { title: 'Summary', rows: [['Total Slots', '4'], ['Completed', '3'], ['Missed', '0'], ['Appeals', '0']] },
    ],
  },
  'WST-2024-022': {
    docType: 'Damaged Product Disposal', status: 'pending',
    sections: [
      { title: 'Disposal Details', rows: [['Entry No.', 'WST-2024-022'], ['Item', 'Chicken Biryani'], ['Quantity', '30 Portion'], ['Reason', 'Temperature breach'], ['Value', '৳ 8,600'], ['Status', 'Pending']] },
      { title: 'Context', rows: [['Reported By', 'Kitchen Supervisor'], ['Date', '2024-11-19'], ['Batch', 'PRO-2024-000031'], ['Approved By', '—']] },
    ],
  },
  'DLY-2024-006': {
    docType: 'Delay Refreshment', status: 'pending',
    sections: [
      { title: 'Delay Details', rows: [['Ref No.', 'DLY-2024-006'], ['Flight', 'BS-301'], ['Sector', 'DAC → JSR'], ['Delay', '2h 15m'], ['Requested By', 'Flight Ops'], ['Status', 'Pending']] },
      { title: 'Refreshment Plan', rows: [['Pax', '148'], ['Snack Box', '148'], ['Water', '148'], ['Est. Value', '৳ 22,200']] },
    ],
  },
  'LMC-2024-018': {
    docType: 'Last-Minute Change', status: 'pending',
    sections: [
      { title: 'Change Details', rows: [['Ref No.', 'LMC-2024-018'], ['Flight', 'BS-901'], ['Sector', 'DAC → DXB'], ['Type', 'Pax increase'], ['Requested By', 'Ops Officer'], ['Status', 'Pending']] },
      { title: 'Change Summary', rows: [['Original Pax', '160'], ['Revised Pax', '175'], ['Extra Meals', '15'], ['Cut-off', 'T-3h']] },
    ],
  },
};

export const MOCK_INVENTORY_ALERTS = [
  { id: 'INV-A1', item: 'Disposable Gloves (Box)', current: 8,  reorderPoint: 20, unit: 'boxes' },
  { id: 'INV-A2', item: 'Aluminium Foil Roll',     current: 3,  reorderPoint: 10, unit: 'rolls' },
  { id: 'INV-A3', item: 'Chicken (Fresh)',          current: 25, reorderPoint: 50, unit: 'kg' },
];

export const MOCK_STOCK = [
  { id: 'S-001', name: 'Disposable Gloves',   category: 'Packaging',    qty: 8,   unit: 'boxes', value: '৳ 2,400',  status: 'low' },
  { id: 'S-002', name: 'Aluminium Foil',      category: 'Packaging',    qty: 3,   unit: 'rolls', value: '৳ 1,800',  status: 'low' },
  { id: 'S-003', name: 'Chicken (Fresh)',      category: 'Raw Material', qty: 25,  unit: 'kg',    value: '৳ 7,500',  status: 'low' },
  { id: 'S-004', name: 'Rice (Basmati)',       category: 'Raw Material', qty: 180, unit: 'kg',    value: '৳ 18,000', status: 'ok' },
  { id: 'S-005', name: 'Cooking Oil',          category: 'Raw Material', qty: 40,  unit: 'L',     value: '৳ 6,000',  status: 'ok' },
  { id: 'S-006', name: 'Meal Trays (Economy)', category: 'Packaging',    qty: 500, unit: 'pcs',   value: '৳ 5,000',  status: 'ok' },
];

// Consumable returns — mirrors the web consumable-returns.tsx. `dest` splits the
// two mobile sub-tabs: 'inventory' (Inventory & Store) vs 'airport' (Airport Items).
export const MOCK_RETURNS = [
  { id: 'CR-2026-051', date: '2026-07-13', flight: 'BS-141', sector: 'DAC→CGP', returnedBy: 'Cabin Crew',    dest: 'inventory', status: 'pending',
    lines: [ { item: 'Mineral Water 250ml', qty: 40, reusable: 40, uom: 'Bottle' }, { item: 'Blanket', qty: 8, reusable: 8, uom: 'pcs' }, { item: 'Meal Box', qty: 12, reusable: 0, uom: 'pcs' } ] },
  { id: 'CR-2026-050', date: '2026-07-12', flight: 'BG-401', sector: 'DAC→DXB', returnedBy: 'Store Handler', dest: 'inventory', status: 'received',
    lines: [ { item: 'Headphone', qty: 30, reusable: 25, uom: 'pcs' }, { item: 'Cutlery Set', qty: 50, reusable: 45, uom: 'set' } ] },
  { id: 'CR-2026-047', date: '2026-07-10', flight: 'BS-207', sector: 'DAC→CXB', returnedBy: 'Cabin Crew',    dest: 'inventory', status: 'pending',
    lines: [ { item: 'Water Bottle 500ml', qty: 24, reusable: 24, uom: 'Bottle' }, { item: 'Napkin Pack', qty: 15, reusable: 0, uom: 'pack' } ] },
  { id: 'CR-2026-049', date: '2026-07-13', flight: 'BS-105', sector: 'DAC→CXB', returnedBy: 'APT Executive', dest: 'airport',   status: 'pending',
    lines: [ { item: 'Meal Trolley', qty: 4, reusable: 4, uom: 'pcs' }, { item: 'Ice Pack', qty: 20, reusable: 18, uom: 'pcs' } ] },
  { id: 'CR-2026-048', date: '2026-07-11', flight: 'BG-522', sector: 'DAC→LHR', returnedBy: 'APT Executive', dest: 'airport',   status: 'forwarded',
    lines: [ { item: 'Oven Rack', qty: 6, reusable: 6, uom: 'pcs' }, { item: 'Bar Trolley', qty: 2, reusable: 2, uom: 'pcs' } ] },
];

export const MOCK_POS = [
  { id: 'PO-2024-0156', vendor: 'Fresh Foods Ltd',    items: 4, total: '৳ 45,200',   status: 'pending',  date: '2024-11-20' },
  { id: 'PO-2024-0155', vendor: 'Pak Packaging Co',   items: 2, total: '৳ 18,600',   status: 'approved', date: '2024-11-19' },
  { id: 'PO-2024-0154', vendor: 'City Agro Supplies', items: 6, total: '৳ 1,02,400', status: 'pending',  date: '2024-11-18' },
];

// Consumable return log — demo seed used when the web app has no persisted
// returns yet (the web `consumable-returns` list starts empty). If the user has
// created returns on the web, the mobile Return Log reads those instead.
export const MOCK_RETURNS = [
  { id: 'CR-7003', date: '2026-06-28', flight: 'BS-105', sector: 'DAC→CXB', returnedBy: 'T. Ahmed',   lines: [
    { itemName: 'Water 250ml',    qty: 22, reusableQty: 22, uom: 'Pcs' },
    { itemName: 'Blanket',        qty: 6,  reusableQty: 5,  uom: 'Pcs' },
    { itemName: 'Headrest Cover', qty: 40, reusableQty: 0,  uom: 'Pcs' },
  ]},
  { id: 'CR-7002', date: '2026-06-27', flight: 'BG-401', sector: 'DAC→DXB', returnedBy: 'S. Karim',   lines: [
    { itemName: 'Juice 1L',       qty: 2,  reusableQty: 2,  uom: 'Pcs' },
    { itemName: 'Napkin Paper',   qty: 8,  reusableQty: 0,  uom: 'Pcs' },
  ]},
  { id: 'CR-7001', date: '2026-06-26', flight: 'VQ-901', sector: 'DAC→KUL', returnedBy: 'M. Rahman',  lines: [
    { itemName: 'Cutlery Set',    qty: 30, reusableQty: 28, uom: 'Pcs' },
    { itemName: 'Tea Pot',        qty: 6,  reusableQty: 6,  uom: 'Pcs' },
  ]},
];

export const MOCK_DEMANDS = [
  { id: 'DMD-2024-0234', item: 'Chicken (Fresh)',   qty: 50, unit: 'kg',    requestedBy: 'Kitchen Supervisor', date: '2024-11-19', status: 'pending'  },
  { id: 'DMD-2024-0233', item: 'Disposable Gloves', qty: 20, unit: 'boxes', requestedBy: 'Store Manager',      date: '2024-11-18', status: 'approved' },
  { id: 'DMD-2024-0232', item: 'Aluminium Foil',    qty: 10, unit: 'rolls', requestedBy: 'Packaging Dept',     date: '2024-11-17', status: 'approved' },
];
