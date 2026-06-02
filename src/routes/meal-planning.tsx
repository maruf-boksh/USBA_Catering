import { useNavigate } from "react-router-dom";
import { useState, useMemo } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Info, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface MealItem {
  name: string;
  weight: number;
  calories: number;
}

interface MealChoice {
  label: string;
  percentage: number;
  items: MealItem[];
}

interface SpecialMeal {
  type: string;
  portions: number | string;
  items: MealItem[];
  enabled: boolean;
}

interface MealCard {
  id: string;
  day: string;
  mealType: string;
  flightType: string[];
  forType: string;
  choices: MealChoice[];
  specialMeals: SpecialMeal[];
  dessert: MealItem;
  servingTime: { start: string; end: string };
  totalKcal: number;
  createdDate: string;
}

interface GMOrder {
  flightNumber: string;
  route: string;
  date: string;
  departureTime: string;
  paxCount: number;
  crewCount: number;
  totalMealsToday: number;
  totalMeals96h: number;
  approvedBy: string;
  approvedTimestamp: string;
}

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MEAL_TYPES = ["Breakfast", "Lunch", "Snacks", "Heavy Snacks", "Dinner"];

const FOOD_ITEMS: Record<string, Array<{ name: string; weight: number; calories: number }>> = {
  Breakfast: [
    { name: "Portuguese Omelet", weight: 80, calories: 150 },
    { name: "Potato Hasbrown", weight: 80, calories: 120 },
    { name: "Chicken Croquette", weight: 80, calories: 160 },
    { name: "Croissant", weight: 40, calories: 180 },
    { name: "Soft Roll", weight: 40, calories: 100 },
    { name: "Chicken Khichuri", weight: 250, calories: 280 },
    { name: "Fried Egg", weight: 50, calories: 85 },
    { name: "Scrambled Egg", weight: 100, calories: 145 },
    { name: "Boiled Egg", weight: 50, calories: 78 },
    { name: "Paratha", weight: 60, calories: 180 },
    { name: "Laccha Paratha", weight: 60, calories: 190 },
    { name: "Chana Dal", weight: 80, calories: 120 },
    { name: "Mug Dal", weight: 40, calories: 65 },
    { name: "Jam", weight: 10, calories: 30 },
    { name: "Butter", weight: 10, calories: 72 },
    { name: "Mixed Veg", weight: 30, calories: 45 },
    { name: "Semolina Halwa", weight: 80, calories: 170 },
    { name: "Chicken Omelet", weight: 80, calories: 160 },
  ],
  Lunch: [
    { name: "Boiled Rice", weight: 180, calories: 210 },
    { name: "Plain Polao", weight: 180, calories: 240 },
    { name: "Jeera Polao", weight: 180, calories: 245 },
    { name: "Beef Biriyani", weight: 250, calories: 380 },
    { name: "Chicken Biriyani", weight: 250, calories: 360 },
    { name: "Chicken Shaslik", weight: 100, calories: 160 },
    { name: "Prawn with Veg Curry", weight: 100, calories: 140 },
    { name: "Akbari Vendi", weight: 50, calories: 70 },
    { name: "Chicken Masala", weight: 100, calories: 155 },
    { name: "Buttered Veg", weight: 100, calories: 90 },
    { name: "Kulcha", weight: 60, calories: 180 },
    { name: "Mixed Veg Curry", weight: 50, calories: 75 },
    { name: "Dal Butter Fry", weight: 50, calories: 120 },
    { name: "Mug Dal Vuna", weight: 50, calories: 80 },
    { name: "Naan", weight: 60, calories: 170 },
    { name: "Mughlai Chicken", weight: 100, calories: 160 },
  ],
  Dinner: [
    { name: "Plain Polao", weight: 180, calories: 240 },
    { name: "Boiled Rice", weight: 180, calories: 210 },
    { name: "Chicken Rezala", weight: 100, calories: 145 },
    { name: "Chicken Vuna", weight: 100, calories: 150 },
    { name: "Chicken Dopiaza", weight: 100, calories: 140 },
    { name: "Mug Dal", weight: 100, calories: 130 },
    { name: "Mixed Veg. Vajee", weight: 50, calories: 65 },
    { name: "Laccha Paratha", weight: 60, calories: 190 },
    { name: "Sauteed Veg", weight: 100, calories: 110 },
    { name: "Dal Butter Fry", weight: 50, calories: 120 },
    { name: "Tandoori Chicken", weight: 100, calories: 160 },
    { name: "Kulcha", weight: 60, calories: 180 },
    { name: "Beef Rezala", weight: 100, calories: 150 },
    { name: "Chicken Kabab", weight: 50, calories: 120 },
    { name: "Mixed Veg Curry", weight: 50, calories: 75 },
  ],
  Snacks: [
    { name: "Chicken Roll", weight: 60, calories: 180 },
    { name: "Plain Cake", weight: 40, calories: 120 },
    { name: "Salted Biscuit", weight: 50, calories: 140 },
    { name: "Lemon Danish", weight: 40, calories: 160 },
    { name: "Sandwich", weight: 100, calories: 200 },
    { name: "Fruit Salad", weight: 80, calories: 70 },
    { name: "Cookies", weight: 30, calories: 130 },
    { name: "Banana Cake", weight: 50, calories: 150 },
    { name: "Cheese Cracker", weight: 30, calories: 110 },
  ],
  "Heavy Snacks": [
    { name: "Chicken Buggati", weight: 90, calories: 200 },
    { name: "Potato Wedges", weight: 50, calories: 120 },
    { name: "Chicken & Veg Frankie", weight: 100, calories: 240 },
    { name: "Fried Potato", weight: 50, calories: 115 },
    { name: "Korean Fried Chicken", weight: 100, calories: 280 },
    { name: "Roll Sandwich with Chicken & Cheese", weight: 150, calories: 320 },
    { name: "Veg Frankie", weight: 80, calories: 200 },
    { name: "Veg Buggati", weight: 90, calories: 170 },
    { name: "Veg Cutlet", weight: 60, calories: 140 },
    { name: "Spring Roll", weight: 80, calories: 160 },
    { name: "Samosa", weight: 60, calories: 140 },
  ],
};

const DESSERT_ITEMS = [
  { name: "Yoghurt", weight: 80, calories: 70 },
  { name: "Firni", weight: 80, calories: 160 },
  { name: "Semolina", weight: 50, calories: 130 },
  { name: "Vanilla Pastry", weight: 60, calories: 180 },
  { name: "Chocolate Brownie", weight: 50, calories: 210 },
  { name: "Fruit Custard", weight: 80, calories: 140 },
  { name: "Lemon Danish", weight: 40, calories: 160 },
  { name: "Kitkat Chocolate", weight: 30, calories: 155 },
  { name: "Gulab Jamun", weight: 60, calories: 200 },
  { name: "Panna Cotta", weight: 80, calories: 180 },
  { name: "Ice Cream", weight: 60, calories: 130 },
];

const SPECIAL_MEAL_INFO: Record<string, { code: string; label: string; allowed: string[]; notAllowed: string[]; note: string }> = {
  AVML: { code: "AVML", label: "Asian Vegetarian Meal", allowed: ["Vegetables", "Dairy products", "Eggs", "Legumes", "Rice", "Lentils", "Spices"], notAllowed: ["Meat", "Poultry", "Seafood", "Fish", "Beef", "Pork"], note: "Lacto-vegetarian, spiced. Suitable for South Asian vegetarians." },
  KSML: { code: "KSML", label: "Kosher Meal", allowed: ["Certified Kosher meat/poultry", "Kosher fish (fins & scales)", "Fruits", "Vegetables"], notAllowed: ["Pork", "Shellfish", "Mixing meat and dairy", "Non-certified Kosher items"], note: "Must be certified Kosher. Meat and dairy cannot be served together." },
  MOML: { code: "MOML", label: "Muslim / Halal Meal", allowed: ["Halal-certified meat", "Poultry", "Fish", "Vegetables", "Rice", "Bread"], notAllowed: ["Pork", "Pork by-products", "Alcohol", "Non-Halal slaughtered meat"], note: "All meat must be Halal-certified." },
  DBML: { code: "DBML", label: "Diabetic Meal", allowed: ["Lean protein", "Non-starchy vegetables", "Whole grains (small portion)", "Low-GI foods"], notAllowed: ["Refined sugar", "White bread", "Fried foods", "High-GI desserts"], note: "Low sugar, low fat. No concentrated sweets." },
  GFML: { code: "GFML", label: "Gluten-Free Meal", allowed: ["Rice", "Potatoes", "Corn", "Meat", "Fish", "Vegetables", "GF-certified grains"], notAllowed: ["Wheat", "Barley", "Rye", "Regular bread/pasta/cakes", "Standard soy sauce"], note: "No gluten-containing ingredients. Avoid cross-contamination." },
  LCML: { code: "LCML", label: "Low-Calorie Meal", allowed: ["Lean protein", "Steamed vegetables", "Salads", "Low-fat dairy", "Grilled items"], notAllowed: ["Fried foods", "High-fat sauces", "Full-fat dairy", "Pastries"], note: "Generally under 400 kcal. Low fat and sugar." },
  BLML: { code: "BLML", label: "Bland Meal", allowed: ["Plain rice", "Boiled chicken", "Steamed vegetables", "White bread", "Low-acid fruits"], notAllowed: ["Spicy foods", "Fried foods", "Acidic foods", "Onion", "Garlic"], note: "For sensitive stomachs. No spices or strong flavors." },
  HNML: { code: "HNML", label: "Hindu Meal", allowed: ["Vegetables", "Chicken (sometimes)", "Fish (sometimes)", "Dairy", "Eggs", "Rice", "Bread"], notAllowed: ["Beef", "Veal", "Pork"], note: "No beef. May include poultry/fish depending on preference." },
  VLML: { code: "VLML", label: "Lacto-Ovo Vegetarian Meal", allowed: ["Vegetables", "Dairy products", "Eggs", "Legumes", "Grains", "Fruits"], notAllowed: ["Meat", "Poultry", "Fish", "Seafood"], note: "Vegetarian including dairy and eggs." },
  CHML: { code: "CHML", label: "Child Meal", allowed: ["Mild foods", "Small portions", "Kid-friendly items", "Plain rice/pasta", "Mild chicken"], notAllowed: ["Spicy foods", "Whole nuts", "Alcohol-based sauces"], note: "Suitable for children aged 2–12. Mild, easy to eat." },
  VGML: { code: "VGML", label: "Vegan Meal", allowed: ["Vegetables", "Fruits", "Legumes", "Grains", "Nuts", "Seeds", "Plant-based items"], notAllowed: ["Meat", "Poultry", "Fish", "Dairy", "Eggs", "Honey", "Any animal-derived ingredient"], note: "Strictly plant-based. No animal products whatsoever." },
  JML:  { code: "JML",  label: "Jain Meal", allowed: ["Above-ground vegetables only", "Grains", "Legumes", "Fruits"], notAllowed: ["Root vegetables (onion, garlic, potato, carrot, beet)", "Meat", "Fish", "Eggs"], note: "No root vegetables. Strictly vegetarian." },
};

const gmOrderData: GMOrder = {
  flightNumber: "BS-315",
  route: "DAC → KUL",
  date: "2025-11-09",
  departureTime: "14:30",
  paxCount: 300,
  crewCount: 16,
  totalMealsToday: 9600,
  totalMeals96h: 38400,
  approvedBy: "S. Ahmed",
  approvedTimestamp: "2025-11-08 10:45 AM",
};

const gmMealSummary = {
  importDate: "2026-05-21",
  intl: { depMeal: 618, depChml: 24, depTotal: 642, retMeal: 0, retChml: 0, retVgml: 18, retTotal: 18, grandTotal: 660 },
  dom: {
    usba: { zenith: 160, pax: 160, breakfast: 160, lunch: 0 },
    aaa: { zenith: 66, pax: 66 },
    crew: { hSnacks: 8, lunch: 0, dinner: 4 },
    totalZenith: 226,
  },
};

// Sample data for current day
function getSampleMeals(): MealCard[] {
  const today = DAYS[new Date().getDay() === 0 ? 6 : new Date().getDay() - 1];

  return [
    {
      id: "meal-1",
      day: today,
      mealType: "Lunch",
      flightType: ["International"],
      forType: "Passengers",
      choices: [
        {
          label: "CHOICE 1",
          percentage: 60,
          items: [
            { name: "Plain Polao", weight: 180, calories: 240 },
            { name: "Beef Rezala", weight: 100, calories: 150 },
            { name: "Mug Dal Vuna", weight: 50, calories: 80 },
          ],
        },
        {
          label: "CHOICE 2",
          percentage: 40,
          items: [
            { name: "Jeera Polao", weight: 180, calories: 245 },
            { name: "Chicken Masala", weight: 100, calories: 155 },
            { name: "Mixed Veg Curry", weight: 50, calories: 75 },
          ],
        },
      ],
      specialMeals: [
        {
          type: "VGML",
          portions: 5,
          items: [
            { name: "Plain Polao", weight: 170, calories: 230 },
            { name: "Mixed Veg Curry", weight: 70, calories: 90 },
            { name: "Mug Dal Vuna", weight: 50, calories: 80 },
          ],
          enabled: true,
        },
        {
          type: "CHML",
          portions: "As per demand",
          items: [
            { name: "Plain Polao, Saffron Rice, Chicken Korma, Kitkat Chocolate", weight: 250, calories: 450 },
          ],
          enabled: true,
        },
      ],
      dessert: { name: "Vanilla Pastry", weight: 60, calories: 180 },
      servingTime: { start: "11:00", end: "14:00" },
      totalKcal: 720,
      createdDate: new Date().toISOString().split('T')[0],
    },
    {
      id: "meal-2",
      day: today,
      mealType: "Breakfast",
      flightType: ["International", "Domestic"],
      forType: "Crew",
      choices: [
        {
          label: "CHOICE 1",
          percentage: 50,
          items: [
            { name: "Chicken Khichuri", weight: 250, calories: 280 },
            { name: "Fried Egg", weight: 50, calories: 85 },
          ],
        },
        {
          label: "CHOICE 2",
          percentage: 50,
          items: [
            { name: "Roti", weight: 80, calories: 120 },
            { name: "Scrambled Egg", weight: 100, calories: 145 },
            { name: "Mixed Veg Curry", weight: 50, calories: 75 },
          ],
        },
      ],
      specialMeals: [
        {
          type: "VGML",
          portions: 1,
          items: [
            { name: "Roti", weight: 80, calories: 120 },
            { name: "Mixed Veg", weight: 40, calories: 60 },
            { name: "Mug Dal", weight: 30, calories: 50 },
          ],
          enabled: true,
        },
      ],
      dessert: { name: "Yoghurt & Semolina", weight: 80, calories: 120 },
      servingTime: { start: "07:00", end: "10:00" },
      totalKcal: 480,
      createdDate: new Date().toISOString().split('T')[0],
    },
    {
      id: "meal-3",
      day: today,
      mealType: "Lunch",
      flightType: ["International", "Domestic"],
      forType: "Crew",
      choices: [
        {
          label: "CHOICE 1",
          percentage: 50,
          items: [
            { name: "Beef Biriyani", weight: 250, calories: 380 },
            { name: "Chicken Kabab", weight: 50, calories: 120 },
            { name: "Veg Tempura", weight: 30, calories: 90 },
          ],
        },
        {
          label: "CHOICE 2",
          percentage: 50,
          items: [
            { name: "Mughlai Chicken", weight: 100, calories: 160 },
            { name: "Veg Vajee", weight: 80, calories: 100 },
            { name: "Garlic Bread", weight: 60, calories: 180 },
          ],
        },
      ],
      specialMeals: [
        {
          type: "VGML",
          portions: 1,
          items: [
            { name: "Plain Polao", weight: 150, calories: 210 },
            { name: "Mixed Veg", weight: 100, calories: 130 },
            { name: "Potato Croquettes", weight: 40, calories: 160 },
          ],
          enabled: true,
        },
      ],
      dessert: { name: "Firni & Vanilla Pastry", weight: 100, calories: 240 },
      servingTime: { start: "11:00", end: "14:00" },
      totalKcal: 640,
      createdDate: new Date().toISOString().split('T')[0],
    },
    {
      id: "meal-4",
      day: today,
      mealType: "Dinner",
      flightType: ["International", "Domestic"],
      forType: "Crew",
      choices: [
        {
          label: "CHOICE 1",
          percentage: 50,
          items: [
            { name: "Boiled Rice", weight: 180, calories: 210 },
            { name: "Chicken Dopiaza", weight: 100, calories: 140 },
            { name: "Dal Butter Fry", weight: 50, calories: 120 },
          ],
        },
        {
          label: "CHOICE 2",
          percentage: 50,
          items: [
            { name: "Tandoori Chicken", weight: 100, calories: 160 },
            { name: "Sauteed Veg", weight: 100, calories: 110 },
            { name: "Kulcha", weight: 60, calories: 180 },
          ],
        },
      ],
      specialMeals: [
        {
          type: "VGML",
          portions: 1,
          items: [
            { name: "Boiled Rice", weight: 150, calories: 170 },
            { name: "Mixed Veg", weight: 100, calories: 130 },
            { name: "Chana Dal", weight: 40, calories: 100 },
          ],
          enabled: true,
        },
      ],
      dessert: { name: "Firni & Semolina", weight: 100, calories: 210 },
      servingTime: { start: "19:00", end: "22:00" },
      totalKcal: 590,
      createdDate: new Date().toISOString().split('T')[0],
    },
    {
      id: "meal-5",
      day: today,
      mealType: "Heavy Snacks",
      flightType: ["International", "Domestic"],
      forType: "Crew",
      choices: [
        {
          label: "CHOICE 1",
          percentage: 50,
          items: [{ name: "Roll Sandwich with Chicken & Cheese", weight: 150, calories: 320 }],
        },
        {
          label: "CHOICE 2",
          percentage: 50,
          items: [
            { name: "Korean Fried Chicken", weight: 100, calories: 280 },
            { name: "Potato Wedges", weight: 50, calories: 180 },
          ],
        },
      ],
      specialMeals: [
        {
          type: "VGML",
          portions: 1,
          items: [
            { name: "Veg Frankie", weight: 80, calories: 200 },
            { name: "Buttered Veg", weight: 30, calories: 60 },
          ],
          enabled: true,
        },
      ],
      dessert: { name: "Firni & Vanilla Pastry", weight: 80, calories: 160 },
      servingTime: { start: "16:00", end: "19:00" },
      totalKcal: 410,
      createdDate: new Date().toISOString().split('T')[0],
    },
  ];
}

export default function MealPlanning() {
  const navigate = useNavigate();
  const [meals, setMeals] = useState<MealCard[]>(getSampleMeals());
  const [selectedDay, setSelectedDay] = useState(DAYS[new Date().getDay() === 0 ? 6 : new Date().getDay() - 1]);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [orderDetailsOpen, setOrderDetailsOpen] = useState(false);
  const [forwardConfirmOpen, setForwardConfirmOpen] = useState(false);
  const [selectedMeal, setSelectedMeal] = useState<MealCard | null>(null);
  const [isForwarded, setIsForwarded] = useState(false);
  const [forwardedTime, setForwardedTime] = useState("");
  const [activeFilters, setActiveFilters] = useState({ domestic: true, international: true, passenger: true, crew: true });
  const [forwardCycle, setForwardCycle] = useState<"pending" | "forwarded" | "ready">("pending");
  const [lastForwardedQuantity, setLastForwardedQuantity] = useState(0);
  const [orderHistory, setOrderHistory] = useState<Array<{ mealsOrdered: number; orderedBy: string; designation: string; date: string; time: string; period: string }>>([
    { mealsOrdered: 9600, orderedBy: "S. Ahmed", designation: "Meal Planner", date: "08 Nov 2025", time: "10:45 AM", period: "24-hour cycle" },
  ]);
  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [orderModalQuantity, setOrderModalQuantity] = useState("");
  const [orderModalError, setOrderModalError] = useState("");
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [forwardedAt, setForwardedAt] = useState<Date | null>(null);
  const [choiceEditOpen, setChoiceEditOpen] = useState(false);
  const [editingChoice, setEditingChoice] = useState<{ mealId: string; kind: "choice" | "specialMeal" | "dessert"; choiceIdx?: number; smType?: string; items: MealItem[]; label: string } | null>(null);
  const [choiceEditNotes, setChoiceEditNotes] = useState<Record<string, string[]>>({});

  const getInitialCreateData = (day: string) => ({
    day,
    flightType: [] as string[],
    forType: "",
    mealTypes: [] as string[],
    choices: [
      { label: "CHOICE 1", percentage: 60, items: [] as MealItem[] },
      { label: "CHOICE 2", percentage: 40, items: [] as MealItem[] },
    ] as MealChoice[],
    specialMealsByType: {} as Record<string, Array<{ code: string; portions: number | string; items: MealItem[] }>>,
    choiceItems: [
      MEAL_TYPES.reduce((acc, t) => { acc[t] = [] as MealItem[]; return acc; }, {} as Record<string, MealItem[]>),
      MEAL_TYPES.reduce((acc, t) => { acc[t] = [] as MealItem[]; return acc; }, {} as Record<string, MealItem[]>),
    ] as [Record<string, MealItem[]>, Record<string, MealItem[]>],
    dessertByType: {} as Record<string, MealItem[]>,
    dessertAllocationByType: {} as Record<string, number[]>,
    choicePercentagesByType: {} as Record<string, { c1: number; c2: number }>,
    servingTimes: {} as Record<string, { start: string; end: string }>,
  });

  const [createData, setCreateData] = useState(getInitialCreateData(selectedDay));
  const [createErrors, setCreateErrors] = useState<string[]>([]);
  const [daySelectionOpen, setDaySelectionOpen] = useState(false);
  const [pendingDay, setPendingDay] = useState(selectedDay);
  const [tagLog, setTagLog] = useState<{ name: string; date: string; time: string } | null>(null);
  const [orderEditMode, setOrderEditMode] = useState(false);
  const [orderEditLog, setOrderEditLog] = useState<{ name: string; date: string; time: string } | null>(null);
  const [editableSummary, setEditableSummary] = useState({
    importDate: gmMealSummary.importDate,
    intl: { depMeal: gmMealSummary.intl.depMeal, depChml: gmMealSummary.intl.depChml, retMeal: gmMealSummary.intl.retMeal, retChml: gmMealSummary.intl.retChml, retVgml: gmMealSummary.intl.retVgml },
    dom: {
      usba: { ...gmMealSummary.dom.usba },
      aaa: { ...gmMealSummary.dom.aaa },
      crew: { ...gmMealSummary.dom.crew },
    },
  });

  const [pendingSpecialMeal, setPendingSpecialMeal] = useState<{ code: string; portions: number | string; items: MealItem[] } | null>(null);
  const [pendingSpecialMealForType, setPendingSpecialMealForType] = useState<string | null>(null);
  const [activeChoiceForItems, setActiveChoiceForItems] = useState<0 | 1>(0);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [activeChoicePercentType, setActiveChoicePercentType] = useState<string>("");
  const [activeItemsTab, setActiveItemsTab] = useState<string>("");
  const [createStep, setCreateStep] = useState(1);
  const [activeMealTab, setActiveMealTab] = useState<string>("Breakfast");

  const currentDayMeals = useMemo(() => meals.filter((m) => m.day === selectedDay), [meals, selectedDay]);
  const effectiveItemsTab = (activeItemsTab && (createData.mealTypes.includes(activeItemsTab) || activeItemsTab === "special-meals" || activeItemsTab === "dessert"))
    ? activeItemsTab
    : (createData.mealTypes[0] ?? "");
  const effectiveChoicePercentType = (activeChoicePercentType && createData.mealTypes.includes(activeChoicePercentType))
    ? activeChoicePercentType
    : (createData.mealTypes[0] ?? "");
  const totalChoicePercent = effectiveChoicePercentType
    ? ((createData.choicePercentagesByType[effectiveChoicePercentType]?.c1 ?? 60) + (createData.choicePercentagesByType[effectiveChoicePercentType]?.c2 ?? 40))
    : 100;
  const stepValid: Record<number, boolean> = {
    1: createData.flightType.length > 0 && createData.forType !== "",
    2: createData.mealTypes.length > 0 && createData.mealTypes.every((t) =>
      (createData.choiceItems[0][t] || []).some((it) => it.name.trim() !== "") &&
      (createData.choiceItems[1][t] || []).some((it) => it.name.trim() !== "")
    ),
    3: createData.mealTypes.length > 0 && createData.mealTypes.every((t) => {
      const p = createData.choicePercentagesByType[t];
      return p && (p.c1 + p.c2) === 100;
    }),
    4: createData.mealTypes.every((t) => Boolean(createData.servingTimes[t]?.start) && Boolean(createData.servingTimes[t]?.end)),
    5: true,
  };

  const resetCreateData = (day: string) => setCreateData(getInitialCreateData(day));
  const handleCreateOpenChange = (open: boolean) => {
    setCreateModalOpen(open);
    if (open) {
      resetCreateData(selectedDay);
      setActiveChoiceForItems(0);
      setPendingSpecialMeal(null);
      setPendingSpecialMealForType(null);
      setActiveChoicePercentType("");
      setActiveItemsTab("");
      setActiveMealTab("Breakfast");
      setCreateErrors([]);
    }
  };

  const handleCreateSave = () => {
    const errors: string[] = [];
    if (createData.flightType.length === 0) errors.push("Flight Type is required.");
    if (!createData.forType) errors.push("'For' (Passengers/Crew) is required.");
    if (createData.mealTypes.length === 0) errors.push("At least one Meal Type must be selected.");
    createData.mealTypes.forEach((t) => {
      const percs = createData.choicePercentagesByType[t];
      if (!percs || (percs.c1 + percs.c2) !== 100) errors.push(`${t}: Choice percentages must total 100%.`);
      const items1 = (createData.choiceItems[0][t] || []).filter((it) => it.name.trim() !== "");
      const items2 = (createData.choiceItems[1][t] || []).filter((it) => it.name.trim() !== "");
      if (items1.length === 0) errors.push(`CHOICE 1: At least one item required for ${t}.`);
      if (items2.length === 0) errors.push(`CHOICE 2: At least one item required for ${t}.`);
      if (!createData.servingTimes[t]?.start || !createData.servingTimes[t]?.end) errors.push(`Serving time required for ${t}.`);
    });

    if (errors.length > 0) {
      setCreateErrors(errors);
      return;
    }

    const newMeals: MealCard[] = createData.mealTypes.map((mealType) => {
      const servingTime = createData.servingTimes[mealType] ?? { start: "11:00", end: "14:00" };
      const typePercs = createData.choicePercentagesByType[mealType];
      const choices = createData.choices.map((choice, choiceIdx) => ({
        ...choice,
        percentage: choiceIdx === 0 ? (typePercs?.c1 ?? 60) : (typePercs?.c2 ?? 40),
        items: (createData.choiceItems[choiceIdx as 0 | 1]?.[mealType] || []).filter((it) => it.name.trim() !== ""),
      }));
      const specialMeals: SpecialMeal[] = (createData.specialMealsByType[mealType] || []).map((sel) => ({
        type: sel.code,
        portions: sel.portions,
        items: sel.items || [],
        enabled: true,
      }));
      const dessertItems = (createData.dessertByType[mealType] || []).filter((it) => it.name.trim() !== "");
      const firstDessert = dessertItems[0] ?? { name: "", weight: 0, calories: 0 };

      const totalKcal = choices.reduce((sum, c) => sum + c.items.reduce((inner, it) => inner + (it.calories || 0), 0), 0) || 500;

      return {
        id: `meal-${Date.now()}-${mealType}`,
        day: createData.day,
        mealType,
        flightType: createData.flightType,
        forType: createData.forType || "Passengers",
        choices,
        specialMeals,
        dessert: firstDessert,
        servingTime,
        totalKcal,
        createdDate: new Date().toISOString().split('T')[0],
      };
    });

    setMeals((prev) => [...prev, ...newMeals]);
    toast.success("Meal configured successfully");
    setCreateModalOpen(false);
    setCreateErrors([]);
    resetCreateData(selectedDay);
  };

  const getMealsByTypeForDay = (day: string) => {
    const dayMeals = meals.filter((m) => m.day === day);
    const filtered = dayMeals.filter(mealMatchesFilters);
    const grouped: Record<string, MealCard[]> = {};
    MEAL_TYPES.forEach((type) => {
      grouped[type] = filtered.filter((m) => m.mealType === type);
    });
    return grouped;
  };

  const configuredCount = currentDayMeals.length;

  const openEditModal = (meal: MealCard) => {
    setSelectedMeal(meal);
    setCreateData({
      day: meal.day,
      flightType: meal.flightType,
      forType: meal.forType,
      mealTypes: [meal.mealType],
      choices: meal.choices,
      specialMealsByType: { [meal.mealType]: meal.specialMeals.filter((sm) => sm.enabled).map((sm) => ({ code: sm.type, portions: sm.portions, items: sm.items || [] })) },
      choiceItems: [
        { ...MEAL_TYPES.reduce((acc, t) => { acc[t] = [] as MealItem[]; return acc; }, {} as Record<string, MealItem[]>), [meal.mealType]: meal.choices[0]?.items ?? [] },
        { ...MEAL_TYPES.reduce((acc, t) => { acc[t] = [] as MealItem[]; return acc; }, {} as Record<string, MealItem[]>), [meal.mealType]: meal.choices[1]?.items ?? [] },
      ],
      dessertByType: { [meal.mealType]: meal.dessert.name ? [meal.dessert] : [] },
      dessertAllocationByType: { [meal.mealType]: meal.dessert.name ? [100] : [] },
      choicePercentagesByType: { [meal.mealType]: { c1: meal.choices[0]?.percentage ?? 60, c2: meal.choices[1]?.percentage ?? 40 } },
      servingTimes: { [meal.mealType]: meal.servingTime },
    });
    setEditModalOpen(true);
  };

  const openViewMenu = (meal: MealCard) => {
    setSelectedMeal(meal);
    setViewMenuOpen(true);
  };

  const handleForward = () => {
    const now = new Date();
    const timestamp = now.toLocaleString();
    setForwardedTime(timestamp);
    setIsForwarded(true);
    setForwardConfirmOpen(false);
    toast.success("Meal plan forwarded to Production — opening Production Order");
    navigate("/production-entry");
  };

  const formatDateDDMMMYYYY = (dateStr: string) => {
    const date = new Date(dateStr);
    const day = date.getDate();
    const month = date.toLocaleDateString("en-GB", { month: "short" });
    const year = date.getFullYear();
    return `${day} ${month} ${year}`;
  };

  const getNextDate = () => {
    const next = new Date();
    next.setDate(next.getDate() + 1);
    return next.toISOString().split('T')[0];
  };

  const mealMatchesFilters = (meal: MealCard) => {
    const flightTypeMatch = meal.flightType.some((ft) => (ft === "Domestic" && activeFilters.domestic) || (ft === "International" && activeFilters.international));
    const audienceMatch = (meal.forType === "Passengers" && activeFilters.passenger) || (meal.forType === "Crew" && activeFilters.crew);
    return flightTypeMatch && audienceMatch;
  };

  const hasAnyFilterActive = Object.values(activeFilters).some((v) => v);

  return (
    <>
      <PageHeader
        title="Meal Planning"
        subtitle="Configure daily meal service for passengers and crew"
        actions={
          <Dialog open={createModalOpen} onOpenChange={handleCreateOpenChange}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-1" /> New Meal
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Create New Meal Configuration</DialogTitle>
              </DialogHeader>

              <div className="space-y-5">
                {/* ── Basic Info ── */}
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <Label>Day</Label>
                    <select
                      value={createData.day}
                      onChange={(e) => setCreateData({ ...createData, day: e.target.value })}
                      className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                    >
                      {DAYS.map((day) => (
                        <option key={day} value={day}>{day}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label>Flight Type</Label>
                    <div className="flex flex-col gap-1 mt-2">
                      {["Domestic", "International", "Both"].map((type) => (
                        <label key={type} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="flightType"
                            value={type}
                            checked={createData.flightType.join(",") === (type === "Both" ? "Domestic,International" : type)}
                            onChange={(e) => {
                              const val = e.target.value;
                              setCreateData({ ...createData, flightType: val === "Both" ? ["Domestic", "International"] : [val] });
                            }}
                            className="h-4 w-4"
                          />
                          <span className="text-sm">{type}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label>For</Label>
                    <div className="flex flex-col gap-1 mt-2">
                      {["Passengers", "Crew", "Both"].map((type) => (
                        <label key={type} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="forType"
                            value={type}
                            checked={createData.forType === type}
                            onChange={(e) => setCreateData({ ...createData, forType: e.target.value })}
                            className="h-4 w-4"
                          />
                          <span className="text-sm">{type}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="border-t" />

                {/* ── Meal Configuration ── */}
                <div>
                  <div className="text-sm font-semibold mb-3">Meal Configuration</div>
                  {/* ── Meal type toggle buttons ── */}
                  <div className="flex flex-wrap gap-2 mb-4">
                    {(["Breakfast", "Lunch", "Dinner", "Snacks", "Heavy Snacks"] as const).map((t) => {
                      const isSelected = createData.mealTypes.includes(t);
                      const isActive = activeMealTab === t;
                      return (
                        <button
                          key={t}
                          type="button"
                          onClick={() => {
                            if (!isSelected) {
                              const copy = { ...createData };
                              const seedRow = [{ name: "", weight: 0, calories: 0 }];
                              copy.choiceItems = [
                                { ...copy.choiceItems[0], [t]: copy.choiceItems[0][t]?.length ? copy.choiceItems[0][t] : seedRow },
                                { ...copy.choiceItems[1], [t]: copy.choiceItems[1][t]?.length ? copy.choiceItems[1][t] : seedRow },
                              ];
                              copy.dessertByType = { ...copy.dessertByType, [t]: copy.dessertByType[t] ?? [] };
                              copy.dessertAllocationByType = { ...copy.dessertAllocationByType, [t]: copy.dessertAllocationByType[t] ?? [] };
                              copy.choicePercentagesByType = { ...copy.choicePercentagesByType, [t]: copy.choicePercentagesByType[t] ?? { c1: 60, c2: 40 } };
                              copy.specialMealsByType = { ...copy.specialMealsByType, [t]: copy.specialMealsByType[t] ?? [] };
                              copy.servingTimes = { ...copy.servingTimes, [t]: copy.servingTimes[t] ?? (t === "Breakfast" ? { start: "07:00", end: "10:00" } : t === "Lunch" ? { start: "11:00", end: "14:00" } : t === "Snacks" ? { start: "14:00", end: "16:00" } : t === "Heavy Snacks" ? { start: "16:00", end: "19:00" } : { start: "19:00", end: "22:00" }) };
                              copy.mealTypes = [...copy.mealTypes, t];
                              setCreateData(copy);
                              setActiveMealTab(t);
                            } else {
                              setActiveMealTab(t);
                            }
                          }}
                          className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                            isSelected && isActive
                              ? "bg-primary text-primary-foreground border-primary"
                              : isSelected
                              ? "bg-primary/10 text-primary border-primary/30 hover:bg-primary/20"
                              : isActive
                              ? "bg-muted border-border text-foreground"
                              : "bg-background text-muted-foreground border-border hover:bg-muted"
                          }`}
                        >
                          {t}
                          {isSelected && (
                            <span
                              className="ml-0.5 text-base leading-none opacity-60 hover:opacity-100"
                              onClick={(e) => {
                                e.stopPropagation();
                                const newMealTypes = createData.mealTypes.filter((mt) => mt !== t);
                                setCreateData({ ...createData, mealTypes: newMealTypes });
                                setActiveMealTab(isActive ? (newMealTypes[0] ?? "Breakfast") : activeMealTab);
                              }}
                            >
                              ×
                            </span>
                          )}
                        </button>
                      );
                    })}
                    <div className="w-px bg-border mx-1 self-stretch" />
                    {(["special-meals", "dessert"] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setActiveMealTab(t)}
                        className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                          activeMealTab === t
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background text-muted-foreground border-border hover:bg-muted"
                        }`}
                      >
                        {t === "special-meals" ? "Special Meals" : "Dessert"}
                      </button>
                    ))}
                  </div>

                  {/* ── Content panel for regular meal types ── */}
                  {(["Breakfast", "Lunch", "Dinner", "Snacks", "Heavy Snacks"] as const).map((type) => {
                    if (activeMealTab !== type) return null;
                    const isIncluded = createData.mealTypes.includes(type);
                    if (!isIncluded) {
                      return (
                        <div key={type} className="text-center py-12 border rounded-lg bg-muted/20 text-sm text-muted-foreground">
                          Click <strong className="text-foreground">{type}</strong> above to include it in this meal plan
                        </div>
                      );
                    }
                    const activeItems = createData.choiceItems[activeChoiceForItems][type] || [];
                    const percs = createData.choicePercentagesByType[type] ?? { c1: 60, c2: 40 };
                    const totalPct = percs.c1 + percs.c2;
                    return (
                      <div key={type} className="space-y-4">
                        {/* CHOICE 01 / 02 Radio */}
                        <div className="flex gap-6">
                          {([0, 1] as const).map((cIdx) => (
                            <label key={cIdx} className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="radio"
                                name={`activeChoice-${type}`}
                                checked={activeChoiceForItems === cIdx}
                                onChange={() => setActiveChoiceForItems(cIdx)}
                                className="h-4 w-4"
                              />
                              <span className="text-sm font-semibold">CHOICE {cIdx === 0 ? "01" : "02"}</span>
                            </label>
                          ))}
                        </div>

                        {/* Items for active choice */}
                        <div className="rounded-lg border p-3">
                          <div className="font-semibold text-sm mb-2">
                            {type} — CHOICE {activeChoiceForItems === 0 ? "01" : "02"}
                          </div>
                          <div className="flex gap-2 items-center text-xs font-semibold text-muted-foreground border-b pb-1 mb-2">
                            <div className="flex-1">Item</div>
                            <div className="w-20 text-center">Weight (g)</div>
                            <div className="w-16 text-center">Kcal</div>
                            <div className="w-16" />
                          </div>
                          {activeItems.map((item, itemIdx) => (
                            <div key={itemIdx} className="flex gap-2 items-center mb-2">
                              <select
                                value={item.name}
                                onChange={(e) => {
                                  const found = (FOOD_ITEMS[type] || []).find((fi) => fi.name === e.target.value);
                                  const copy = { ...createData };
                                  const updated = copy.choiceItems[activeChoiceForItems][type].map((it, i) =>
                                    i === itemIdx ? (found ? { name: found.name, weight: found.weight, calories: found.calories } : { name: "", weight: 0, calories: 0 }) : it
                                  );
                                  copy.choiceItems = [
                                    activeChoiceForItems === 0 ? { ...copy.choiceItems[0], [type]: updated } : copy.choiceItems[0],
                                    activeChoiceForItems === 1 ? { ...copy.choiceItems[1], [type]: updated } : copy.choiceItems[1],
                                  ];
                                  setCreateData(copy);
                                }}
                                className="flex-1 rounded border border-border bg-background px-2 py-1.5 text-sm"
                              >
                                <option value="">Select item…</option>
                                {(FOOD_ITEMS[type] || []).map((fi) => (
                                  <option key={fi.name} value={fi.name}>{fi.name}</option>
                                ))}
                              </select>
                              <div className="w-20 rounded border border-border bg-muted/30 px-2 py-1.5 text-sm text-center tabular-nums text-muted-foreground">
                                {item.weight > 0 ? `${item.weight}g` : "—"}
                              </div>
                              <div className="w-16 rounded border border-border bg-muted/30 px-2 py-1.5 text-sm text-center tabular-nums text-muted-foreground">
                                {item.calories > 0 ? item.calories : "—"}
                              </div>
                              <button
                                type="button"
                                className="w-16 text-right text-red-600 text-sm shrink-0"
                                onClick={() => {
                                  const copy = { ...createData };
                                  const updated = copy.choiceItems[activeChoiceForItems][type].filter((_, i) => i !== itemIdx);
                                  copy.choiceItems = [
                                    activeChoiceForItems === 0 ? { ...copy.choiceItems[0], [type]: updated } : copy.choiceItems[0],
                                    activeChoiceForItems === 1 ? { ...copy.choiceItems[1], [type]: updated } : copy.choiceItems[1],
                                  ];
                                  setCreateData(copy);
                                }}
                              >
                                × Remove
                              </button>
                            </div>
                          ))}
                          <button
                            type="button"
                            className="text-blue-600 text-sm mt-1"
                            onClick={() => {
                              const copy = { ...createData };
                              const existing = copy.choiceItems[activeChoiceForItems][type] || [];
                              const updated = [...existing, { name: "", weight: 0, calories: 0 }];
                              copy.choiceItems = [
                                activeChoiceForItems === 0 ? { ...copy.choiceItems[0], [type]: updated } : copy.choiceItems[0],
                                activeChoiceForItems === 1 ? { ...copy.choiceItems[1], [type]: updated } : copy.choiceItems[1],
                              ];
                              setCreateData(copy);
                            }}
                          >
                            + Add Item
                          </button>
                        </div>

                        {/* Both choices summary */}
                        <div className="grid grid-cols-2 gap-3">
                          {([0, 1] as const).map((cIdx) => {
                            const summaryItems = (createData.choiceItems[cIdx][type] || []).filter((it) => it.name.trim());
                            return (
                              <div key={cIdx} className={`rounded-md border p-2.5 text-xs ${cIdx === 0 ? "border-blue-200 bg-blue-50/40" : "border-teal-200 bg-teal-50/40"}`}>
                                <div className={`font-semibold mb-1.5 ${cIdx === 0 ? "text-blue-700" : "text-teal-700"}`}>
                                  CHOICE {cIdx === 0 ? "01" : "02"}
                                </div>
                                {summaryItems.length === 0 ? (
                                  <div className="text-muted-foreground italic">No items yet</div>
                                ) : summaryItems.map((it, i) => (
                                  <div key={i} className="py-0.5">
                                    <span className="font-medium">{it.name}</span>
                                    <span className="text-muted-foreground"> — {it.weight}g · {it.calories} kcal</span>
                                  </div>
                                ))}
                              </div>
                            );
                          })}
                        </div>

                        {/* Meal Percentage */}
                        <div className="rounded-lg border p-3 space-y-2">
                          <div className="font-semibold text-sm">Meal Percentage</div>
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <Label className="text-xs">Choice 01 %</Label>
                              <Input
                                type="number" min={0} max={100}
                                value={percs.c1}
                                onChange={(e) => {
                                  const v = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                                  setCreateData({ ...createData, choicePercentagesByType: { ...createData.choicePercentagesByType, [type]: { c1: v, c2: 100 - v } } });
                                }}
                                className="mt-1 h-8"
                              />
                            </div>
                            <div>
                              <Label className="text-xs">Choice 02 % (auto)</Label>
                              <Input type="number" value={percs.c2} readOnly className="mt-1 h-8 bg-muted/40" />
                            </div>
                          </div>
                          {totalPct !== 100 && (
                            <div className="text-xs text-destructive">Must total 100%. Currently: {totalPct}%</div>
                          )}
                        </div>

                        {/* Serving Time */}
                        <div className="rounded-lg border p-3 space-y-2">
                          <div className="font-semibold text-sm">Serving Time</div>
                          <div className="flex gap-3 items-center">
                            <Label className="text-xs shrink-0">Start</Label>
                            <Input
                              type="time"
                              value={createData.servingTimes[type]?.start ?? (type === "Breakfast" ? "07:00" : type === "Lunch" ? "11:00" : type === "Snacks" ? "14:00" : type === "Heavy Snacks" ? "16:00" : "19:00")}
                              onChange={(e) => setCreateData({ ...createData, servingTimes: { ...createData.servingTimes, [type]: { ...(createData.servingTimes[type] || {}), start: e.target.value } } })}
                              className="h-8 w-32"
                            />
                            <Label className="text-xs shrink-0">End</Label>
                            <Input
                              type="time"
                              value={createData.servingTimes[type]?.end ?? (type === "Breakfast" ? "10:00" : type === "Lunch" ? "14:00" : type === "Snacks" ? "16:00" : type === "Heavy Snacks" ? "19:00" : "22:00")}
                              onChange={(e) => setCreateData({ ...createData, servingTimes: { ...createData.servingTimes, [type]: { ...(createData.servingTimes[type] || {}), end: e.target.value } } })}
                              className="h-8 w-32"
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {/* ── Special Meals Panel ── */}
                  {activeMealTab === "special-meals" && (
                    <div className="space-y-3">
                      {createData.mealTypes.length === 0 ? (
                        <div className="text-sm text-muted-foreground text-center py-8 border rounded-lg bg-muted/20">
                          Enable meal types first to configure special meals
                        </div>
                      ) : (
                        createData.mealTypes.map((type) => (
                          <div key={type} className="rounded-lg border p-3 space-y-2">
                            <div className="font-semibold text-sm border-b pb-2">{type}</div>

                            {(createData.specialMealsByType[type] || []).map((sel, smIdx) => (
                              <div key={sel.code} className="rounded-lg border border-purple-200 p-3 space-y-2 bg-purple-50/40">
                                <div className="flex items-start justify-between">
                                  <div className="space-y-1">
                                    <div>
                                      <span className="text-sm font-semibold text-purple-800">{sel.code}</span>
                                      <span className="text-xs text-muted-foreground ml-2">— {SPECIAL_MEAL_INFO[sel.code]?.label}</span>
                                    </div>
                                    <div className="flex items-center gap-2 text-xs">
                                      <span className="text-muted-foreground">Portions:</span>
                                      {sel.portions === "As per demand" ? (
                                        <span className="font-medium">As Per Demand</span>
                                      ) : (
                                        <Input
                                          type="number"
                                          min={1}
                                          value={sel.portions as number}
                                          onChange={(e) => {
                                            const updatedSMs = (createData.specialMealsByType[type] || []).map((sm, si) =>
                                              si === smIdx ? { ...sm, portions: Number(e.target.value) } : sm
                                            );
                                            setCreateData({ ...createData, specialMealsByType: { ...createData.specialMealsByType, [type]: updatedSMs } });
                                          }}
                                          className="h-6 w-16 text-xs"
                                        />
                                      )}
                                      <label className="flex items-center gap-1 cursor-pointer">
                                        <input
                                          type="checkbox"
                                          checked={sel.portions === "As per demand"}
                                          onChange={(e) => {
                                            const updatedSMs = (createData.specialMealsByType[type] || []).map((sm, si) =>
                                              si === smIdx ? { ...sm, portions: e.target.checked ? "As per demand" : 1 } : sm
                                            );
                                            setCreateData({ ...createData, specialMealsByType: { ...createData.specialMealsByType, [type]: updatedSMs } });
                                          }}
                                          className="h-3 w-3"
                                        />
                                        <span>As Per Demand</span>
                                      </label>
                                    </div>
                                  </div>
                                  <button type="button" className="text-red-500 text-xs hover:text-red-700"
                                    onClick={() => setCreateData({ ...createData, specialMealsByType: { ...createData.specialMealsByType, [type]: (createData.specialMealsByType[type] || []).filter((_, i) => i !== smIdx) } })}>
                                    × Remove
                                  </button>
                                </div>
                                <div className="flex gap-2 items-center text-xs font-semibold text-muted-foreground border-b pb-1">
                                  <div className="flex-1">Item</div>
                                  <div className="w-20 text-center">Weight (g)</div>
                                  <div className="w-16 text-center">Kcal</div>
                                  <div className="w-16" />
                                </div>
                                {(sel.items || []).map((item, itemIdx) => (
                                  <div key={itemIdx} className="flex gap-2 items-center">
                                    <select
                                      value={item.name}
                                      onChange={(e) => {
                                        const found = (FOOD_ITEMS[type] || []).find((fi) => fi.name === e.target.value);
                                        const copy = { ...createData };
                                        const updatedSMs = (copy.specialMealsByType[type] || []).map((sm, si) =>
                                          si === smIdx ? { ...sm, items: (sm.items || []).map((it, ii) => ii === itemIdx ? (found ? { name: found.name, weight: found.weight, calories: found.calories } : { name: "", weight: 0, calories: 0 }) : it) } : sm
                                        );
                                        copy.specialMealsByType = { ...copy.specialMealsByType, [type]: updatedSMs };
                                        setCreateData(copy);
                                      }}
                                      className="flex-1 rounded border border-border bg-background px-2 py-1.5 text-sm"
                                    >
                                      <option value="">Select item…</option>
                                      {(FOOD_ITEMS[type] || []).map((fi) => (
                                        <option key={fi.name} value={fi.name}>{fi.name}</option>
                                      ))}
                                    </select>
                                    <div className="w-20 rounded border border-border bg-muted/30 px-2 py-1.5 text-sm text-center tabular-nums text-muted-foreground">
                                      {item.weight > 0 ? `${item.weight}g` : "—"}
                                    </div>
                                    <div className="w-16 rounded border border-border bg-muted/30 px-2 py-1.5 text-sm text-center tabular-nums text-muted-foreground">
                                      {item.calories > 0 ? item.calories : "—"}
                                    </div>
                                    <button
                                      type="button"
                                      className="w-16 text-right text-red-600 text-sm shrink-0"
                                      onClick={() => {
                                        const copy = { ...createData };
                                        const updatedSMs = (copy.specialMealsByType[type] || []).map((sm, si) =>
                                          si === smIdx ? { ...sm, items: (sm.items || []).filter((_, ii) => ii !== itemIdx) } : sm
                                        );
                                        copy.specialMealsByType = { ...copy.specialMealsByType, [type]: updatedSMs };
                                        setCreateData(copy);
                                      }}
                                    >
                                      × Remove
                                    </button>
                                  </div>
                                ))}
                                <button
                                  type="button"
                                  className="text-blue-600 text-sm"
                                  onClick={() => {
                                    const copy = { ...createData };
                                    const updatedSMs = (copy.specialMealsByType[type] || []).map((sm, si) =>
                                      si === smIdx ? { ...sm, items: [...(sm.items || []), { name: "", weight: 0, calories: 0 }] } : sm
                                    );
                                    copy.specialMealsByType = { ...copy.specialMealsByType, [type]: updatedSMs };
                                    setCreateData(copy);
                                  }}
                                >
                                  + Add Item
                                </button>
                              </div>
                            ))}

                            {pendingSpecialMeal !== null && pendingSpecialMealForType === type ? (
                              <div className="border rounded-lg p-3 space-y-3 bg-muted/20">
                                <div>
                                  <Label className="text-xs">Select Special Meal</Label>
                                  <select
                                    value={pendingSpecialMeal.code}
                                    onChange={(e) => setPendingSpecialMeal({ ...pendingSpecialMeal, code: e.target.value })}
                                    className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
                                  >
                                    <option value="">Choose special meal type…</option>
                                    {Object.values(SPECIAL_MEAL_INFO)
                                      .filter((info) => !(createData.specialMealsByType[type] || []).some((s) => s.code === info.code))
                                      .map((info) => (
                                        <option key={info.code} value={info.code}>{info.code} — {info.label}</option>
                                      ))}
                                  </select>
                                </div>
                                {pendingSpecialMeal.code && SPECIAL_MEAL_INFO[pendingSpecialMeal.code] && (
                                  <>
                                    <div className="text-xs italic px-2 py-1.5 bg-blue-50 rounded border border-blue-100 text-blue-800">
                                      {SPECIAL_MEAL_INFO[pendingSpecialMeal.code].note}
                                    </div>
                                    <div className="grid grid-cols-2 gap-3 text-xs">
                                      <div>
                                        <div className="font-semibold text-green-700 mb-1">✓ Allowed</div>
                                        <ul className="space-y-0.5">
                                          {SPECIAL_MEAL_INFO[pendingSpecialMeal.code].allowed.map((itm) => (
                                            <li key={itm} className="text-green-700">• {itm}</li>
                                          ))}
                                        </ul>
                                      </div>
                                      <div>
                                        <div className="font-semibold text-red-700 mb-1">✗ Not Allowed</div>
                                        <ul className="space-y-0.5">
                                          {SPECIAL_MEAL_INFO[pendingSpecialMeal.code].notAllowed.map((itm) => (
                                            <li key={itm} className="text-red-600">• {itm}</li>
                                          ))}
                                        </ul>
                                      </div>
                                    </div>
                                    <div>
                                      <Label className="text-xs">Number of Portions</Label>
                                      <div className="flex items-center gap-3 mt-1">
                                        <Input
                                          type="number"
                                          min={1}
                                          value={pendingSpecialMeal.portions === "As per demand" ? "" : pendingSpecialMeal.portions as number}
                                          onChange={(e) => setPendingSpecialMeal({ ...pendingSpecialMeal, portions: Number(e.target.value) })}
                                          className="h-8 text-sm w-28"
                                          disabled={pendingSpecialMeal.portions === "As per demand"}
                                          placeholder="Qty"
                                        />
                                        <label className="flex items-center gap-1.5 cursor-pointer text-xs">
                                          <input
                                            type="checkbox"
                                            checked={pendingSpecialMeal.portions === "As per demand"}
                                            onChange={(e) => setPendingSpecialMeal({ ...pendingSpecialMeal, portions: e.target.checked ? "As per demand" : 1 })}
                                            className="h-3.5 w-3.5"
                                          />
                                          As Per Demand
                                        </label>
                                      </div>
                                    </div>
                                    <div>
                                      <Label className="text-xs mb-2 block">Items</Label>
                                      <div className="flex gap-2 items-center text-xs font-semibold text-muted-foreground border-b pb-1 mb-2">
                                        <div className="flex-1">Item</div>
                                        <div className="w-20 text-center">Weight (g)</div>
                                        <div className="w-16 text-center">Kcal</div>
                                        <div className="w-16" />
                                      </div>
                                      {(pendingSpecialMeal.items || []).map((item, itemIdx) => (
                                        <div key={itemIdx} className="flex gap-2 items-center mb-2">
                                          <select
                                            value={item.name}
                                            onChange={(e) => {
                                              const found = (FOOD_ITEMS[type] || []).find((fi) => fi.name === e.target.value);
                                              setPendingSpecialMeal({
                                                ...pendingSpecialMeal,
                                                items: (pendingSpecialMeal.items || []).map((it, ii) =>
                                                  ii === itemIdx ? (found ? { name: found.name, weight: found.weight, calories: found.calories } : { name: "", weight: 0, calories: 0 }) : it
                                                ),
                                              });
                                            }}
                                            className="flex-1 rounded border border-border bg-background px-2 py-1.5 text-sm"
                                          >
                                            <option value="">Select item…</option>
                                            {(FOOD_ITEMS[type] || []).map((fi) => (
                                              <option key={fi.name} value={fi.name}>{fi.name}</option>
                                            ))}
                                          </select>
                                          <div className="w-20 rounded border border-border bg-muted/30 px-2 py-1.5 text-sm text-center tabular-nums text-muted-foreground">
                                            {item.weight > 0 ? `${item.weight}g` : "—"}
                                          </div>
                                          <div className="w-16 rounded border border-border bg-muted/30 px-2 py-1.5 text-sm text-center tabular-nums text-muted-foreground">
                                            {item.calories > 0 ? item.calories : "—"}
                                          </div>
                                          <button
                                            type="button"
                                            className="w-16 text-right text-red-600 text-sm shrink-0"
                                            onClick={() => setPendingSpecialMeal({ ...pendingSpecialMeal, items: (pendingSpecialMeal.items || []).filter((_, ii) => ii !== itemIdx) })}
                                          >
                                            × Remove
                                          </button>
                                        </div>
                                      ))}
                                      <button
                                        type="button"
                                        className="text-blue-600 text-sm"
                                        onClick={() => setPendingSpecialMeal({ ...pendingSpecialMeal, items: [...(pendingSpecialMeal.items || []), { name: "", weight: 0, calories: 0 }] })}
                                      >
                                        + Add Item
                                      </button>
                                    </div>
                                    <div className="flex gap-2 justify-end pt-2">
                                      <Button type="button" size="sm" className="h-8"
                                        onClick={() => {
                                          if (!pendingSpecialMeal.code) return;
                                          setCreateData({ ...createData, specialMealsByType: { ...createData.specialMealsByType, [type]: [...(createData.specialMealsByType[type] || []), { code: pendingSpecialMeal.code, portions: pendingSpecialMeal.portions, items: pendingSpecialMeal.items || [] }] } });
                                          setPendingSpecialMeal(null);
                                          setPendingSpecialMealForType(null);
                                        }}>
                                        Done
                                      </Button>
                                      <Button type="button" variant="outline" size="sm" className="h-8"
                                        onClick={() => { setPendingSpecialMeal(null); setPendingSpecialMealForType(null); }}>
                                        Cancel
                                      </Button>
                                    </div>
                                  </>
                                )}
                              </div>
                            ) : (
                              (pendingSpecialMeal === null || pendingSpecialMealForType !== type) && (
                                <button type="button" className="text-blue-600 text-sm"
                                  onClick={() => { setPendingSpecialMeal({ code: "", portions: 1, items: [] }); setPendingSpecialMealForType(type); }}>
                                  + Add Special Meal
                                </button>
                              )
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  )}

                  {/* ── Dessert Panel ── */}
                  {activeMealTab === "dessert" && (
                    <div className="space-y-3">
                      {createData.mealTypes.length === 0 ? (
                        <div className="text-sm text-muted-foreground text-center py-4 border rounded-lg bg-muted/20">
                          Enable meal types to configure dessert
                        </div>
                      ) : (
                        createData.mealTypes.map((type) => {
                          const dessertItems = createData.dessertByType[type] || [];
                          return (
                            <div key={type} className="rounded-lg border p-3 space-y-2">
                              <div className="font-semibold text-sm">{type}</div>
                              {dessertItems.map((dItem, idx) => (
                                <div key={idx} className="flex gap-2 items-center">
                                  <select
                                    value={dItem.name}
                                    onChange={(e) => {
                                      const found = DESSERT_ITEMS.find((d) => d.name === e.target.value);
                                      const copy = { ...createData };
                                      copy.dessertByType = {
                                        ...copy.dessertByType,
                                        [type]: copy.dessertByType[type].map((it, i) =>
                                          i === idx ? (found ? { name: found.name, weight: found.weight, calories: found.calories } : { name: "", weight: 0, calories: 0 }) : it
                                        ),
                                      };
                                      setCreateData(copy);
                                    }}
                                    className="flex-1 rounded border border-border bg-background px-2 py-1.5 text-sm"
                                  >
                                    <option value="">Select dessert…</option>
                                    {DESSERT_ITEMS.map((d) => (
                                      <option key={d.name} value={d.name}>{d.name}</option>
                                    ))}
                                  </select>
                                  {dItem.name && (
                                    <div className="text-xs text-muted-foreground whitespace-nowrap">
                                      {dItem.weight}g · {dItem.calories} kcal
                                    </div>
                                  )}
                                  <div className="flex items-center gap-1 shrink-0">
                                    <Input
                                      type="number"
                                      min={1}
                                      max={100}
                                      value={(createData.dessertAllocationByType[type] || [])[idx] ?? 100}
                                      onChange={(e) => {
                                        const copy = { ...createData };
                                        const arr = [...(copy.dessertAllocationByType[type] || [])];
                                        arr[idx] = Number(e.target.value);
                                        copy.dessertAllocationByType = { ...copy.dessertAllocationByType, [type]: arr };
                                        setCreateData(copy);
                                      }}
                                      className="w-16 h-7 text-xs"
                                    />
                                    <span className="text-xs text-muted-foreground">%</span>
                                  </div>
                                  <button
                                    type="button"
                                    className="text-red-500 text-sm shrink-0"
                                    onClick={() => {
                                      const copy = { ...createData };
                                      copy.dessertByType = { ...copy.dessertByType, [type]: copy.dessertByType[type].filter((_, i) => i !== idx) };
                                      copy.dessertAllocationByType = { ...copy.dessertAllocationByType, [type]: (copy.dessertAllocationByType[type] || []).filter((_, i) => i !== idx) };
                                      setCreateData(copy);
                                    }}
                                  >
                                    × Remove
                                  </button>
                                </div>
                              ))}
                              <button
                                type="button"
                                className="text-blue-600 text-sm"
                                onClick={() => {
                                  const copy = { ...createData };
                                  copy.dessertByType = { ...copy.dessertByType, [type]: [...(copy.dessertByType[type] || []), { name: "", weight: 0, calories: 0 }] };
                                  copy.dessertAllocationByType = { ...copy.dessertAllocationByType, [type]: [...(copy.dessertAllocationByType[type] || []), 100] };
                                  setCreateData(copy);
                                }}
                              >
                                + Add Item
                              </button>
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              </div>

              {createErrors.length > 0 && (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive space-y-0.5 mt-2">
                  {createErrors.map((e, i) => <div key={i}>• {e}</div>)}
                </div>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={() => setPreviewOpen(true)}>Preview</Button>
                <Button onClick={handleCreateSave}>Save Meal Configuration</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      {/* Preview Modal */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Meal Configuration Preview</DialogTitle>
          </DialogHeader>
          <div className="space-y-6">
            {createData.mealTypes.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">No meal types selected yet.</div>
            ) : (
              createData.mealTypes.map((mealType) => (
                <div key={mealType} className="space-y-3">
                  <div className="text-base font-semibold border-b pb-2">{mealType}</div>
                  <div className="flex gap-3 flex-wrap">
                    {/* CHOICE 1 */}
                    {(() => {
                      const items1 = (createData.choiceItems[0][mealType] || []).filter((it) => it.name.trim());
                      const c1pct = createData.choicePercentagesByType[mealType]?.c1 ?? 60;
                      return (
                        <div className="rounded-lg border border-blue-200 w-52 shrink-0">
                          <div className="px-3 py-2 rounded-t-lg font-semibold text-xs bg-blue-100 text-blue-800">
                            CHOICE 1 — {c1pct}%
                          </div>
                          <div className="p-3 space-y-1">
                            {items1.length === 0 ? (
                              <div className="text-xs text-muted-foreground italic">No items configured</div>
                            ) : items1.map((it, i) => (
                              <div key={i} className="text-xs">
                                <span className="font-medium">{it.name}</span>
                                {it.weight > 0 && <span className="text-muted-foreground"> – {it.weight}g</span>}
                                {it.calories > 0 && <span className="text-muted-foreground"> · {it.calories} kcal</span>}
                              </div>
                            ))}
                            {items1.length > 0 && (
                              <div className="text-xs font-semibold border-t pt-1 mt-1">
                                Total: {items1.reduce((s, it) => s + (it.calories || 0), 0)} kcal
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()}

                    {/* CHOICE 2 */}
                    {(() => {
                      const items2 = (createData.choiceItems[1][mealType] || []).filter((it) => it.name.trim());
                      const c2pct = createData.choicePercentagesByType[mealType]?.c2 ?? 40;
                      return (
                        <div className="rounded-lg border border-teal-200 w-52 shrink-0">
                          <div className="px-3 py-2 rounded-t-lg font-semibold text-xs bg-teal-100 text-teal-800">
                            CHOICE 2 — {c2pct}%
                          </div>
                          <div className="p-3 space-y-1">
                            {items2.length === 0 ? (
                              <div className="text-xs text-muted-foreground italic">No items configured</div>
                            ) : items2.map((it, i) => (
                              <div key={i} className="text-xs">
                                <span className="font-medium">{it.name}</span>
                                {it.weight > 0 && <span className="text-muted-foreground"> – {it.weight}g</span>}
                                {it.calories > 0 && <span className="text-muted-foreground"> · {it.calories} kcal</span>}
                              </div>
                            ))}
                            {items2.length > 0 && (
                              <div className="text-xs font-semibold border-t pt-1 mt-1">
                                Total: {items2.reduce((s, it) => s + (it.calories || 0), 0)} kcal
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Special meal cards */}
                    {(createData.specialMealsByType[mealType] || []).map((sel) => (
                      <div key={sel.code} className="rounded-lg border border-purple-200 w-52 shrink-0">
                        <div className="px-3 py-2 rounded-t-lg font-semibold text-xs bg-purple-100 text-purple-800">
                          {sel.code} — {sel.portions} portion{sel.portions !== 1 ? "s" : ""}
                        </div>
                        <div className="p-3 space-y-1">
                          <div className="text-xs font-medium">{SPECIAL_MEAL_INFO[sel.code]?.label}</div>
                          <div className="text-xs text-muted-foreground italic">{SPECIAL_MEAL_INFO[sel.code]?.note}</div>
                        </div>
                      </div>
                    ))}

                    {/* Dessert card */}
                    {(() => {
                      const allDItems = createData.dessertByType[mealType] || [];
                      const dItems = allDItems.map((it, i) => ({ ...it, allocation: (createData.dessertAllocationByType[mealType] || [])[i] ?? 100 })).filter((it) => it.name.trim());
                      if (dItems.length === 0) return null;
                      return (
                        <div className="rounded-lg border border-pink-200 w-52 shrink-0">
                          <div className="px-3 py-2 rounded-t-lg font-semibold text-xs bg-pink-100 text-pink-800">
                            Dessert
                          </div>
                          <div className="p-3 space-y-1">
                            {dItems.map((it, i) => (
                              <div key={i} className="text-xs">
                                <span className="font-medium">{it.name}</span>
                                {it.weight > 0 && <span className="text-muted-foreground"> – {it.weight}g</span>}
                                {it.calories > 0 && <span className="text-muted-foreground"> · {it.calories} kcal</span>}
                                <span className="text-muted-foreground"> [{it.allocation}%]</span>
                              </div>
                            ))}
                            <div className="text-xs font-semibold border-t pt-1 mt-1">
                              Total: {dItems.reduce((s, it) => s + (it.calories || 0), 0)} kcal
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              ))
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setPreviewOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* GM Order Banner - State A: Pending */}
      {forwardCycle === "pending" && (
        <Alert className="bg-blue-50 border-blue-200 mb-6">
          <Info className="h-4 w-4 text-blue-600" />
          <AlertDescription className="text-sm text-blue-900 flex items-center justify-between">
            <span>
              📋 GM Order Received — Total meals required today: {gmOrderData.totalMealsToday.toLocaleString()} | 96-hour window meals: {gmOrderData.totalMeals96h.toLocaleString()} | Flight: {gmOrderData.flightNumber} {gmOrderData.route}
            </span>
            <Button
              size="sm"
              onClick={() => setOrderDetailsOpen(true)}
            >
              Tag & Forward to Production
            </Button>

            <Dialog open={orderDetailsOpen} onOpenChange={(o) => { setOrderDetailsOpen(o); if (!o) setOrderEditMode(false); }}>
              <DialogContent className="max-w-3xl">
                <DialogHeader>
                  <DialogTitle>GM Order Details — {selectedDay}</DialogTitle>
                </DialogHeader>
                <h3 className="text-sm font-semibold tracking-wider uppercase text-foreground">
                  Meal Order Summary — Next 24 Hours
                  <span className="ml-2 text-xs font-normal normal-case tracking-normal text-muted-foreground">{editableSummary.importDate}</span>
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* International column */}
                  <div className="rounded-lg border border-navy/20 bg-navy/5 p-4 space-y-4">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-navy">International</h4>
                    <div className="space-y-1.5">
                      <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Departure</div>
                      <div className="flex justify-between text-sm items-center">
                        <span className="text-muted-foreground">Total Departure Meal</span>
                        {orderEditMode ? (
                          <Input type="number" min={0} value={editableSummary.intl.depMeal}
                            onChange={(e) => setEditableSummary((p) => ({ ...p, intl: { ...p.intl, depMeal: Number(e.target.value) } }))}
                            className="h-7 w-20 text-sm text-right" />
                        ) : <span className="font-medium tabular-nums">{editableSummary.intl.depMeal}</span>}
                      </div>
                      <div className="flex justify-between text-sm items-center">
                        <span className="text-muted-foreground">Departure CHML</span>
                        {orderEditMode ? (
                          <Input type="number" min={0} value={editableSummary.intl.depChml}
                            onChange={(e) => setEditableSummary((p) => ({ ...p, intl: { ...p.intl, depChml: Number(e.target.value) } }))}
                            className="h-7 w-20 text-sm text-right" />
                        ) : <span className="font-medium tabular-nums">{editableSummary.intl.depChml}</span>}
                      </div>
                      <div className="flex justify-between text-sm font-semibold border-t border-navy/20 pt-1">
                        <span>Departure Total</span>
                        <span className="tabular-nums">{editableSummary.intl.depMeal + editableSummary.intl.depChml}</span>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Return</div>
                      <div className="flex justify-between text-sm items-center">
                        <span className="text-muted-foreground">Total Return Meal</span>
                        {orderEditMode ? (
                          <Input type="number" min={0} value={editableSummary.intl.retMeal}
                            onChange={(e) => setEditableSummary((p) => ({ ...p, intl: { ...p.intl, retMeal: Number(e.target.value) } }))}
                            className="h-7 w-20 text-sm text-right" />
                        ) : <span className="font-medium tabular-nums">{editableSummary.intl.retMeal}</span>}
                      </div>
                      <div className="flex justify-between text-sm items-center">
                        <span className="text-muted-foreground">Return CHML</span>
                        {orderEditMode ? (
                          <Input type="number" min={0} value={editableSummary.intl.retChml}
                            onChange={(e) => setEditableSummary((p) => ({ ...p, intl: { ...p.intl, retChml: Number(e.target.value) } }))}
                            className="h-7 w-20 text-sm text-right" />
                        ) : <span className="font-medium tabular-nums">{editableSummary.intl.retChml}</span>}
                      </div>
                      <div className="flex justify-between text-sm items-center">
                        <span className="text-muted-foreground">Return VGML</span>
                        {orderEditMode ? (
                          <Input type="number" min={0} value={editableSummary.intl.retVgml}
                            onChange={(e) => setEditableSummary((p) => ({ ...p, intl: { ...p.intl, retVgml: Number(e.target.value) } }))}
                            className="h-7 w-20 text-sm text-right" />
                        ) : <span className="font-medium tabular-nums">{editableSummary.intl.retVgml}</span>}
                      </div>
                      <div className="flex justify-between text-sm font-semibold border-t border-navy/20 pt-1">
                        <span>Return Total</span>
                        <span className="tabular-nums">{editableSummary.intl.retMeal + editableSummary.intl.retChml + editableSummary.intl.retVgml}</span>
                      </div>
                    </div>
                    <div className="flex justify-between text-sm font-bold border-t-2 border-navy/30 pt-2 mt-1">
                      <span>Total Meal (Departure+Return)</span>
                      <span className="tabular-nums">{editableSummary.intl.depMeal + editableSummary.intl.depChml + editableSummary.intl.retMeal + editableSummary.intl.retChml + editableSummary.intl.retVgml}</span>
                    </div>
                  </div>
                  {/* Domestic column */}
                  <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-4">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-primary">Domestic</h4>
                    <div className="space-y-1.5">
                      <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">US-Bangla</div>
                      <div className="flex justify-between text-sm items-center">
                        <span className="text-muted-foreground">Zenith Load</span>
                        {orderEditMode ? (
                          <Input type="number" min={0} value={editableSummary.dom.usba.zenith}
                            onChange={(e) => setEditableSummary((p) => ({ ...p, dom: { ...p.dom, usba: { ...p.dom.usba, zenith: Number(e.target.value) } } }))}
                            className="h-7 w-20 text-sm text-right" />
                        ) : <span className="font-medium tabular-nums">{editableSummary.dom.usba.zenith}</span>}
                      </div>
                      <div className="flex justify-between text-sm items-center">
                        <span className="text-muted-foreground">Pax Load</span>
                        {orderEditMode ? (
                          <Input type="number" min={0} value={editableSummary.dom.usba.pax}
                            onChange={(e) => setEditableSummary((p) => ({ ...p, dom: { ...p.dom, usba: { ...p.dom.usba, pax: Number(e.target.value) } } }))}
                            className="h-7 w-20 text-sm text-right" />
                        ) : <span className="font-medium tabular-nums">{editableSummary.dom.usba.pax}</span>}
                      </div>
                      <div className="flex justify-between text-sm items-center">
                        <span className="text-muted-foreground">Breakfast (JBR + CKN Buggati)</span>
                        {orderEditMode ? (
                          <Input type="number" min={0} value={editableSummary.dom.usba.breakfast}
                            onChange={(e) => setEditableSummary((p) => ({ ...p, dom: { ...p.dom, usba: { ...p.dom.usba, breakfast: Number(e.target.value) } } }))}
                            className="h-7 w-20 text-sm text-right" />
                        ) : <span className="font-medium tabular-nums">{editableSummary.dom.usba.breakfast}</span>}
                      </div>
                      <div className="flex justify-between text-sm items-center">
                        <span className="text-muted-foreground">Lunch</span>
                        {orderEditMode ? (
                          <Input type="number" min={0} value={editableSummary.dom.usba.lunch}
                            onChange={(e) => setEditableSummary((p) => ({ ...p, dom: { ...p.dom, usba: { ...p.dom.usba, lunch: Number(e.target.value) } } }))}
                            className="h-7 w-20 text-sm text-right" />
                        ) : <span className="font-medium tabular-nums">{editableSummary.dom.usba.lunch}</span>}
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Air Astra</div>
                      <div className="flex justify-between text-sm items-center">
                        <span className="text-muted-foreground">Zenith Load</span>
                        {orderEditMode ? (
                          <Input type="number" min={0} value={editableSummary.dom.aaa.zenith}
                            onChange={(e) => setEditableSummary((p) => ({ ...p, dom: { ...p.dom, aaa: { ...p.dom.aaa, zenith: Number(e.target.value) } } }))}
                            className="h-7 w-20 text-sm text-right" />
                        ) : <span className="font-medium tabular-nums">{editableSummary.dom.aaa.zenith}</span>}
                      </div>
                      <div className="flex justify-between text-sm items-center">
                        <span className="text-muted-foreground">Pax Load</span>
                        {orderEditMode ? (
                          <Input type="number" min={0} value={editableSummary.dom.aaa.pax}
                            onChange={(e) => setEditableSummary((p) => ({ ...p, dom: { ...p.dom, aaa: { ...p.dom.aaa, pax: Number(e.target.value) } } }))}
                            className="h-7 w-20 text-sm text-right" />
                        ) : <span className="font-medium tabular-nums">{editableSummary.dom.aaa.pax}</span>}
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Crew Meals</div>
                      <div className="flex justify-between text-sm items-center">
                        <span className="text-muted-foreground">H. Snacks</span>
                        {orderEditMode ? (
                          <Input type="number" min={0} value={editableSummary.dom.crew.hSnacks}
                            onChange={(e) => setEditableSummary((p) => ({ ...p, dom: { ...p.dom, crew: { ...p.dom.crew, hSnacks: Number(e.target.value) } } }))}
                            className="h-7 w-20 text-sm text-right" />
                        ) : <span className="font-medium tabular-nums">{editableSummary.dom.crew.hSnacks}</span>}
                      </div>
                      <div className="flex justify-between text-sm items-center">
                        <span className="text-muted-foreground">Lunch</span>
                        {orderEditMode ? (
                          <Input type="number" min={0} value={editableSummary.dom.crew.lunch}
                            onChange={(e) => setEditableSummary((p) => ({ ...p, dom: { ...p.dom, crew: { ...p.dom.crew, lunch: Number(e.target.value) } } }))}
                            className="h-7 w-20 text-sm text-right" />
                        ) : <span className="font-medium tabular-nums">{editableSummary.dom.crew.lunch}</span>}
                      </div>
                      <div className="flex justify-between text-sm items-center">
                        <span className="text-muted-foreground">Dinner</span>
                        {orderEditMode ? (
                          <Input type="number" min={0} value={editableSummary.dom.crew.dinner}
                            onChange={(e) => setEditableSummary((p) => ({ ...p, dom: { ...p.dom, crew: { ...p.dom.crew, dinner: Number(e.target.value) } } }))}
                            className="h-7 w-20 text-sm text-right" />
                        ) : <span className="font-medium tabular-nums">{editableSummary.dom.crew.dinner}</span>}
                      </div>
                    </div>
                    <div className="flex justify-between text-sm font-semibold border-t border-primary/20 pt-2">
                      <span>Total Zenith (USBA + Air Astra)</span>
                      <span className="tabular-nums">{editableSummary.dom.usba.zenith + editableSummary.dom.aaa.zenith}</span>
                    </div>
                  </div>
                </div>
                {orderEditLog && (
                  <div className="mt-1 text-xs text-muted-foreground border-t pt-2">
                    Meal Order edited by {orderEditLog.name}, {orderEditLog.date}, {orderEditLog.time}
                  </div>
                )}
                <DialogFooter>
                  <Button variant="outline" onClick={() => { setOrderDetailsOpen(false); setOrderEditMode(false); }}>Close</Button>
                  {orderEditMode ? (
                    <>
                      <Button variant="outline" onClick={() => setOrderEditMode(false)}>Cancel</Button>
                      <Button onClick={() => {
                        const now = new Date();
                        const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
                        const dateStr = `${String(now.getDate()).padStart(2,"0")} ${months[now.getMonth()]} ${now.getFullYear()}`;
                        const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
                        setOrderEditLog({ name: "Current User", date: dateStr, time: timeStr });
                        setOrderEditMode(false);
                        toast.success("Meal order updated.");
                      }}>Save Changes</Button>
                    </>
                  ) : (
                    <>
                      <Button variant="outline" onClick={() => setOrderEditMode(true)}>Edit</Button>
                      <Button onClick={() => { setOrderDetailsOpen(false); setDaySelectionOpen(true); setPendingDay(selectedDay); }}>Tag Meal</Button>
                    </>
                  )}
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </AlertDescription>
        </Alert>
      )}

      {/* GM Order Banner - State B: Forwarded */}
      {forwardCycle === "forwarded" && (
        <Alert className="bg-green-50 border-green-200 mb-6">
          <Info className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-sm text-green-900">
            <div className="flex items-center justify-between">
              <div>
                <div>Total: {lastForwardedQuantity.toLocaleString()} meal orders forwarded to Production for next 24 hours schedule</div>
                {tagLog && (
                  <div className="text-xs text-green-800 mt-1">
                    Meal order has been generated for next 24 hours by {tagLog.name}, {tagLog.date}, {tagLog.time}
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <Button size="sm" disabled className="bg-green-600 hover:bg-green-600">
                  Forwarded ✓
                </Button>
                <Button size="sm" variant="outline" onClick={() => setHistoryModalOpen(true)}>
                  View History
                </Button>
              </div>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* GM Order Banner - State C: Ready for next order */}
      {forwardCycle === "ready" && (
        <Alert className="bg-amber-50 border-amber-200 mb-6">
          <Info className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-sm text-amber-900 flex items-center justify-between">
            <div>
              <div>📋 Place meal order for next 24-hour cycle</div>
              <div className="text-amber-700 text-xs mt-1">Order meal for {formatDateDDMMMYYYY(getNextDate())}</div>
            </div>
            <Button size="sm" onClick={() => setOrderModalOpen(true)}>
              Order Meal
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Order Meal Modal - State C */}
      <Dialog open={orderModalOpen} onOpenChange={setOrderModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Place Meal Order — {formatDateDDMMMYYYY(getNextDate())}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="p-3 bg-muted/50 rounded border">
              <div className="text-xs text-muted-foreground">
                <div>Last 24 hours — meals ordered: {lastForwardedQuantity.toLocaleString()}</div>
                {forwardedAt && (
                  <div>
                    Forwarded by: Current User | Meal Planner | {forwardedAt.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" })} {forwardedAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: true })}
                  </div>
                )}
              </div>
            </div>

            <div>
              <Label>Enter order quantity for next 24 hours:</Label>
              <Input
                type="number"
                min="1"
                value={orderModalQuantity}
                onChange={(e) => {
                  setOrderModalQuantity(e.target.value);
                  setOrderModalError("");
                }}
                className={orderModalError ? "border-red-600" : ""}
              />
              {orderModalError && <div className="text-red-600 text-xs mt-1">{orderModalError}</div>}
            </div>

            <div>
              <Label>Notes (optional)</Label>
              <Textarea placeholder="Any special instructions..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setOrderModalOpen(false);
              setOrderModalQuantity("");
              setOrderModalError("");
            }}>
              Cancel
            </Button>
            <Button onClick={() => {
              if (!orderModalQuantity || Number(orderModalQuantity) <= 0) {
                setOrderModalError("Please enter quantity");
                return;
              }
              const qty = Number(orderModalQuantity);
              setLastForwardedQuantity(qty);
              setForwardCycle("forwarded");
              setForwardedAt(new Date());
              const now = new Date();
              const todayFormatted = now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
              const timeFormatted = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: true });
              setOrderHistory([...orderHistory, { mealsOrdered: qty, orderedBy: "Current User", designation: "Meal Planner", date: todayFormatted, time: timeFormatted, period: "24-hour cycle" }]);
              setOrderModalOpen(false);
              setOrderModalQuantity("");
              toast.success("Meal order forwarded to Meal Planner successfully");
            }}>
              Forward to Meal Planner
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Meal Order History Modal */}
      <Dialog open={historyModalOpen} onOpenChange={setHistoryModalOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Meal Order History</DialogTitle>
          </DialogHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2">#</th>
                  <th className="text-left py-2">Meals Ordered</th>
                  <th className="text-left py-2">Ordered By</th>
                  <th className="text-left py-2">Designation</th>
                  <th className="text-left py-2">Date</th>
                  <th className="text-left py-2">Time</th>
                  <th className="text-left py-2">Order Period</th>
                </tr>
              </thead>
              <tbody>
                {orderHistory.map((entry, idx) => (
                  <tr key={idx} className="border-b">
                    <td className="py-2">{idx + 1}</td>
                    <td className="py-2">{entry.mealsOrdered.toLocaleString()}</td>
                    <td className="py-2">{entry.orderedBy}</td>
                    <td className="py-2">{entry.designation}</td>
                    <td className="py-2">{entry.date}</td>
                    <td className="py-2">{entry.time}</td>
                    <td className="py-2">{entry.period}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-xs text-muted-foreground mt-4">
            Total orders placed: {orderHistory.length} | Total meals ordered: {orderHistory.reduce((sum, e) => sum + e.mealsOrdered, 0).toLocaleString()}
          </div>
          <DialogFooter>
            <Button onClick={() => setHistoryModalOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Demo button - Simulate 24h */}
      {forwardCycle === "forwarded" && (
        <div className="text-xs text-muted-foreground mb-4 flex items-center gap-2">
          <button
            type="button"
            className="text-gray-500 hover:text-gray-700 underline"
            onClick={() => setForwardCycle("ready")}
          >
            [ Simulate next 24h — demo only ]
          </button>
        </div>
      )}


      {/* Day Selection Modal */}
      <Dialog open={daySelectionOpen} onOpenChange={setDaySelectionOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col gap-0 p-0 overflow-hidden">
          {/* Header */}
          <div className="px-6 pt-6 pb-4 border-b bg-white">
            <DialogTitle className="text-lg font-semibold mb-4">Tag Meal — Select Day & Configure</DialogTitle>
            <div className="flex gap-1.5">
              {DAYS.map((d) => (
                <button
                  key={d}
                  type="button"
                  className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    pendingDay === d
                      ? "bg-slate-800 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                  onClick={() => setPendingDay(d)}
                >
                  {d.slice(0, 3)}
                </button>
              ))}
            </div>
          </div>

          {/* Domestic / International summary */}
          <div className="px-6 py-3 bg-white border-b">
            <div className="grid grid-cols-2 gap-3">
              {(() => {
                const domMeals = meals.filter((m) => m.day === pendingDay && m.flightType.includes("Domestic"));
                const domTypes = [...new Set(domMeals.map((m) => m.mealType))];
                return (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Domestic</div>
                    <div className="text-2xl font-bold text-slate-800">{domMeals.length}</div>
                    <div className="text-xs text-slate-500">meals configured</div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {domTypes.length > 0 ? domTypes.map((t) => (
                        <span key={t} className="px-1.5 py-0.5 text-xs rounded bg-slate-200 text-slate-600">{t}</span>
                      )) : <span className="text-xs text-slate-400 italic">None configured</span>}
                    </div>
                  </div>
                );
              })()}
              {(() => {
                const intlMeals = meals.filter((m) => m.day === pendingDay && m.flightType.includes("International"));
                const intlTypes = [...new Set(intlMeals.map((m) => m.mealType))];
                return (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">International</div>
                    <div className="text-2xl font-bold text-slate-800">{intlMeals.length}</div>
                    <div className="text-xs text-slate-500">meals configured</div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {intlTypes.length > 0 ? intlTypes.map((t) => (
                        <span key={t} className="px-1.5 py-0.5 text-xs rounded bg-slate-200 text-slate-600">{t}</span>
                      )) : <span className="text-xs text-slate-400 italic">None configured</span>}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* Scrollable meal rows */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3 bg-slate-50">
            {(() => {
              const tagPalette = [
                { border: "border-amber-200",   header: "bg-amber-50",   headerText: "text-amber-800",   body: "bg-white",  cardAccent: "border-l-amber-400"   },
                { border: "border-sky-200",     header: "bg-sky-50",     headerText: "text-sky-800",     body: "bg-white",  cardAccent: "border-l-sky-400"     },
                { border: "border-violet-200",  header: "bg-violet-50",  headerText: "text-violet-800",  body: "bg-white",  cardAccent: "border-l-violet-400"  },
                { border: "border-orange-200",  header: "bg-orange-50",  headerText: "text-orange-800",  body: "bg-white",  cardAccent: "border-l-orange-400"  },
                { border: "border-emerald-200", header: "bg-emerald-50", headerText: "text-emerald-800", body: "bg-white",  cardAccent: "border-l-emerald-400" },
              ];
              const mealTypeTime: Record<string, string> = {
                Breakfast: "07:00 AM – 10:00 AM",
                Lunch: "11:00 AM – 02:00 PM",
                Snacks: "02:00 PM – 04:00 PM",
                "Heavy Snacks": "04:00 PM – 07:00 PM",
                Dinner: "07:00 PM – 10:00 PM",
              };
              return MEAL_TYPES.map((mealType, typeIdx) => {
                const pal = tagPalette[typeIdx % tagPalette.length];
                const mealsForType = meals.filter((m) => m.day === pendingDay && m.mealType === mealType);
                return (
                  <div key={mealType} className={`rounded-xl border ${pal.border} overflow-hidden shadow-sm`}>
                    {/* Row header */}
                    <div className={`${pal.header} px-4 py-2.5 flex items-center gap-3 border-b ${pal.border}`}>
                      <span className={`font-semibold text-sm w-28 shrink-0 ${pal.headerText}`}>{mealType}</span>
                      <span className="text-xs text-slate-400">{mealTypeTime[mealType]}</span>
                    </div>
                    {/* Row body */}
                    <div className={`${pal.body} px-4 py-3`}>
                      {mealsForType.length === 0 ? (
                        <div className="flex items-center gap-4 py-1">
                          <span className="text-sm text-slate-400 italic">No meals configured for this day</span>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onClick={() => { setSelectedDay(pendingDay); setDaySelectionOpen(false); setCreateModalOpen(true); }}
                          >
                            + Add New
                          </Button>
                        </div>
                      ) : (
                        <div className="flex gap-3 flex-wrap items-start">
                          {mealsForType.map((meal) => (
                            <div
                              key={meal.id}
                              className={`border-l-4 ${pal.cardAccent} bg-slate-50 rounded-lg px-4 py-3 min-w-[180px] shadow-sm`}
                            >
                              <div className="font-semibold text-sm text-slate-700">{mealType} — {meal.forType}</div>
                              <div className="text-xs text-slate-500 mt-1">Serving: {meal.servingTime.start} – {meal.servingTime.end}</div>
                              <div className="flex gap-1 mt-1.5 flex-wrap">
                                {meal.flightType.map((ft) => (
                                  <span key={ft} className="px-1.5 py-0.5 text-xs rounded bg-slate-200 text-slate-600">{ft}</span>
                                ))}
                              </div>
                            </div>
                          ))}
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs self-center"
                            onClick={() => { setSelectedDay(pendingDay); setDaySelectionOpen(false); setCreateModalOpen(true); }}
                          >
                            + Add New
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              });
            })()}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t bg-white flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDaySelectionOpen(false)}>Cancel</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => {
                const now = new Date();
                const todayFormatted = now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
                const timeFormatted = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: true });
                setForwardCycle("forwarded");
                setLastForwardedQuantity(gmOrderData.totalMealsToday);
                setForwardedAt(now);
                setTagLog({ name: "Current User", date: todayFormatted, time: timeFormatted });
                setOrderHistory((prev) => [...prev, { mealsOrdered: gmOrderData.totalMealsToday, orderedBy: "Current User", designation: "Meal Planner", date: todayFormatted, time: timeFormatted, period: "24-hour cycle" }]);
                setDaySelectionOpen(false);
                toast.success("Meal plan tagged and forwarded to Production — opening Production Order");
                navigate("/production-entry");
              }}
            >
              Forward to Production
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Day Tabs */}
      <Tabs value={selectedDay} onValueChange={setSelectedDay} className="mb-6">
        <TabsList>
          {DAYS.map((day) => (
            <TabsTrigger key={day} value={day}>
              {day}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* Filter Bar */}
        <div className="flex gap-2 mt-4 mb-4">
          {[
            { key: "domestic", label: "Domestic" },
            { key: "international", label: "International" },
            { key: "passenger", label: "Passenger" },
            { key: "crew", label: "Crew" },
          ].map((filter) => (
            <button
              key={filter.key}
              type="button"
              className={`px-3 py-1 rounded-full text-sm font-medium ${
                activeFilters[filter.key as keyof typeof activeFilters]
                  ? "bg-primary text-primary-foreground"
                  : "bg-white border border-gray-300 text-gray-600"
              }`}
              onClick={() =>
                setActiveFilters({
                  ...activeFilters,
                  [filter.key]: !activeFilters[filter.key as keyof typeof activeFilters],
                })
              }
            >
              {filter.label}
            </button>
          ))}
        </div>

        {!hasAnyFilterActive && (
          <div className="text-center py-12 text-muted-foreground">
            No filters selected — select at least one filter to view meals
          </div>
        )}

        {hasAnyFilterActive && DAYS.map((day) => {
          const mealsByType = getMealsByTypeForDay(day);
          const rowPalette = [
            { border: "border-amber-200",  header: "bg-amber-100",  headerText: "text-amber-800",  body: "bg-amber-50/60",  cardBorder: "border-l-amber-400"  },
            { border: "border-sky-200",    header: "bg-sky-100",    headerText: "text-sky-800",    body: "bg-sky-50/60",    cardBorder: "border-l-sky-400"    },
            { border: "border-violet-200", header: "bg-violet-100", headerText: "text-violet-800", body: "bg-violet-50/60", cardBorder: "border-l-violet-400" },
            { border: "border-orange-200", header: "bg-orange-100", headerText: "text-orange-800", body: "bg-orange-50/60", cardBorder: "border-l-orange-400" },
            { border: "border-emerald-200",header: "bg-emerald-100",headerText: "text-emerald-800",body: "bg-emerald-50/60",cardBorder: "border-l-emerald-400"},
          ];
          const mealTypeTime: Record<string, string> = {
            Breakfast: "07:00 AM – 10:00 AM",
            Lunch: "11:00 AM – 02:00 PM",
            Snacks: "02:00 PM – 04:00 PM",
            "Heavy Snacks": "04:00 PM – 07:00 PM",
            Dinner: "07:00 PM – 10:00 PM",
          };
          return (
          <TabsContent key={day} value={day} className="mt-4">
            <div className="space-y-3">
              {MEAL_TYPES.map((mealType, typeIdx) => {
                const palette = rowPalette[typeIdx % rowPalette.length];
                const mealsForType = mealsByType[mealType];
                return (
                  <div key={mealType} className={`rounded-lg border ${palette.border} overflow-hidden`}>
                    <div className={`${palette.header} px-4 py-2.5 flex items-center gap-4`}>
                      <span className={`font-semibold text-sm w-28 shrink-0 ${palette.headerText}`}>{mealType}</span>
                      <span className="text-xs text-muted-foreground">{mealTypeTime[mealType]}</span>
                    </div>
                    <div className={`${palette.body} p-3`}>
                      {mealsForType.length === 0 ? (
                        <div className="py-4 text-center text-muted-foreground text-sm">
                          No meals configured — click + New Meal to add
                        </div>
                      ) : (
                        <div className="space-y-5">
                          {mealsForType.map((meal) => {
                            const choiceCardColors = [
                              { header: "bg-blue-100 text-blue-800", border: "border-blue-200" },
                              { header: "bg-teal-100 text-teal-800", border: "border-teal-200" },
                              { header: "bg-indigo-100 text-indigo-800", border: "border-indigo-200" },
                            ];
                            return (
                              <div key={meal.id}>
                                {/* Meal meta-header */}
                                <div className="flex items-center gap-3 mb-2 flex-wrap">
                                  <span className="text-sm font-semibold">{meal.forType}</span>
                                  {meal.flightType.map((ft) => (
                                    <span key={ft} className="px-2 py-0.5 text-xs rounded-full bg-primary/10 text-primary">{ft}</span>
                                  ))}
                                  <span className="text-xs text-muted-foreground">Serving: {meal.servingTime.start} – {meal.servingTime.end}</span>
                                  <span className="text-xs italic text-muted-foreground">Effective: {formatDateDDMMMYYYY(meal.createdDate)}</span>
                                  <Button variant="ghost" size="sm" className="h-6 px-2 text-xs ml-auto" onClick={() => openViewMenu(meal)}>📋 View Menu</Button>
                                </div>

                                {/* Choice cards + special meal cards + dessert — horizontal */}
                                <div className="flex gap-3 flex-wrap">
                                  {meal.choices.map((choice, choiceIdx) => {
                                    const cc = choiceCardColors[choiceIdx % choiceCardColors.length];
                                    const choiceTotal = choice.items.reduce((s, it) => s + (it.calories || 0), 0);
                                    const noteKey = `${meal.id}-${choiceIdx}`;
                                    return (
                                      <Card key={choiceIdx} className={`border ${cc.border} w-56 shrink-0 bg-card`}>
                                        <div className={`px-3 py-2 rounded-t-lg font-semibold text-xs ${cc.header}`}>
                                          CHOICE {String(choiceIdx + 1).padStart(2, "0")} — {choice.percentage}%
                                        </div>
                                        <CardContent className="p-3 space-y-2">
                                          <ol className="text-xs space-y-1 list-decimal list-inside">
                                            {choice.items.map((item, itemIdx) => (
                                              <li key={itemIdx} className="leading-relaxed">
                                                <span className="font-medium">{item.name}</span>
                                                {item.weight > 0 && <span className="text-muted-foreground"> – {item.weight}g</span>}
                                              </li>
                                            ))}
                                          </ol>
                                          <div className="text-xs font-semibold border-t pt-1.5">Total: {choiceTotal} kcal</div>
                                          <Button
                                            size="sm"
                                            className="w-full h-7 text-xs bg-slate-700 hover:bg-slate-600 text-white"
                                            onClick={() => {
                                              setEditingChoice({ mealId: meal.id, kind: "choice", choiceIdx, items: choice.items.map((i) => ({ ...i })), label: `Choice ${String(choiceIdx + 1).padStart(2, "0")} — ${choice.percentage}%` });
                                              setChoiceEditOpen(true);
                                            }}
                                          >
                                            ✏ Edit
                                          </Button>
                                        </CardContent>
                                      </Card>
                                    );
                                  })}

                                  {/* Special meal cards */}
                                  {meal.specialMeals.filter((sm) => sm.enabled).map((sm) => {
                                    const smTotal = sm.items.reduce((s, it) => s + (it.calories || 0), 0);
                                    return (
                                      <Card key={sm.type} className="border border-purple-200 w-56 shrink-0 bg-card">
                                        <div className="px-3 py-2 rounded-t-lg font-semibold text-xs bg-purple-100 text-purple-800">
                                          {sm.type} {typeof sm.portions === "number" ? `(${sm.portions} portion${sm.portions !== 1 ? "s" : ""})` : `(${sm.portions})`}
                                        </div>
                                        <CardContent className="p-3 space-y-2">
                                          <ol className="text-xs space-y-1 list-decimal list-inside">
                                            {sm.items.map((item, idx) => (
                                              <li key={idx} className="leading-relaxed">
                                                <span className="font-medium">{item.name}</span>
                                                {item.weight > 0 && <span className="text-muted-foreground"> – {item.weight}g</span>}
                                              </li>
                                            ))}
                                          </ol>
                                          <div className="text-xs font-semibold border-t pt-1.5">Total: {smTotal} kcal</div>
                                          <Button
                                            size="sm"
                                            className="w-full h-7 text-xs bg-slate-700 hover:bg-slate-600 text-white"
                                            onClick={() => {
                                              setEditingChoice({ mealId: meal.id, kind: "specialMeal", smType: sm.type, items: sm.items.map((i) => ({ ...i })), label: `${sm.type} ${typeof sm.portions === "number" ? `(${sm.portions} portions)` : `(${sm.portions})`}` });
                                              setChoiceEditOpen(true);
                                            }}
                                          >
                                            ✏ Edit
                                          </Button>
                                        </CardContent>
                                      </Card>
                                    );
                                  })}

                                  {/* Dessert card */}
                                  {meal.dessert.name && (
                                    <Card className="border border-pink-200 w-56 shrink-0 bg-card">
                                      <div className="px-3 py-2 rounded-t-lg font-semibold text-xs bg-pink-100 text-pink-800">Dessert</div>
                                      <CardContent className="p-3 space-y-2">
                                        <div className="text-xs font-medium">{meal.dessert.name}{meal.dessert.weight > 0 && ` – ${meal.dessert.weight}g`}</div>
                                        <div className="text-xs font-semibold border-t pt-1.5">Total: {meal.dessert.calories} kcal</div>
                                        <Button
                                          size="sm"
                                          className="w-full h-7 text-xs bg-slate-700 hover:bg-slate-600 text-white"
                                          onClick={() => {
                                            setEditingChoice({ mealId: meal.id, kind: "dessert", items: [{ ...meal.dessert }], label: "Dessert" });
                                            setChoiceEditOpen(true);
                                          }}
                                        >
                                          ✏ Edit
                                        </Button>
                                      </CardContent>
                                    </Card>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </TabsContent>
        );
        })}
      </Tabs>

      {/* View Menu Modal */}
      <Dialog open={viewMenuOpen} onOpenChange={setViewMenuOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle>Meal Menu</DialogTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.print()}
              >
                🖨 Print
              </Button>
            </div>
          </DialogHeader>
          {selectedMeal && (
            <div className="space-y-4 p-4 border rounded-lg bg-muted/30">
              <div>
                <h4 className="font-semibold">{selectedMeal.mealType}</h4>
                <p className="text-sm text-muted-foreground">
                  {selectedMeal.forType} • {selectedMeal.flightType.join(", ")}
                </p>
              </div>

              {selectedMeal.choices.map((choice, idx) => (
                <div key={idx} className="border-b pb-3">
                  <h5 className="font-semibold text-sm mb-2">
                    {choice.label} ({choice.percentage}%)
                  </h5>
                  <ul className="ml-4 space-y-1 text-sm">
                    {choice.items.map((item) => (
                      <li key={item.name}>
                        {item.name} — {item.weight}g
                      </li>
                    ))}
                  </ul>
                </div>
              ))}

              {selectedMeal.specialMeals
                .filter((sm) => sm.enabled)
                .map((sm) => (
                  <div key={sm.type} className="border-b pb-3">
                    <h5 className="font-semibold text-sm mb-2">
                      {sm.type}
                      {typeof sm.portions === "number"
                        ? ` (${sm.portions} portion${sm.portions > 1 ? "s" : ""})`
                        : ` (${sm.portions})`}
                    </h5>
                    <ul className="ml-4 space-y-1 text-sm">
                      {sm.items.map((item) => (
                        <li key={item.name}>
                          {item.name} — {item.weight}g
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}

              <div className="border-b pb-3">
                <h5 className="font-semibold text-sm mb-2">Dessert</h5>
                <p className="ml-4 text-sm">
                  {selectedMeal.dessert.name} — {selectedMeal.dessert.weight}g
                </p>
              </div>

              <div className="flex justify-between items-end pt-4 border-t">
                <p className="text-sm text-muted-foreground">
                  Serving: {selectedMeal.servingTime.start} – {selectedMeal.servingTime.end}
                </p>
                <p className="font-semibold text-lg">Total: {selectedMeal.totalKcal} kcal</p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setViewMenuOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Item Edit Modal — shared for Choice, Special Meal, and Dessert cards */}
      <Dialog open={choiceEditOpen} onOpenChange={setChoiceEditOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit {editingChoice?.label ?? ""}</DialogTitle>
          </DialogHeader>
          {editingChoice && (() => {
            const noteKey = editingChoice.kind === "choice"
              ? `${editingChoice.mealId}-choice-${editingChoice.choiceIdx}`
              : editingChoice.kind === "specialMeal"
              ? `${editingChoice.mealId}-sm-${editingChoice.smType}`
              : `${editingChoice.mealId}-dessert`;
            const existingNotes = choiceEditNotes[noteKey] ?? [];
            return (
              <div className="space-y-3">
                <div className="flex gap-2 items-center text-xs font-semibold text-muted-foreground border-b pb-1">
                  <div className="flex-1">Name</div>
                  <div className="w-20">Weight (g)</div>
                  <div className="w-16">Kcal</div>
                  <div className="w-16" />
                </div>

                {editingChoice.items.map((item, idx) => (
                  <div key={idx} className="flex gap-2 items-center">
                    <input
                      type="text"
                      placeholder="Item name"
                      value={item.name}
                      onChange={(e) => {
                        const updated = editingChoice.items.map((it, i) => i === idx ? { ...it, name: e.target.value } : it);
                        setEditingChoice({ ...editingChoice, items: updated });
                      }}
                      className="flex-1 rounded border px-2 py-1 text-sm"
                    />
                    <input
                      type="number"
                      placeholder="g"
                      value={item.weight}
                      onChange={(e) => {
                        const updated = editingChoice.items.map((it, i) => i === idx ? { ...it, weight: Number(e.target.value) } : it);
                        setEditingChoice({ ...editingChoice, items: updated });
                      }}
                      className="w-20 rounded border px-2 py-1 text-sm"
                    />
                    <input
                      type="number"
                      placeholder="kcal"
                      value={item.calories}
                      onChange={(e) => {
                        const updated = editingChoice.items.map((it, i) => i === idx ? { ...it, calories: Number(e.target.value) } : it);
                        setEditingChoice({ ...editingChoice, items: updated });
                      }}
                      className="w-16 rounded border px-2 py-1 text-sm"
                    />
                    <button
                      type="button"
                      className="text-red-600 text-sm shrink-0 w-16 text-right"
                      onClick={() => setEditingChoice({ ...editingChoice, items: editingChoice.items.filter((_, i) => i !== idx) })}
                    >
                      × Remove
                    </button>
                  </div>
                ))}

                <button
                  type="button"
                  className="text-blue-600 text-sm"
                  onClick={() => setEditingChoice({ ...editingChoice, items: [...editingChoice.items, { name: "", weight: 0, calories: 0 }] })}
                >
                  + Add Item
                </button>

                {/* Change notes — shown only inside edit modal */}
                {existingNotes.length > 0 && (
                  <div className="border-t pt-3 space-y-1">
                    {existingNotes.map((note, i) => (
                      <div key={i} className="text-xs text-muted-foreground italic bg-muted/40 px-2 py-1 rounded">{note}</div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setChoiceEditOpen(false)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!editingChoice) return;
                const { mealId, kind, choiceIdx, smType, items } = editingChoice;
                const noteKey = kind === "choice"
                  ? `${mealId}-choice-${choiceIdx}`
                  : kind === "specialMeal"
                  ? `${mealId}-sm-${smType}`
                  : `${mealId}-dessert`;

                const oldMeal = meals.find((m) => m.id === mealId);
                let oldItems: MealItem[] = [];
                if (kind === "choice" && choiceIdx !== undefined) oldItems = oldMeal?.choices[choiceIdx]?.items ?? [];
                else if (kind === "specialMeal") oldItems = oldMeal?.specialMeals.find((sm) => sm.type === smType)?.items ?? [];
                else if (kind === "dessert" && oldMeal) oldItems = [oldMeal.dessert];

                const oldNames = new Set(oldItems.map((it) => it.name.trim()).filter(Boolean));
                const newlyAdded = items.filter((it) => it.name.trim() && !oldNames.has(it.name.trim()));

                setMeals((prev) =>
                  prev.map((m) => {
                    if (m.id !== mealId) return m;
                    if (kind === "choice" && choiceIdx !== undefined)
                      return { ...m, choices: m.choices.map((c, ci) => ci === choiceIdx ? { ...c, items } : c) };
                    if (kind === "specialMeal")
                      return { ...m, specialMeals: m.specialMeals.map((sm) => sm.type === smType ? { ...sm, items } : sm) };
                    if (kind === "dessert" && items.length > 0)
                      return { ...m, dessert: items[0] };
                    return m;
                  })
                );

                if (newlyAdded.length > 0) {
                  const now = new Date();
                  const dateStr = now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
                  const timeStr = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: true });
                  const newNotes = newlyAdded.map((it) => `"${it.name}" has been added by Current User on ${dateStr}, ${timeStr}`);
                  setChoiceEditNotes((prev) => ({ ...prev, [noteKey]: [...(prev[noteKey] ?? []), ...newNotes] }));
                }

                setChoiceEditOpen(false);
                toast.success("Updated successfully");
              }}
            >
              Update
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Forward Modal */}
      <Dialog open={forwardConfirmOpen} onOpenChange={setForwardConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Forward Meal Plan to Production?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div>
              <span className="font-semibold">Day:</span> {selectedDay}
            </div>
            <div>
              <span className="font-semibold">Meal Types Configured:</span> {configuredCount}
            </div>
            <div>
              <span className="font-semibold">Total Estimated kcal:</span>{" "}
              {currentDayMeals.reduce((sum, m) => sum + m.totalKcal, 0)}
            </div>
            <div className="border-t pt-3">
              <span className="font-semibold">Forwarded by:</span> Current User — {new Date().toLocaleString()}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setForwardConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleForward}>Confirm & Forward</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </>
  );
}
