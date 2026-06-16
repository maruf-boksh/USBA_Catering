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
  { id: 'APR-001', type: 'Purchase Order',   ref: 'PO-2024-0156',  amount: '৳ 45,200',   requestedBy: 'Store Manager',      date: '2024-11-20', status: 'pending', module: 'supply-chain' },
  { id: 'APR-002', type: 'Payment Approval', ref: 'INV-2024-0089', amount: '৳ 1,28,500', requestedBy: 'Finance Officer',    date: '2024-11-20', status: 'pending', module: 'accounts' },
  { id: 'APR-003', type: 'Demand Request',   ref: 'DMD-2024-0234', amount: null,          requestedBy: 'Kitchen Supervisor', date: '2024-11-19', status: 'pending', module: 'inventory' },
];

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

export const MOCK_POS = [
  { id: 'PO-2024-0156', vendor: 'Fresh Foods Ltd',    items: 4, total: '৳ 45,200',   status: 'pending',  date: '2024-11-20' },
  { id: 'PO-2024-0155', vendor: 'Pak Packaging Co',   items: 2, total: '৳ 18,600',   status: 'approved', date: '2024-11-19' },
  { id: 'PO-2024-0154', vendor: 'City Agro Supplies', items: 6, total: '৳ 1,02,400', status: 'pending',  date: '2024-11-18' },
];

export const MOCK_DEMANDS = [
  { id: 'DMD-2024-0234', item: 'Chicken (Fresh)',   qty: 50, unit: 'kg',    requestedBy: 'Kitchen Supervisor', date: '2024-11-19', status: 'pending'  },
  { id: 'DMD-2024-0233', item: 'Disposable Gloves', qty: 20, unit: 'boxes', requestedBy: 'Store Manager',      date: '2024-11-18', status: 'approved' },
  { id: 'DMD-2024-0232', item: 'Aluminium Foil',    qty: 10, unit: 'rolls', requestedBy: 'Packaging Dept',     date: '2024-11-17', status: 'approved' },
];
