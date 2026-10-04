"use client";

import {
  Check,
  Copy,
  ClipboardList,
  FileDown,
  History,
  PackageX,
  Pencil,
  PhoneCall,
  Printer,
  RotateCcw,
  ShoppingBasket,
  Truck,
  UserRoundCheck,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import ProductCheckPage from "@/app/ProductCheckPage";
import {
  BUYERS,
  STATUS_LABELS,
  STATUS_STYLES,
  PRODUCT_MASTER_STORAGE_KEY,
  PHONE_ORDER_STORAGE_KEY,
  STORAGE_KEY,
  formatDisplayTime,
  getSummary,
  nowIsoStamp,
  nowStamp,
  normalizeProductName,
  parseImportText,
  playBeep,
  rowsToItems,
} from "@/lib/freshBuy";
import {
  appendItems,
  clearAllItemsAtomic,
  fetchAllItems,
  getTodayDayKey,
  isSupabaseConfigured,
  itemFromRealtimeRow,
  replaceAllItemsAtomic,
  subscribeToItems,
  updateDayItem,
  type ItemRealtimePayload,
  type ItemRealtimeStatus,
} from "@/lib/supabaseFreshBuy";
import {
  fetchAllProducts,
  removeProductMasterSubscription,
  subscribeToProductMaster,
} from "@/lib/supabaseProductMaster";
import {
  appendPhoneOrderItem,
  fetchPhoneOrderItems,
  phoneOrderFromRealtimeRow,
  removePhoneOrderSubscription,
  subscribeToPhoneOrderItems,
  updatePhoneOrderItem,
  type PhoneOrderRealtimePayload,
} from "@/lib/supabasePhoneOrders";
import {
  PRODUCT_CATEGORIES,
  PRODUCT_UNITS,
  type BuyerName,
  type FreshBuyItem,
  type ItemStatus,
  type ProductCategory,
  type ProductMasterItem,
  type ProductUnit,
  type PhoneOrderItem,
  type VehicleStatus,
} from "@/lib/types";

type TabId = "products" | "pending" | "phone-orders" | "bought" | "unavailable" | "check" | "history";
type PriceModalMode = "buy" | "edit";
type BoughtFilter = "bought" | "loaded" | "incomplete" | "unchecked";
type PendingCategoryFilter = "ทั้งหมด" | ProductCategory;
type DataMode = "connecting" | "supabase" | "offline-cache" | "error";
type RealtimeStatus = "connecting" | "connected" | "offline" | "error";
type PrintMode = "history" | "purchase" | null;
type PriceModalState = {
  item: FreshBuyItem;
  mode: PriceModalMode;
} | null;

const IMPORT_UNLOCK_STORAGE_KEY = "fresh-buy-import-unlocked-v1";

const tabs: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: "products", label: "เช็คสินค้า", icon: ClipboardList },
  { id: "pending", label: "รายการซื้อวันนี้", icon: ShoppingBasket },
  { id: "phone-orders", label: "รายการโทรสั่ง", icon: PhoneCall },
  { id: "bought", label: "ซื้อแล้ว", icon: Check },
  { id: "unavailable", label: "ไม่มีของ", icon: PackageX },
  { id: "check", label: "เช็คขึ้นรถ", icon: Truck },
  { id: "history", label: "ประวัติวันนี้", icon: History },
];

const historyStatuses: ItemStatus[] = ["pending", "bought", "checked", "unavailable", "missing", "cancelled"];
const VEHICLE_STATUS_LABELS: Record<VehicleStatus, string> = {
  unchecked: "ยังไม่ได้เช็คขึ้นรถ",
  loaded: "ครบ",
  incomplete: "ไม่ครบ",
};

const CSV_STATUS_LABELS: Record<ItemStatus, string> = {
  pending: "รอซื้อ",
  bought: "ซื้อแล้ว",
  checked: "เช็คครบ",
  missing: "ของไม่ครบ",
  unavailable: "ไม่มีของ",
  expensive: "แพงเกินไป",
  cancelled: "ยกเลิก",
};

function getVehicleStatus(item: FreshBuyItem): VehicleStatus {
  return item.vehicleStatus ?? "unchecked";
}

function getHistoryStatus(item: FreshBuyItem): ItemStatus {
  const vehicleStatus = getVehicleStatus(item);
  if (vehicleStatus === "incomplete") return "missing";
  if (vehicleStatus === "loaded") return "checked";
  if (item.status === "missing") return "missing";
  if (item.status === "checked") return "checked";
  return item.status;
}

function getActualPriceNumber(item: FreshBuyItem): number {
  if (item.actualPrice === "" || String(item.actualPrice).trim() === "-") return 0;
  const price = Number(item.actualPrice);
  return Number.isFinite(price) ? price : 0;
}

function getDatePart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) {
  return parts.find((part) => part.type === type)?.value ?? "";
}

function formatThailandDateTime(date: Date) {
  const parts = new Intl.DateTimeFormat("th-TH-u-ca-buddhist-nu-latn", {
    timeZone: "Asia/Bangkok",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  return `${getDatePart(parts, "day")}/${getDatePart(parts, "month")}/${getDatePart(parts, "year")} ${getDatePart(parts, "hour")}:${getDatePart(parts, "minute")}`;
}

function formatPurchaseTimeOnly(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const parts = new Intl.DateTimeFormat("th-TH-u-nu-latn", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  return `${getDatePart(parts, "hour")}:${getDatePart(parts, "minute")}`;
}

function escapeCsvValue(value: string | number) {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function buildDailyBackupCsv(items: FreshBuyItem[], dayKey: string) {
  const headers = [
    "วันที่",
    "ชื่อรายการ",
    "จำนวน",
    "หน่วย",
    "ราคาซื้อ",
    "ผู้ซื้อ",
    "เวลาซื้อ",
    "สถานะสินค้า",
    "สถานะขึ้นรถ",
    "หมายเหตุ",
  ];
  const rows = items.map((item) => [
    dayKey,
    item.name,
    item.quantity,
    item.unit,
    item.actualPrice === "" ? "" : item.actualPrice,
    item.buyerName,
    item.boughtAt ? formatDisplayTime(item.boughtAt) : "",
    CSV_STATUS_LABELS[item.status] ?? item.status,
    VEHICLE_STATUS_LABELS[getVehicleStatus(item)],
    [item.note, item.issueNote].filter(Boolean).join(" / "),
  ]);

  return `\uFEFF${[headers, ...rows].map((row) => row.map(escapeCsvValue).join(",")).join("\r\n")}`;
}

function mergeRealtimeItem(items: FreshBuyItem[], payload: ItemRealtimePayload) {
  if (payload.eventType === "DELETE") {
    const deletedId = (payload.old as { id?: string }).id;
    if (!deletedId) return items;
    return items.filter((item) => item.id !== deletedId);
  }

  const nextItem = itemFromRealtimeRow(payload.new);
  const existingIndex = items.findIndex((item) => item.id === nextItem.id);

  if (existingIndex === -1) {
    return [...items, nextItem];
  }

  return items.map((item, index) => (index === existingIndex ? nextItem : item));
}

function mergeRealtimePhoneOrder(items: PhoneOrderItem[], payload: PhoneOrderRealtimePayload) {
  if (payload.eventType === "DELETE") {
    const deletedId = (payload.old as { id?: string }).id;
    return deletedId ? items.filter((item) => item.id !== deletedId) : items;
  }

  const nextItem = phoneOrderFromRealtimeRow(payload.new);
  const existingIndex = items.findIndex((item) => item.id === nextItem.id);
  return existingIndex === -1
    ? [...items, nextItem]
    : items.map((item, index) => (index === existingIndex ? nextItem : item));
}

function formatSyncClock(date: Date) {
  const parts = new Intl.DateTimeFormat("th-TH-u-nu-latn", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  return `${getDatePart(parts, "hour")}:${getDatePart(parts, "minute")}:${getDatePart(parts, "second")}`;
}

function getErrorField(error: unknown, key: string) {
  if (!error || typeof error !== "object" || !(key in error)) return undefined;
  const value = (error as Record<string, unknown>)[key];
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}

function logSupabaseError(context: string, error: unknown) {
  console.error(context, {
    name: error instanceof Error ? error.name : undefined,
    code: getErrorField(error, "code"),
    message: error instanceof Error ? error.message : getErrorField(error, "message") ?? String(error),
    details: getErrorField(error, "details"),
    hint: getErrorField(error, "hint"),
    status: getErrorField(error, "status") ?? getErrorField(error, "statusCode"),
  });
}

const sampleData = `ผักกาดขาว\t5\tกก.\t25\tเอาสวย ไม่ช้ำ
แตงกวา\t10\tกก.\t30
พริกแดง\t2\tกก.\t90`;

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabId>("products");
  const [activeBuyer, setActiveBuyer] = useState<BuyerName>("ผู้ซื้อ 1");
  const [items, setItems] = useState<FreshBuyItem[]>([]);
  const [phoneOrderItems, setPhoneOrderItems] = useState<PhoneOrderItem[]>([]);
  const [pasteText, setPasteText] = useState(sampleData);
  const [hydrated, setHydrated] = useState(false);
  const [priceModal, setPriceModal] = useState<PriceModalState>(null);
  const [buyPrice, setBuyPrice] = useState("");
  const [boughtFilter, setBoughtFilter] = useState<BoughtFilter>("bought");
  const [pendingCategoryFilter, setPendingCategoryFilter] = useState<PendingCategoryFilter>("ทั้งหมด");
  const [printMode, setPrintMode] = useState<PrintMode>(null);
  const [productCategoryByName, setProductCategoryByName] = useState<Record<string, ProductCategory>>({});
  const [isBackupConfirmOpen, setIsBackupConfirmOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [currentDateTime, setCurrentDateTime] = useState("");
  const [dataMode, setDataMode] = useState<DataMode>(isSupabaseConfigured ? "connecting" : "offline-cache");
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>(isSupabaseConfigured ? "connecting" : "offline");
  const [syncError, setSyncError] = useState("");
  const [lastSyncAt, setLastSyncAt] = useState("");
  const [savingItemIds, setSavingItemIds] = useState<string[]>([]);
  const [isReplacingAllItems, setIsReplacingAllItems] = useState(false);
  const [isClearingAllItems, setIsClearingAllItems] = useState(false);
  const savingItemIdsRef = useRef<Set<string>>(new Set());
  const submittingProductListRef = useRef(false);
  const submittingPhoneOrderIdsRef = useRef<Set<string>>(new Set());
  const [isImportUnlocked, setIsImportUnlocked] = useState(false);
  const [isImportPinConfigured, setIsImportPinConfigured] = useState<boolean | null>(null);
  const [isAdminPinOpen, setIsAdminPinOpen] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState("");
  const [isPinChecking, setIsPinChecking] = useState(false);

  useEffect(() => {
    const refreshClock = () => setCurrentDateTime(formatThailandDateTime(new Date()));
    refreshClock();
    const intervalId = window.setInterval(refreshClock, 60_000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const finishPrinting = () => setPrintMode(null);
    window.addEventListener("afterprint", finishPrinting);
    return () => window.removeEventListener("afterprint", finishPrinting);
  }, []);

  function printView(mode: Exclude<PrintMode, null>) {
    setPrintMode(mode);
    window.setTimeout(() => window.print(), 0);
  }

  useEffect(() => {
    let cancelled = false;
    async function verifyImportPinConfig() {
      try {
        const response = await fetch("/api/import-pin", { method: "GET" });
        const result = (await response.json()) as { configured?: boolean };
        if (!cancelled) {
          const configured = Boolean(result.configured);
          setIsImportPinConfigured(configured);
          setIsImportUnlocked(
            configured && window.localStorage.getItem(IMPORT_UNLOCK_STORAGE_KEY) === "unlocked",
          );
          if (!configured) setPinError("ยังไม่ได้ตั้งค่า IMPORT_PAGE_PIN");
        }
      } catch {
        if (!cancelled) {
          setIsImportPinConfigured(false);
          setIsImportUnlocked(false);
          setPinError("ไม่สามารถตรวจสอบการตั้งค่า PIN ได้");
        }
      }
    }

    void verifyImportPinConfig();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (isSupabaseConfigured) return;

    setDataMode("offline-cache");
    setRealtimeStatus("offline");
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        setItems(JSON.parse(saved) as FreshBuyItem[]);
      } catch {
        setItems([]);
      }
    }
    const savedPhoneOrders = window.localStorage.getItem(PHONE_ORDER_STORAGE_KEY);
    if (savedPhoneOrders) {
      try {
        setPhoneOrderItems(JSON.parse(savedPhoneOrders) as PhoneOrderItem[]);
      } catch {
        setPhoneOrderItems([]);
      }
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated && !isSupabaseConfigured) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    }
  }, [hydrated, items]);

  useEffect(() => {
    if (hydrated && !isSupabaseConfigured) {
      window.localStorage.setItem(PHONE_ORDER_STORAGE_KEY, JSON.stringify(phoneOrderItems));
    }
  }, [hydrated, phoneOrderItems]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    let cancelled = false;

    async function loadGlobalItems() {
      setDataMode("connecting");
      setRealtimeStatus("connecting");
      try {
        const remoteItems = await fetchAllItems();
        if (!cancelled) {
          setItems(remoteItems);
          setDataMode("supabase");
          setSyncError("");
          setLastSyncAt(formatSyncClock(new Date()));
          setHydrated(true);
        }
      } catch (error) {
        logSupabaseError("Supabase load failed", error);
        if (!cancelled) {
          setDataMode("error");
          setSyncError("การเชื่อมต่อข้อมูลกลางมีปัญหา");
          setHydrated(true);
        }
      }
    }

    void loadGlobalItems();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;

    void fetchPhoneOrderItems()
      .then((remoteItems) => {
        if (!cancelled) setPhoneOrderItems(remoteItems);
      })
      .catch((error) => {
        if (!cancelled) {
          logSupabaseError("Phone order load failed", error);
          setSyncError("โหลดรายการโทรสั่งไม่สำเร็จ กรุณาตรวจว่าได้รัน SQL แล้ว");
        }
      });

    const channel = subscribeToPhoneOrderItems(
      (payload) => {
        if (!cancelled) setPhoneOrderItems((current) => mergeRealtimePhoneOrder(current, payload));
      },
      (status, error) => {
        if (!cancelled && status !== "SUBSCRIBED" && status !== "CLOSED") {
          logSupabaseError(`Phone order realtime ${status.toLowerCase()}`, error ?? new Error(status));
        }
      },
    );

    return () => {
      cancelled = true;
      void removePhoneOrderSubscription(channel);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    function applyProductCategories(products: ProductMasterItem[]) {
      if (cancelled) return;
      const lookup: Record<string, ProductCategory> = {};
      for (const product of products.filter((candidate) => !candidate.active)) {
        lookup[normalizeProductName(product.name)] = product.category;
      }
      for (const product of products.filter((candidate) => candidate.active)) {
        lookup[normalizeProductName(product.name)] = product.category;
      }
      setProductCategoryByName(lookup);
    }

    async function refreshProductCategories() {
      try {
        if (!isSupabaseConfigured) {
          const saved = window.localStorage.getItem(PRODUCT_MASTER_STORAGE_KEY);
          applyProductCategories(saved ? (JSON.parse(saved) as ProductMasterItem[]) : []);
          return;
        }
        applyProductCategories(await fetchAllProducts());
      } catch (error) {
        logSupabaseError("Product Master category mapping load failed", error);
      }
    }

    void refreshProductCategories();
    const channel = isSupabaseConfigured
      ? subscribeToProductMaster(() => void refreshProductCategories())
      : null;

    return () => {
      cancelled = true;
      void removeProductMasterSubscription(channel);
    };
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    setRealtimeStatus("connecting");
    let cancelled = false;
    const channel = subscribeToItems(
      (payload) => {
        if (cancelled) return;
        setItems((current) => mergeRealtimeItem(current, payload));
        setDataMode("supabase");
        setRealtimeStatus("connected");
        setSyncError("");
        setLastSyncAt(formatSyncClock(new Date()));
      },
      (status: ItemRealtimeStatus, error) => {
        if (cancelled) return;

        if (status === "SUBSCRIBED") {
          setRealtimeStatus("connected");
          setSyncError((current) => (current === "การเชื่อมต่อ Realtime มีปัญหา" ? "" : current));
          return;
        }

        if (status === "CLOSED") {
          setRealtimeStatus("offline");
          return;
        }

        setRealtimeStatus("error");
        setSyncError("การเชื่อมต่อ Realtime มีปัญหา");
        logSupabaseError(`Supabase realtime ${status.toLowerCase()}`, error ?? new Error(status));
      },
    );

    return () => {
      cancelled = true;
      if (channel) void channel.unsubscribe();
    };
  }, []);

  const parsedRows = useMemo(() => parseImportText(pasteText), [pasteText]);
  const pendingItems = items.filter((item) => item.status === "pending");
  const summary = useMemo(() => getSummary(items), [items]);
  const operationalTotal = pendingItems.length + phoneOrderItems.length;
  const filteredPendingItems = pendingItems.filter((item) => {
    if (pendingCategoryFilter === "ทั้งหมด") return true;
    const category = productCategoryByName[normalizeProductName(item.name)] ?? "อื่นๆ";
    return category === pendingCategoryFilter;
  });
  const boughtItems = items.filter((item) => item.status === "bought");
  const unavailableItems = items.filter((item) => item.status === "unavailable");
  const vehicleQueueItems = boughtItems.filter((item) => getVehicleStatus(item) === "unchecked");
  const checkedTotal = boughtItems.filter((item) => getVehicleStatus(item) !== "unchecked").length;
  const boughtTotalForProgress = boughtItems.length;
  const activeTabLabel = tabs.find((tab) => tab.id === activeTab)?.label ?? "";
  function saveLocalFallback(nextItems: FreshBuyItem[]) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextItems));
  }

  function requireImportUnlock() {
    if (isImportUnlocked) return true;
    setPinError("กรุณาปลดล็อกหน้าสำหรับเจ้าของก่อน");
    playBeep("warn");
    return false;
  }

  function setItemSaving(id: string, isSaving: boolean) {
    const nextSavingIds = new Set(savingItemIdsRef.current);
    if (isSaving) {
      nextSavingIds.add(id);
    } else {
      nextSavingIds.delete(id);
    }
    savingItemIdsRef.current = nextSavingIds;
    setSavingItemIds(Array.from(nextSavingIds));
  }

  function reportSyncError(context: string, error: unknown) {
    logSupabaseError(context, error);
    setDataMode("error");
    setSyncError("การบันทึกข้อมูลกลางไม่สำเร็จ");
    playBeep("warn");
  }

  async function verifyImportPin() {
    const pin = pinInput.trim();
    if (!pin) {
      setPinError("กรุณาใส่รหัส");
      playBeep("warn");
      return;
    }

    setIsPinChecking(true);
    setPinError("");
    try {
      const response = await fetch("/api/import-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const result = (await response.json()) as { ok?: boolean; configured?: boolean };

      if (!result.configured) {
        setIsImportPinConfigured(false);
        setIsImportUnlocked(false);
        window.localStorage.removeItem(IMPORT_UNLOCK_STORAGE_KEY);
        setPinError("ยังไม่ได้ตั้งค่า IMPORT_PAGE_PIN");
        playBeep("warn");
        return;
      }

      if (!response.ok || !result.ok) {
        setPinError("รหัสไม่ถูกต้อง");
        playBeep("warn");
        return;
      }

      window.localStorage.setItem(IMPORT_UNLOCK_STORAGE_KEY, "unlocked");
      setIsImportPinConfigured(true);
      setIsImportUnlocked(true);
      setIsAdminPinOpen(false);
      setPinInput("");
      setPinError("");
      playBeep("ok");
    } catch {
      setPinError("ไม่สามารถตรวจสอบรหัสได้");
      playBeep("warn");
    } finally {
      setIsPinChecking(false);
    }
  }

  function logoutImportOwner() {
    window.localStorage.removeItem(IMPORT_UNLOCK_STORAGE_KEY);
    setIsImportUnlocked(false);
    setPinInput("");
    setPinError("");
    setIsAdminPinOpen(false);
    playBeep("soft");
  }

  async function replaceTodayList() {
    if (!requireImportUnlock()) return;
    if (isReplacingAllItems || isClearingAllItems) return;
    if (!window.confirm("ยืนยันสร้างรายการซื้อใหม่?\nรายการซื้อกลางทั้งหมดใน buy_items จะถูกแทนที่ด้วยรายการที่นำเข้า")) return;
    const nextItems = rowsToItems(parsedRows);
    if (!isSupabaseConfigured) {
      setItems(nextItems);
      setActiveTab("pending");
      playBeep("ok");
      saveLocalFallback(nextItems);
      return;
    }

    setIsReplacingAllItems(true);
    try {
      await replaceAllItemsAtomic(nextItems);
      const remoteItems = await fetchAllItems();
      setItems(remoteItems);
      setActiveTab("pending");
      playBeep("ok");
      setDataMode("supabase");
      setSyncError("");
      setLastSyncAt(formatSyncClock(new Date()));
    } catch (error) {
      reportSyncError("Supabase replace global list failed", error);
    } finally {
      setIsReplacingAllItems(false);
    }
  }

  async function appendTodayList() {
    if (!requireImportUnlock()) return;
    if (isReplacingAllItems || isClearingAllItems) return;
    const newItems = rowsToItems(parsedRows);
    const nextItems = [...items, ...newItems];
    if (!isSupabaseConfigured) {
      setItems(nextItems);
      setActiveTab("pending");
      playBeep("ok");
      saveLocalFallback(nextItems);
      return;
    }

    try {
      await appendItems(newItems);
      setItems((current) => {
        const currentIds = new Set(current.map((item) => item.id));
        return [...current, ...newItems.filter((item) => !currentIds.has(item.id))];
      });
      setActiveTab("pending");
      playBeep("ok");
      setDataMode("supabase");
      setSyncError("");
      setLastSyncAt(formatSyncClock(new Date()));
    } catch (error) {
      reportSyncError("Supabase append global list failed", error);
    }
  }

  async function sendCheckedProducts(newItems: FreshBuyItem[]) {
    if (submittingProductListRef.current || isReplacingAllItems || isClearingAllItems) return false;
    if (newItems.length === 0) return false;

    submittingProductListRef.current = true;
    const nextItems = [...items, ...newItems];
    try {
      if (!isSupabaseConfigured) {
        setItems(nextItems);
        saveLocalFallback(nextItems);
      } else {
        await appendItems(newItems);
        setItems((current) => {
          const currentIds = new Set(current.map((item) => item.id));
          return [...current, ...newItems.filter((item) => !currentIds.has(item.id))];
        });
        setDataMode("supabase");
        setSyncError("");
        setLastSyncAt(formatSyncClock(new Date()));
      }

      playBeep("ok");
      return true;
    } catch (error) {
      reportSyncError("Supabase append checked products failed", error);
      return false;
    } finally {
      submittingProductListRef.current = false;
    }
  }

  async function sendPhoneOrder(item: PhoneOrderItem) {
    const guardId = item.productMasterId ?? item.id;
    if (submittingPhoneOrderIdsRef.current.has(guardId) || isClearingAllItems) return false;

    submittingPhoneOrderIdsRef.current.add(guardId);
    try {
      if (isSupabaseConfigured) await appendPhoneOrderItem(item);
      setPhoneOrderItems((current) =>
        current.some((candidate) => candidate.id === item.id) ? current : [...current, item],
      );
      playBeep("ok");
      return true;
    } catch (error) {
      reportSyncError("Supabase append phone order failed", error);
      return false;
    } finally {
      submittingPhoneOrderIdsRef.current.delete(guardId);
    }
  }

  async function updatePhoneOrderSnapshot(
    item: PhoneOrderItem,
    updates: Pick<PhoneOrderItem, "quantity" | "unit" | "supplierName">,
  ) {
    try {
      const saved = isSupabaseConfigured
        ? await updatePhoneOrderItem(item.id, updates)
        : { ...item, ...updates, updatedAt: new Date().toISOString() };
      setPhoneOrderItems((current) => current.map((candidate) => candidate.id === saved.id ? saved : candidate));
      playBeep("ok");
      return true;
    } catch (error) {
      reportSyncError("Supabase update phone order failed", error);
      return false;
    }
  }

  async function clearToday() {
    if (!requireImportUnlock()) return;
    if (isClearingAllItems || isReplacingAllItems) return;
    if (!window.confirm("ยืนยันล้างรายการทั้งหมด?\nควรกด Backup วันนี้เป็น CSV ก่อนหากต้องการเก็บข้อมูล\nทั้งรายการซื้อวันนี้และรายการโทรสั่งจะถูกลบ")) return;
    playBeep("warn");
    if (!isSupabaseConfigured) {
      setItems([]);
      setPhoneOrderItems([]);
      setPasteText(sampleData);
      saveLocalFallback([]);
      return;
    }

    setIsClearingAllItems(true);
    try {
      await clearAllItemsAtomic();
      setItems([]);
      setPhoneOrderItems([]);
      setPasteText(sampleData);
      setDataMode("supabase");
      setSyncError("");
      setLastSyncAt(formatSyncClock(new Date()));
    } catch (error) {
      reportSyncError("Supabase clear global list failed", error);
    } finally {
      setIsClearingAllItems(false);
    }
  }

  async function startNewWorkingCycle() {
    if (isClearingAllItems || isReplacingAllItems) return false;

    if (!isSupabaseConfigured) {
      setItems([]);
      setPhoneOrderItems([]);
      setPasteText(sampleData);
      saveLocalFallback([]);
      return true;
    }

    setIsClearingAllItems(true);
    try {
      await clearAllItemsAtomic();
      setItems([]);
      setPhoneOrderItems([]);
      setPasteText(sampleData);
      setDataMode("supabase");
      setSyncError("");
      setLastSyncAt(formatSyncClock(new Date()));
      return true;
    } catch (error) {
      reportSyncError("Supabase start new global working cycle failed", error);
      return false;
    } finally {
      setIsClearingAllItems(false);
    }
  }

  function updateItem(id: string, patch: Partial<FreshBuyItem>) {
    if (savingItemIdsRef.current.has(id)) return;

    let previousItem: FreshBuyItem | undefined;
    setItemSaving(id, true);
    setItems((current) =>
      current.map((item) => {
        if (item.id !== id) return item;
        previousItem = item;
        return { ...item, ...patch };
      }),
    );

    if (!isSupabaseConfigured) {
      setItemSaving(id, false);
      return;
    }

    void updateDayItem(id, patch)
      .then(() => {
        setDataMode("supabase");
        setSyncError("");
        setLastSyncAt(formatSyncClock(new Date()));
      })
      .catch((error) => {
        if (previousItem) {
          setItems((current) => current.map((item) => (item.id === id ? previousItem as FreshBuyItem : item)));
        }
        reportSyncError("Supabase update item failed", error);
      })
      .finally(() => {
        setItemSaving(id, false);
      });
  }

  function confirmBackupCsv() {
    if (!requireImportUnlock()) return;
    const workingDayKey = getTodayDayKey();
    const csv = buildDailyBackupCsv(items, workingDayKey);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `freshbuy_${workingDayKey}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
    setIsBackupConfirmOpen(false);
    playBeep("ok");
  }

  function openBuyPopup(item: FreshBuyItem) {
    setPriceModal({ item, mode: "buy" });
    setBuyPrice(item.actualPrice === "" ? "" : String(item.actualPrice));
    playBeep("soft");
  }

  function openEditPricePopup(item: FreshBuyItem) {
    setPriceModal({ item, mode: "edit" });
    setBuyPrice(item.actualPrice === "" ? "" : String(item.actualPrice));
    playBeep("soft");
  }

  function closeBuyPopup() {
    setPriceModal(null);
    setBuyPrice("");
    playBeep("soft");
  }

  function appendBuyPrice(value: string) {
    setBuyPrice((current) => {
      if (value === "." && current.includes(".")) return current;
      if (value === "." && current === "") return "0.";
      return `${current}${value}`;
    });
  }

  function backspaceBuyPrice() {
    setBuyPrice((current) => current.slice(0, -1));
  }

  function confirmBought() {
    if (!priceModal) return;
    const actualPrice = Number(buyPrice);
    if (!buyPrice || !Number.isFinite(actualPrice) || actualPrice <= 0) {
      window.alert("กรุณาใส่ราคาซื้อจริง");
      return;
    }

    if (priceModal.mode === "buy") {
      updateItem(priceModal.item.id, {
        status: "bought",
        buyerName: activeBuyer,
        actualPrice,
        boughtAt: nowIsoStamp(),
        checkedAt: "",
        issueNote: "",
        vehicleStatus: "unchecked",
      });
    } else {
      updateItem(priceModal.item.id, { actualPrice });
    }
    setPriceModal(null);
    setBuyPrice("");
    playBeep("ok");
  }

  function markIssue(item: FreshBuyItem, status: Extract<ItemStatus, "missing">) {
    const note = window.prompt(`หมายเหตุสำหรับ "${STATUS_LABELS[status]}"`, item.issueNote || "");
    updateItem(item.id, {
      status,
      buyerName: item.buyerName || activeBuyer,
      checkedAt: nowIsoStamp(),
      issueNote: note ?? item.issueNote,
    });
    playBeep("warn");
  }

  function markVehicleStatus(item: FreshBuyItem, vehicleStatus: Extract<VehicleStatus, "loaded" | "incomplete">) {
    updateItem(item.id, {
      vehicleStatus,
      checkedAt: nowIsoStamp(),
    });
    playBeep(vehicleStatus === "loaded" ? "ok" : "warn");
  }

  function markUnavailable(item: FreshBuyItem) {
    updateItem(item.id, {
      status: "unavailable",
      buyerName: activeBuyer,
      boughtAt: nowIsoStamp(),
      checkedAt: "",
      issueNote: "",
      vehicleStatus: "unchecked",
    });
    playBeep("warn");
  }

  function groupedByStatus(status: ItemStatus) {
    return items.filter((item) => getHistoryStatus(item) === status);
  }

  return (
    <main className="min-h-screen pb-10">
      <header className="no-print sticky top-0 z-30 border-b border-white/10 bg-market-ink/92 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-3 py-3 sm:gap-4 sm:px-4 sm:py-4 lg:px-6">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h1 className="text-xl font-black tracking-normal text-white sm:text-2xl md:text-3xl">
                  FreshBuy Team OS
                </h1>
                <p className="mt-0.5 hidden text-sm font-medium text-emerald-100/72 sm:block">
                  ระบบเช็กลิสต์ซื้อผักสดประจำวัน สำหรับทีม 3 ผู้ซื้อ
                </p>
                <p className="mt-0.5 text-sm font-black text-market-mint sm:hidden">{activeTabLabel}</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5 sm:gap-2">
              {BUYERS.map((buyer) => (
                <button
                  key={buyer}
                  type="button"
                  onClick={() => {
                    setActiveBuyer(buyer);
                    playBeep("soft");
                  }}
                  className={`min-h-9 rounded-lg border px-2.5 text-xs font-bold transition sm:min-h-12 sm:px-4 sm:text-sm ${
                    activeBuyer === buyer
                      ? "border-market-mint bg-market-mint text-market-ink"
                      : "border-white/12 bg-white/6 text-emerald-50 hover:border-market-mint/60"
                  }`}
                >
                  {buyer}
                </button>
              ))}
            </div>
          </div>

          <SyncStatusBar
            dataMode={dataMode}
            realtimeStatus={realtimeStatus}
            lastSyncAt={lastSyncAt}
            syncError={syncError}
            savingCount={savingItemIds.length}
          />

          <div className="rounded-lg border border-white/10 bg-market-panel/82 p-1.5 shadow-touch sm:hidden">
            <nav
              className={`grid gap-1.5 overflow-hidden transition-all duration-200 ease-out ${
                isMobileMenuOpen ? "max-h-[320px] translate-y-0 opacity-100" : "max-h-0 -translate-y-1 opacity-0"
              }`}
            >
              {tabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => {
                      setActiveTab(tab.id);
                      setIsMobileMenuOpen(false);
                      playBeep("soft");
                    }}
                    className={`flex min-h-10 items-center gap-2 rounded-md border px-3 text-sm font-black transition ${
                      activeTab === tab.id
                        ? "border-market-green bg-market-green text-market-ink"
                        : "border-white/10 bg-white/5 text-emerald-50"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </nav>
            <button
              type="button"
              onClick={() => {
                setIsMobileMenuOpen((current) => !current);
                playBeep("soft");
              }}
              className="mx-auto mt-1 flex min-h-8 items-center justify-center rounded-full border border-market-mint/50 bg-white/8 px-4 text-xs font-black text-market-mint transition hover:bg-market-mint hover:text-market-ink"
              aria-expanded={isMobileMenuOpen}
            >
              {isMobileMenuOpen ? "ซ่อนเมนู ▲" : "เปิดเมนู ▼"}
            </button>
          </div>

          <nav className="hidden grid-cols-2 gap-2 sm:grid md:grid-cols-3 xl:grid-cols-7">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(tab.id);
                    playBeep("soft");
                  }}
                  className={`flex min-h-14 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-black transition ${
                    activeTab === tab.id
                      ? "border-market-green bg-market-green text-market-ink shadow-touch"
                      : "border-white/10 bg-market-panel text-emerald-50 hover:border-market-green/70"
                  }`}
                >
                  <Icon className="h-5 w-5" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      <section className="no-print mx-auto grid max-w-7xl grid-cols-2 gap-2 px-3 pt-3 sm:gap-3 sm:px-4 sm:pt-5 md:grid-cols-3 xl:grid-cols-6 lg:px-6">
        <SummaryCard label="ต้องซื้อทั้งหมด" value={operationalTotal} tone="mint" />
        <SummaryCard label="รายการซื้อวันนี้" value={pendingItems.length} tone="blue" />
        <SummaryCard label="รายการโทรสั่ง" value={phoneOrderItems.length} tone="blue" />
        <SummaryCard label="ซื้อแล้ว" value={summary.bought} tone="green" />
        <SummaryCard label="ไม่มีของ" value={summary.unavailable} tone="red" />
        <SummaryCard label="วันที่ / เวลา" value={currentDateTime || "-"} tone="mint" />
      </section>

      <section className="no-print mx-auto max-w-7xl px-3 py-3 sm:px-4 sm:py-5 lg:px-6">
        {activeTab === "products" && (
          <div className="relative">
            <ProductCheckPage
              currentBuyItems={items}
              currentPhoneOrderItems={phoneOrderItems}
              onSendWalk={sendCheckedProducts}
              onSendPhone={sendPhoneOrder}
              onStartNewCycle={startNewWorkingCycle}
              isAdminUnlocked={isImportUnlocked}
              isAdminPinConfigured={isImportPinConfigured}
              onRequestAdmin={() => {
                setPinError("");
                setIsAdminPinOpen(true);
              }}
              onLogout={logoutImportOwner}
              onBackup={() => setIsBackupConfirmOpen(true)}
              onClearToday={clearToday}
              isClearingToday={isClearingAllItems}
            />

            {isImportUnlocked && (
              <details className="mt-4 rounded-lg border border-white/10 bg-market-panel/65 p-3">
                <summary className="cursor-pointer font-black text-emerald-100/75">
                  เครื่องมือเดิม: นำเข้าจาก Excel / Google Sheet
                </summary>
                <div className="mt-4">
                  <ImportPage
                    pasteText={pasteText}
                    parsedCount={parsedRows.length}
                    items={parsedRows}
                    locked={false}
                    pinValue={pinInput}
                    pinError={pinError}
                    isPinChecking={isPinChecking}
                    onPinChange={setPinInput}
                    onUnlock={verifyImportPin}
                    onLogout={logoutImportOwner}
                    onTextChange={setPasteText}
                    onCreate={replaceTodayList}
                    onAppend={appendTodayList}
                    onBackup={() => setIsBackupConfirmOpen(true)}
                    onClear={clearToday}
                    isReplacing={isReplacingAllItems}
                    isClearing={isClearingAllItems}
                  />
                </div>
              </details>
            )}

            {isAdminPinOpen && !isImportUnlocked && (
              <ImportPinOverlay
                pinValue={pinInput}
                pinError={pinError}
                isChecking={isPinChecking}
                onPinChange={(value) => {
                  setPinInput(value);
                  if (pinError) setPinError("");
                }}
                onUnlock={verifyImportPin}
                onClose={() => setIsAdminPinOpen(false)}
              />
            )}
          </div>
        )}

        {activeTab === "pending" && (
          <PendingPage
            items={filteredPendingItems}
            allPendingItems={pendingItems}
            productCategoryByName={productCategoryByName}
            totalItems={pendingItems.length}
            selectedCategory={pendingCategoryFilter}
            onCategoryChange={setPendingCategoryFilter}
            onPrint={() => printView("purchase")}
            activeBuyer={activeBuyer}
            onBought={openBuyPopup}
            onUnavailable={markUnavailable}
          />
        )}

        {activeTab === "phone-orders" && (
          <PhoneOrderPage items={phoneOrderItems} onUpdate={updatePhoneOrderSnapshot} />
        )}

        {activeTab === "bought" && (
          <BoughtPage
            items={boughtItems}
            activeFilter={boughtFilter}
            onFilterChange={setBoughtFilter}
            onEditPrice={openEditPricePopup}
            onBack={(item) => {
              updateItem(item.id, {
                status: "pending",
                buyerName: "",
                boughtAt: "",
                actualPrice: "",
                checkedAt: "",
                issueNote: "",
                vehicleStatus: "unchecked",
              });
              playBeep("soft");
            }}
          />
        )}

        {activeTab === "unavailable" && (
          <UnavailablePage
            items={unavailableItems}
            onBack={(item) => {
              updateItem(item.id, {
                status: "pending",
                buyerName: "",
                boughtAt: "",
                checkedAt: "",
                issueNote: "",
                vehicleStatus: "unchecked",
              });
              playBeep("soft");
            }}
          />
        )}

        {activeTab === "check" && (
          <CheckPage
            items={vehicleQueueItems}
            checkedTotal={checkedTotal}
            boughtTotal={boughtTotalForProgress}
            onComplete={(item) => markVehicleStatus(item, "loaded")}
            onMissing={(item) => markVehicleStatus(item, "incomplete")}
          />
        )}

        {activeTab === "history" && (
          <HistoryPage
            statuses={historyStatuses}
            groupedByStatus={groupedByStatus}
            onPrint={() => printView("history")}
          />
        )}
      </section>

      {printMode === "history" && <PrintSection items={items} />}
      {printMode === "purchase" && (
        <PurchasePrintSection items={pendingItems} productCategoryByName={productCategoryByName} />
      )}
      {priceModal && (
        <BuyPriceModal
          item={priceModal.item}
          mode={priceModal.mode}
          price={buyPrice}
          onKey={appendBuyPrice}
          onBackspace={backspaceBuyPrice}
          onConfirm={confirmBought}
          onCancel={closeBuyPopup}
        />
      )}
      {isBackupConfirmOpen && (
        <BackupConfirmModal
          itemCount={items.length}
          onCancel={() => {
            setIsBackupConfirmOpen(false);
            playBeep("soft");
          }}
          onConfirm={confirmBackupCsv}
        />
      )}
    </main>
  );
}

function SyncStatusBar({
  dataMode,
  realtimeStatus,
  lastSyncAt,
  syncError,
  savingCount,
}: {
  dataMode: DataMode;
  realtimeStatus: RealtimeStatus;
  lastSyncAt: string;
  syncError: string;
  savingCount: number;
}) {
  const modeLabel: Record<DataMode, string> = {
    connecting: "Connecting",
    supabase: "Supabase",
    "offline-cache": "Offline cache",
    error: "Error",
  };
  const realtimeLabel: Record<RealtimeStatus, string> = {
    connecting: "Connecting",
    connected: "Connected",
    offline: "Offline",
    error: "Error",
  };
  const isError = dataMode === "error" || realtimeStatus === "error";

  return (
    <div
      className={`flex flex-wrap items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-bold sm:text-xs ${
        isError
          ? "border-market-red/50 bg-market-red/12 text-red-100"
          : "border-market-mint/30 bg-white/5 text-emerald-50/88"
      }`}
    >
      <span>Mode: {modeLabel[dataMode]}</span>
      <span>Realtime: {realtimeLabel[realtimeStatus]}</span>
      <span>Sync: {lastSyncAt || "-"}</span>
      {savingCount > 0 && <span>Saving: {savingCount}</span>}
      {syncError && <span className="text-red-100">{syncError}</span>}
    </div>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: number | string; tone: "mint" | "blue" | "green" | "red" }) {
  const toneClass = {
    mint: "text-market-mint",
    blue: "text-market-blue",
    green: "text-market-green",
    red: "text-market-red",
  }[tone];
  const valueClass =
    typeof value === "string"
      ? "whitespace-nowrap text-lg leading-tight sm:text-xl lg:text-2xl"
      : "text-2xl sm:text-3xl";

  return (
    <div className="rounded-lg border border-white/10 bg-market-panel/88 p-3 shadow-touch sm:p-4">
      <p className="text-xs font-bold text-emerald-100/62">{label}</p>
      <p className={`mt-1 font-black sm:mt-2 ${valueClass} ${toneClass}`}>{value}</p>
    </div>
  );
}

function BuyPriceModal({
  item,
  mode,
  price,
  onKey,
  onBackspace,
  onConfirm,
  onCancel,
}: {
  item: FreshBuyItem;
  mode: PriceModalMode;
  price: string;
  onKey: (value: string) => void;
  onBackspace: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "ลบ"];

  return (
    <div className="no-print fixed inset-0 z-50 grid place-items-center bg-black/72 px-4 backdrop-blur-sm">
      <section className="w-full max-w-sm rounded-lg border border-market-mint/30 bg-market-panel p-4 shadow-touch">
        <div className="text-center">
          <h2 className="text-2xl font-black leading-tight text-white">{item.name}</h2>
          <p className="mt-2 text-xl font-black text-market-mint">
            {item.quantity} {item.unit}
          </p>
        </div>

        <label className="mt-4 block text-sm font-bold text-emerald-100/70">ราคาซื้อจริง</label>
        <div
          className="mt-2 flex h-14 w-full items-center justify-center rounded-lg border border-market-line bg-market-ink px-4 text-center text-3xl font-black text-white"
          aria-live="polite"
        >
          {price || "0"}
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          {keys.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => (key === "ลบ" ? onBackspace() : onKey(key))}
              className={`min-h-14 rounded-lg border px-3 text-xl font-black transition ${
                key === "ลบ"
                  ? "border-market-red/70 bg-market-red/12 text-red-100 hover:bg-market-red hover:text-white"
                  : "border-white/10 bg-market-ink text-emerald-50 hover:border-market-mint hover:bg-market-panelSoft"
              }`}
            >
              {key}
            </button>
          ))}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-14 rounded-lg border border-white/14 bg-white/6 px-3 text-base font-black text-emerald-50"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="min-h-14 rounded-lg bg-market-green px-3 text-base font-black text-market-ink transition hover:bg-market-mint"
          >
          {mode === "buy" ? "ยืนยันซื้อ" : "บันทึกราคา"}
        </button>
        </div>
      </section>
    </div>
  );
}

function BackupConfirmModal({
  itemCount,
  onConfirm,
  onCancel,
}: {
  itemCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="no-print fixed inset-0 z-50 grid place-items-center bg-black/72 px-4 backdrop-blur-sm">
      <section className="w-full max-w-md rounded-lg border border-market-mint/30 bg-market-panel p-5 text-center shadow-touch">
        <h2 className="text-2xl font-black text-white">ต้องการ Backup รายการวันนี้เป็น CSV หรือไม่?</h2>
        <p className="mt-3 text-base font-semibold text-emerald-100/70">
          ระบบจะดาวน์โหลดรายการวันนี้ทั้งหมด {itemCount} รายการ และจะไม่ล้างข้อมูลให้อัตโนมัติ
        </p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-14 rounded-lg border border-white/14 bg-white/6 px-3 text-base font-black text-emerald-50"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="min-h-14 rounded-lg bg-market-green px-3 text-base font-black text-market-ink transition hover:bg-market-mint"
          >
            ยืนยัน Backup
          </button>
        </div>
      </section>
    </div>
  );
}

function ImportPage({
  pasteText,
  parsedCount,
  items,
  locked,
  pinValue,
  pinError,
  isPinChecking,
  onPinChange,
  onUnlock,
  onLogout,
  onTextChange,
  onCreate,
  onAppend,
  onBackup,
  onClear,
  isReplacing,
  isClearing,
}: {
  pasteText: string;
  parsedCount: number;
  items: ReturnType<typeof parseImportText>;
  locked: boolean;
  pinValue: string;
  pinError: string;
  isPinChecking: boolean;
  onPinChange: (value: string) => void;
  onUnlock: () => void;
  onLogout: () => void;
  onTextChange: (value: string) => void;
  onCreate: () => void;
  onAppend: () => void;
  onBackup: () => void;
  onClear: () => void;
  isReplacing: boolean;
  isClearing: boolean;
}) {
  return (
    <div className="relative">
      <div
        className={`grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.78fr)] ${
          locked ? "pointer-events-none select-none opacity-45" : ""
        }`}
        aria-hidden={locked}
      >
      <section className="rounded-lg border border-white/10 bg-market-panel/92 p-4 shadow-touch">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-black text-white">นำเข้ารายการ</h2>
            <p className="mt-1 text-sm font-semibold text-emerald-100/64">
              วางข้อมูลจาก Google Sheet หรือ Excel: name, quantity, unit, maxPrice, note
            </p>
          </div>
          <div className="rounded-lg border border-market-mint/40 bg-market-mint/10 px-3 py-2 text-sm font-black text-market-mint">
            {parsedCount} รายการ
          </div>
        </div>
        {!locked && (
          <button
            type="button"
            onClick={onLogout}
            className="mt-4 min-h-11 rounded-lg border border-market-amber/70 bg-market-amber/12 px-4 text-sm font-black text-amber-100 transition hover:bg-market-amber hover:text-market-ink"
          >
            ออกจากระบบ
          </button>
        )}

        <textarea
          value={pasteText}
          onChange={(event) => onTextChange(event.target.value)}
          disabled={locked}
          className="mt-4 min-h-[320px] w-full rounded-lg border border-market-line bg-market-ink p-4 text-lg font-semibold leading-8 text-emerald-50 outline-none ring-market-mint/40 transition placeholder:text-emerald-100/30 focus:border-market-mint focus:ring-4"
          placeholder="ผักกาดขาว&#9;5&#9;กก.&#9;25&#9;เอาสวย ไม่ช้ำ"
        />

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <button
            type="button"
            onClick={onCreate}
            disabled={locked || parsedCount === 0 || isReplacing || isClearing}
            className="min-h-16 rounded-lg bg-market-green px-5 text-lg font-black text-market-ink transition hover:bg-market-mint disabled:cursor-not-allowed disabled:bg-slate-600 disabled:text-slate-300"
          >
            {isReplacing ? "กำลังสร้าง..." : "สร้างรายการซื้อวันนี้"}
          </button>
          <button
            type="button"
            onClick={onAppend}
            disabled={locked || parsedCount === 0 || isReplacing || isClearing}
            className="min-h-16 rounded-lg border border-market-mint/60 bg-market-mint/12 px-5 text-lg font-black text-market-mint transition hover:bg-market-mint hover:text-market-ink disabled:cursor-not-allowed disabled:border-slate-600 disabled:bg-slate-600 disabled:text-slate-300"
          >
            เพิ่มรายการวันนี้
          </button>
          <button
            type="button"
            onClick={onBackup}
            disabled={locked || isReplacing || isClearing}
            className="min-h-16 rounded-lg border border-market-blue/60 bg-market-blue/12 px-5 text-lg font-black text-sky-100 transition hover:bg-market-blue hover:text-market-ink"
          >
            Backup วันนี้เป็น CSV
          </button>
          <button
            type="button"
            onClick={onClear}
            disabled={locked || isReplacing || isClearing}
            className="min-h-16 rounded-lg border border-market-red/70 bg-market-red/12 px-5 text-lg font-black text-red-100 transition hover:bg-market-red hover:text-white"
          >
            {isClearing ? "กำลังล้าง..." : "ล้างข้อมูลวันนี้"}
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-white/10 bg-market-panel/92 p-4 shadow-touch">
        <h3 className="text-lg font-black text-white">ตัวอย่างก่อนสร้างรายการ</h3>
        <div className="mt-4 grid gap-3">
          {items.map((item, index) => (
            <div key={`${item.name}-${index}`} className="rounded-lg border border-white/10 bg-white/5 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-black text-white">{item.name}</p>
                  <p className="mt-1 text-sm font-semibold text-emerald-100/70">
                    {item.quantity} {item.unit} | เพดาน {item.maxPrice} บาท
                  </p>
                </div>
                <span className="rounded-md bg-market-blue/16 px-2 py-1 text-xs font-black text-sky-100">
                  #{index + 1}
                </span>
              </div>
              {item.note && <p className="mt-3 text-sm font-semibold text-amber-100">{item.note}</p>}
            </div>
          ))}
        </div>
      </section>
      </div>
      {locked && (
        <ImportPinOverlay
          pinValue={pinValue}
          pinError={pinError}
          isChecking={isPinChecking}
          onPinChange={onPinChange}
          onUnlock={onUnlock}
        />
      )}
    </div>
  );
}

function ImportPinOverlay({
  pinValue,
  pinError,
  isChecking,
  onPinChange,
  onUnlock,
  onClose,
}: {
  pinValue: string;
  pinError: string;
  isChecking: boolean;
  onPinChange: (value: string) => void;
  onUnlock: () => void;
  onClose?: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-market-ink/75 px-3 py-6 backdrop-blur-sm">
      <form
        className="w-full max-w-sm rounded-lg border border-market-mint/35 bg-market-panel p-4 shadow-touch sm:p-5"
        onSubmit={(event) => {
          event.preventDefault();
          void onUnlock();
        }}
      >
        <h2 className="text-center text-2xl font-black text-white">จัดการ Product Master</h2>
        <p className="mt-2 text-center text-sm font-semibold leading-6 text-emerald-100/70">
          ใส่ Owner PIN เพื่อเพิ่ม แก้ไข หรือลบข้อมูลสินค้า
        </p>
        <label className="mt-4 block text-sm font-bold text-emerald-100/70" htmlFor="import-owner-pin">
          รหัส PIN
        </label>
        <input
          id="import-owner-pin"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={pinValue}
          onChange={(event) => onPinChange(event.target.value)}
          className="mt-2 h-14 w-full rounded-lg border border-market-line bg-market-ink px-4 text-center text-2xl font-black text-white outline-none transition focus:border-market-mint focus:ring-4 focus:ring-market-mint/25"
        />
        {pinError && <p className="mt-3 rounded-lg border border-market-red/50 bg-market-red/12 px-3 py-2 text-sm font-black text-red-100">{pinError}</p>}
        <button
          type="submit"
          disabled={isChecking}
          className="mt-4 min-h-14 w-full rounded-lg bg-market-green px-4 text-base font-black text-market-ink transition hover:bg-market-mint disabled:cursor-wait disabled:bg-slate-600 disabled:text-slate-300"
        >
          {isChecking ? "กำลังตรวจสอบ..." : "ปลดล็อก"}
        </button>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="mt-2 min-h-12 w-full rounded-lg border border-white/15 bg-white/5 px-4 font-black text-white"
          >
            ยกเลิก
          </button>
        )}
      </form>
    </div>
  );
}

function PhoneOrderPage({
  items,
  onUpdate,
}: {
  items: PhoneOrderItem[];
  onUpdate: (
    item: PhoneOrderItem,
    updates: Pick<PhoneOrderItem, "quantity" | "unit" | "supplierName">,
  ) => Promise<boolean>;
}) {
  const [copiedSupplier, setCopiedSupplier] = useState("");
  const [editingItem, setEditingItem] = useState<PhoneOrderItem | null>(null);
  const [editQuantity, setEditQuantity] = useState("");
  const [editUnit, setEditUnit] = useState<ProductUnit>(PRODUCT_UNITS[0]);
  const [editSupplier, setEditSupplier] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const groupedItems = useMemo(() => {
    const groups = new Map<string, PhoneOrderItem[]>();
    for (const item of items) {
      const supplier = item.supplierName.trim();
      groups.set(supplier, [...(groups.get(supplier) ?? []), item]);
    }
    return Array.from(groups.entries()).sort(([left], [right]) => left.localeCompare(right, "th"));
  }, [items]);

  async function copySupplierOrder(supplier: string, supplierItems: PhoneOrderItem[]) {
    const text = [
      "สวัสดีครับ ขอรายการดังนี้",
      ...supplierItems.map((item) => `${item.productName} ${item.quantity} ${item.unit}`),
      "ขอบคุณครับ",
    ].join("\n");

    try {
      await navigator.clipboard.writeText(text);
      setCopiedSupplier(supplier);
      window.setTimeout(() => setCopiedSupplier((current) => current === supplier ? "" : current), 2_000);
      playBeep("soft");
    } catch (error) {
      logSupabaseError("Clipboard copy failed", error);
      window.alert("คัดลอกไม่สำเร็จ กรุณาอนุญาตการใช้งานคลิปบอร์ด");
    }
  }

  function openEditor(item: PhoneOrderItem) {
    setEditingItem(item);
    setEditQuantity(item.quantity);
    setEditUnit(PRODUCT_UNITS.includes(item.unit as ProductUnit) ? item.unit as ProductUnit : PRODUCT_UNITS[0]);
    setEditSupplier(item.supplierName);
    setEditError("");
  }

  async function saveEdit() {
    if (!editingItem || isSaving) return;
    const quantity = editQuantity.trim();
    const supplierName = editSupplier.trim();
    if (!quantity || !Number.isFinite(Number(quantity)) || Number(quantity) <= 0 || !supplierName) {
      setEditError("กรุณากรอกจำนวนที่มากกว่า 0 และชื่อร้าน");
      return;
    }
    setIsSaving(true);
    setEditError("");
    const succeeded = await onUpdate(editingItem, { quantity, unit: editUnit, supplierName });
    setIsSaving(false);
    if (succeeded) setEditingItem(null);
    else setEditError("บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง");
  }

  return (
    <section>
      <div className="grid gap-3 sm:grid-cols-2">
        <SummaryCard label="ร้านทั้งหมด" value={groupedItems.length} tone="blue" />
        <SummaryCard label="รายการโทรสั่งทั้งหมด" value={items.length} tone="mint" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {groupedItems.length === 0 ? (
          <div className="rounded-lg border border-dashed border-white/15 bg-market-panel/70 p-8 text-center font-black text-emerald-100/70 lg:col-span-2">
            ยังไม่มีรายการโทรสั่ง
          </div>
        ) : groupedItems.map(([supplier, supplierItems]) => (
          <article key={supplier} className="rounded-lg border border-sky-300/25 bg-sky-300/[0.06] p-3 shadow-touch sm:p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
              <div>
                <h2 className="text-xl font-black text-white">{supplier}</h2>
                <p className="text-sm font-bold text-sky-100/65">{supplierItems.length} รายการ</p>
              </div>
              <button
                type="button"
                onClick={() => void copySupplierOrder(supplier, supplierItems)}
                className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-sky-300/45 bg-sky-300/12 px-3 text-sm font-black text-sky-100"
              >
                <Copy className="h-4 w-4" />
                {copiedSupplier === supplier ? "คัดลอกแล้ว" : "คัดลอกรายการ"}
              </button>
            </div>

            <div className="mt-3 grid gap-2">
              {supplierItems.map((item) => (
                <div key={item.id} className="grid gap-2 rounded-lg border border-white/10 bg-market-ink/55 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div className="min-w-0">
                    <p className="font-black text-white">{item.productName}</p>
                    <p className="mt-0.5 font-bold text-market-mint">{item.quantity} {item.unit}</p>
                    {item.note && <p className="mt-1 text-xs font-semibold text-emerald-100/55">{item.note}</p>}
                  </div>
                  <button
                    type="button"
                    onClick={() => openEditor(item)}
                    className="flex min-h-10 items-center justify-center gap-1 rounded-lg border border-sky-300/40 bg-sky-300/10 px-3 text-sm font-black text-sky-100"
                  >
                    <Pencil className="h-4 w-4" /> แก้ไข
                  </button>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>

      {editingItem && (
        <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/75 px-3 py-5 backdrop-blur-sm">
          <section className="w-full max-w-md rounded-lg border border-sky-300/35 bg-market-panel p-4 shadow-touch sm:p-5">
            <h2 className="text-2xl font-black text-white">แก้ไขรายการโทรสั่ง</h2>
            <div className="mt-4 grid gap-3">
              <label>
                <span className="mb-1 block text-sm font-black text-emerald-100/70">สินค้า</span>
                <input value={editingItem.productName} readOnly className="h-12 w-full rounded-lg border border-white/10 bg-white/5 px-3 font-bold text-slate-300" />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label>
                  <span className="mb-1 block text-sm font-black text-emerald-100/70">จำนวน *</span>
                  <input value={editQuantity} onChange={(event) => setEditQuantity(event.target.value)} inputMode="decimal" className="h-12 w-full rounded-lg border border-market-line bg-market-ink px-3 font-black text-white outline-none focus:border-market-mint" />
                </label>
                <label>
                  <span className="mb-1 block text-sm font-black text-emerald-100/70">หน่วย *</span>
                  <select value={editUnit} onChange={(event) => setEditUnit(event.target.value as ProductUnit)} className="h-12 w-full rounded-lg border border-market-line bg-market-ink px-3 font-black text-white outline-none focus:border-market-mint">
                    {PRODUCT_UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                  </select>
                </label>
              </div>
              <label>
                <span className="mb-1 block text-sm font-black text-emerald-100/70">ชื่อร้าน *</span>
                <input value={editSupplier} onChange={(event) => setEditSupplier(event.target.value)} className="h-12 w-full rounded-lg border border-market-line bg-market-ink px-3 font-bold text-white outline-none focus:border-market-mint" />
              </label>
              {editError && <p className="rounded-lg border border-market-red/50 bg-market-red/12 px-3 py-2 text-sm font-black text-red-100">{editError}</p>}
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button type="button" onClick={() => setEditingItem(null)} disabled={isSaving} className="min-h-12 rounded-lg border border-white/15 bg-white/5 px-4 font-black text-white">ยกเลิก</button>
              <button type="button" onClick={() => void saveEdit()} disabled={isSaving} className="min-h-12 rounded-lg bg-market-green px-4 font-black text-market-ink disabled:bg-slate-600">
                {isSaving ? "กำลังบันทึก..." : "บันทึก"}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

function PendingPage({
  items,
  allPendingItems,
  productCategoryByName,
  totalItems,
  selectedCategory,
  onCategoryChange,
  onPrint,
  activeBuyer,
  onBought,
  onUnavailable,
}: {
  items: FreshBuyItem[];
  allPendingItems: FreshBuyItem[];
  productCategoryByName: Record<string, ProductCategory>;
  totalItems: number;
  selectedCategory: PendingCategoryFilter;
  onCategoryChange: (category: PendingCategoryFilter) => void;
  onPrint: () => void;
  activeBuyer: BuyerName;
  onBought: (item: FreshBuyItem) => void;
  onUnavailable: (item: FreshBuyItem) => void;
}) {
  const [isCopied, setIsCopied] = useState(false);
  const countText = selectedCategory !== "ทั้งหมด"
    ? `รอซื้อ ${items.length} / ${totalItems} รายการ`
    : `รอซื้อ ${totalItems} รายการ`;

  async function copyPendingItems() {
    const categorySections = PRODUCT_CATEGORIES.map((category) => {
      const categoryItems = allPendingItems.filter((item) =>
        (productCategoryByName[normalizeProductName(item.name)] ?? "อื่นๆ") === category,
      );
      if (categoryItems.length === 0) return "";
      return [
        `รายการ ${category}`,
        ...categoryItems.map((item) => `${item.name} ${item.quantity} ${item.unit}`),
      ].join("\n");
    }).filter(Boolean);
    const text = ["รายการซื้อวันนี้", ...categorySections].join("\n\n");

    try {
      await navigator.clipboard.writeText(text);
      setIsCopied(true);
      window.setTimeout(() => setIsCopied(false), 2_000);
      playBeep("soft");
    } catch (error) {
      logSupabaseError("Pending list clipboard copy failed", error);
      window.alert("คัดลอกไม่สำเร็จ กรุณาอนุญาตการใช้งานคลิปบอร์ด");
    }
  }

  return (
    <section>
      <div className="mb-3 grid gap-2 sm:mb-4 sm:gap-3 xl:grid-cols-[minmax(220px,0.55fr)_minmax(0,1.45fr)]">
        <SectionHeader
          title="รายการซื้อวันนี้"
          detail={`ผู้ใช้งาน: ${activeBuyer} | ${countText}`}
          icon={ShoppingBasket}
        />
        <div className="flex min-h-[52px] flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-market-panel/72 p-2 sm:min-h-[68px] sm:p-3">
          {(["ทั้งหมด", ...PRODUCT_CATEGORIES] as PendingCategoryFilter[]).map((category) => (
            <button
              key={category}
              type="button"
              onClick={() => onCategoryChange(category)}
              className={`min-h-10 rounded-lg border px-3 text-sm font-black transition ${
                selectedCategory === category
                  ? "border-market-mint bg-market-mint text-market-ink"
                  : "border-white/12 bg-white/5 text-emerald-50"
              }`}
            >
              {category}
            </button>
          ))}
          <div className="ml-auto flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void copyPendingItems()}
              className="flex min-h-10 items-center justify-center gap-2 rounded-lg border border-sky-300/45 bg-sky-300/12 px-3 text-sm font-black text-sky-100"
            >
              <Copy className="h-4 w-4" /> {isCopied ? "คัดลอกแล้ว" : "คัดลอกรายการ"}
            </button>
            <button
              type="button"
              onClick={onPrint}
              className="flex min-h-10 items-center justify-center gap-2 rounded-lg bg-white px-3 text-sm font-black text-market-ink"
            >
              <Printer className="h-4 w-4" /> พิมพ์รายการซื้อ
            </button>
          </div>
        </div>
      </div>
      {items.length === 0 ? (
        <EmptyState text={selectedCategory === "ทั้งหมด" ? "ไม่มีรายการรอซื้อแล้ว" : `ไม่มีรายการในหมวด ${selectedCategory}`} />
      ) : (
        <div className="grid gap-2 min-[560px]:grid-cols-2 sm:gap-2.5">
          {items.map((item) => (
            <PendingProductCard
              key={item.id}
              item={item}
              onBought={() => onBought(item)}
              onUnavailable={() => onUnavailable(item)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function PendingProductCard({
  item,
  onBought,
  onUnavailable,
}: {
  item: FreshBuyItem;
  onBought: () => void;
  onUnavailable: () => void;
}) {
  return (
    <article className="grid w-full max-w-full grid-cols-2 gap-2 rounded-lg border border-white/10 bg-market-panel/92 p-2 shadow-touch min-[560px]:grid-cols-[minmax(0,1fr)_max-content_76px_82px] min-[560px]:items-center">
      <div className="col-span-2 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 min-[560px]:contents">
        <h3 className="line-clamp-2 min-w-0 text-lg font-black leading-tight text-white min-[560px]:text-base lg:text-lg">
          {item.name}
        </h3>
        <p className="shrink-0 whitespace-nowrap text-sm font-black leading-tight text-market-mint min-[560px]:text-[13px] lg:text-sm">
          {item.quantity} {item.unit}
        </p>
      </div>

      <button
        type="button"
        onClick={onBought}
        className="min-h-10 rounded-lg bg-market-green px-2 text-sm font-black text-market-ink transition hover:bg-market-mint min-[560px]:min-h-9 min-[560px]:text-xs lg:text-sm"
      >
        ซื้อแล้ว
      </button>
      <button
        type="button"
        onClick={onUnavailable}
        className="min-h-10 rounded-lg border border-market-red/70 bg-market-red/12 px-2 text-sm font-black text-red-100 transition hover:bg-market-red hover:text-white min-[560px]:min-h-9 min-[560px]:text-xs lg:text-sm"
      >
        ไม่มีของ
      </button>
    </article>
  );
}

function BoughtPage({
  items,
  activeFilter,
  onFilterChange,
  onEditPrice,
  onBack,
}: {
  items: FreshBuyItem[];
  activeFilter: BoughtFilter;
  onFilterChange: (filter: BoughtFilter) => void;
  onEditPrice: (item: FreshBuyItem) => void;
  onBack: (item: FreshBuyItem) => void;
}) {
  const totalBoughtAmount = items.reduce((sum, item) => sum + getActualPriceNumber(item), 0);
  const amountText = `${new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 }).format(totalBoughtAmount)} บาท`;
  const filters: { id: BoughtFilter; label: string; count: number | string }[] = [
    { id: "bought", label: "ซื้อแล้วทั้งหมด", count: items.length },
    { id: "loaded", label: "ครบ", count: items.filter((item) => getVehicleStatus(item) === "loaded").length },
    {
      id: "incomplete",
      label: "ไม่ครบ",
      count: items.filter((item) => getVehicleStatus(item) === "incomplete").length,
    },
    {
      id: "unchecked",
      label: "ยังไม่ได้เช็คขึ้นรถ",
      count: items.filter((item) => getVehicleStatus(item) === "unchecked").length,
    },
  ];

  const displayFilters = filters.map((filter) =>
    filter.id === "bought" ? { ...filter, label: "ยอดเงินรวมทั้งหมด", count: amountText } : filter,
  );

  const visibleItems = items.filter((item) => {
    if (activeFilter === "bought") return true;
    return getVehicleStatus(item) === activeFilter;
  });

  return (
    <section>
      <div className="mb-3 grid gap-2 sm:mb-4 sm:gap-3 xl:grid-cols-[minmax(220px,0.7fr)_minmax(0,1.3fr)] xl:items-center">
        <SectionHeader title="ซื้อแล้ว" detail={`รวม ${items.length} รายการ`} icon={ClipboardList} />
        <div className="grid grid-cols-2 gap-1.5 sm:gap-2 lg:grid-cols-4">
          {displayFilters.map((filter) => (
            <button
              key={filter.id}
              type="button"
              onClick={() => onFilterChange(filter.id)}
              className={`min-h-12 rounded-lg border px-2.5 text-left transition sm:min-h-14 sm:px-3 ${
                activeFilter === filter.id
                  ? "border-market-mint bg-market-mint text-market-ink"
                  : "border-market-green/30 bg-market-green/10 text-emerald-50 hover:border-market-mint/60 hover:bg-market-green/15"
              }`}
            >
              <span className="block text-[11px] font-black leading-tight opacity-80 sm:text-xs">{filter.label}</span>
              <span className="mt-1 block text-lg font-black sm:text-xl">{filter.count}</span>
            </button>
          ))}
        </div>
      </div>
      {items.length === 0 ? (
        <EmptyState text="ยังไม่มีรายการซื้อแล้ว" />
      ) : visibleItems.length === 0 ? (
        <EmptyState text="ไม่มีรายการในตัวกรองนี้" />
      ) : (
        <div className="grid gap-2">
          {visibleItems.map((item) => (
            <BoughtItemRow
              key={item.id}
              item={item}
              onEditPrice={() => onEditPrice(item)}
              onBack={() => onBack(item)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function BoughtItemRow({
  item,
  onEditPrice,
  onBack,
}: {
  item: FreshBuyItem;
  onEditPrice: () => void;
  onBack: () => void;
}) {
  const vehicleStatus = getVehicleStatus(item);
  const statusClassName = getVehicleStatusClassName(vehicleStatus);
  const actualPriceText = item.actualPrice === "" ? "-" : `${item.actualPrice}`;
  const boughtTimeText = formatPurchaseTimeOnly(item.boughtAt);

  return (
    <>
      <article className="viewport-mobile-card grid w-full max-w-full gap-1.5 rounded-lg border border-market-green/30 bg-market-green/10 p-2.5 shadow-touch">
        <div>
          <h3 className="line-clamp-2 text-lg font-black leading-tight text-white">{item.name}</h3>
          <p className="mt-1 text-[13px] font-bold leading-snug text-emerald-50/86">
            {item.quantity} {item.unit} | {actualPriceText} | {item.buyerName || "-"} | {boughtTimeText}
          </p>
        </div>

        <div className="mt-1 grid gap-1.5">
          <span className={`inline-flex min-h-7 w-fit items-center rounded-lg border px-2 text-xs font-black ${statusClassName}`}>
            {VEHICLE_STATUS_LABELS[vehicleStatus]}
          </span>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={onEditPrice}
              className="flex min-h-10 items-center justify-center rounded-lg border border-market-mint/50 bg-market-mint/12 px-2 text-sm font-black text-market-mint transition hover:bg-market-mint hover:text-market-ink"
            >
              แก้ราคา
            </button>
            <button
              type="button"
              onClick={onBack}
              className="flex min-h-10 items-center justify-center gap-1 rounded-lg border border-market-blue/60 bg-market-blue/12 px-2 text-sm font-black text-sky-100"
            >
              <RotateCcw className="h-4 w-4" />
              กลับไปรอซื้อ
            </button>
          </div>
        </div>
      </article>

      <article className="viewport-fluid-row bought-fluid-row w-full max-w-full items-center gap-1.5 rounded-lg border border-market-green/30 bg-market-green/10 p-2 shadow-touch sm:gap-2 xl:gap-3 xl:p-3">
        <div>
          <p className="fluid-row-label text-[11px] font-bold leading-tight text-emerald-100/50">สินค้า</p>
          <h3 className="fluid-row-title line-clamp-2 font-black leading-tight text-white">{item.name}</h3>
        </div>
        <div>
          <p className="fluid-row-label text-[11px] font-bold leading-tight text-emerald-100/50">จำนวน</p>
          <p className="text-sm font-black leading-tight text-market-mint sm:text-base xl:text-lg">
            {item.quantity} {item.unit}
          </p>
        </div>
        <RowValue label="ราคาซื้อ" value={actualPriceText} strong />
        <RowValue label="ผู้ซื้อ" value={item.buyerName || "-"} />
        <RowValue label="เวลาซื้อ" value={boughtTimeText} />
        <VehicleStatusBadge status={vehicleStatus} />
        <button
          type="button"
          onClick={onEditPrice}
          className="fluid-row-action flex items-center justify-center rounded-lg border border-market-mint/50 bg-market-mint/12 font-black text-market-mint transition hover:bg-market-mint hover:text-market-ink"
        >
          แก้ราคา
        </button>
        <button
          type="button"
          onClick={onBack}
          className="fluid-row-action flex items-center justify-center gap-1 rounded-lg border border-market-blue/60 bg-market-blue/12 font-black text-sky-100 xl:gap-2"
        >
          <RotateCcw className="h-4 w-4 shrink-0 xl:h-5 xl:w-5" />
          กลับไปรอซื้อ
        </button>
      </article>
    </>
  );
}

function RowValue({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="fluid-row-label text-[11px] font-bold leading-tight text-emerald-100/50">{label}</p>
      <p
        className={`truncate leading-tight ${
          strong
            ? "text-sm font-black text-white xl:text-lg"
            : "text-xs font-bold text-emerald-50 sm:text-sm"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function VehicleStatusBadge({ status }: { status: VehicleStatus }) {
  const className = getVehicleStatusClassName(status);

  return (
    <div className="min-w-0">
      <p className="fluid-row-label text-[11px] font-bold leading-tight text-emerald-100/50">สถานะขึ้นรถ</p>
      <span className={`inline-flex min-h-7 max-w-full items-center rounded-lg border px-1.5 text-[11px] font-black leading-tight sm:px-2 xl:min-h-9 xl:px-3 xl:text-sm ${className}`}>
        {VEHICLE_STATUS_LABELS[status]}
      </span>
    </div>
  );
}

function getVehicleStatusClassName(status: VehicleStatus) {
  return {
    unchecked: "border-market-amber/50 bg-market-amber/12 text-amber-100",
    loaded: "border-market-green/60 bg-market-green/18 text-green-50",
    incomplete: "border-market-red/60 bg-market-red/16 text-red-50",
  }[status];
}

function UnavailablePage({
  items,
  onBack,
}: {
  items: FreshBuyItem[];
  onBack: (item: FreshBuyItem) => void;
}) {
  return (
    <section>
      <SectionHeader title="ไม่มีของ" detail={`รวม ${items.length} รายการ`} icon={PackageX} />
      {items.length === 0 ? (
        <EmptyState text="ยังไม่มีรายการไม่มีของ" />
      ) : (
        <div className="grid gap-2">
          {items.map((item) => (
            <UnavailableItemRow key={item.id} item={item} onBack={() => onBack(item)} />
          ))}
        </div>
      )}
    </section>
  );
}

function UnavailableItemRow({ item, onBack }: { item: FreshBuyItem; onBack: () => void }) {
  const timeText = formatPurchaseTimeOnly(item.boughtAt || item.checkedAt);

  return (
    <>
      <article className="viewport-mobile-card grid w-full max-w-full gap-1.5 rounded-lg border border-market-red/35 bg-market-red/10 p-2.5 shadow-touch">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
          <h3 className="line-clamp-2 text-lg font-black leading-tight text-white">{item.name}</h3>
          <button
            type="button"
            onClick={onBack}
            className="flex min-h-9 items-center justify-center gap-1 rounded-lg border border-market-blue/60 bg-market-blue/12 px-2 text-xs font-black text-sky-100"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            กลับไปรอซื้อ
          </button>
        </div>
        <p className="text-[13px] font-bold leading-snug text-emerald-50/86">
          {item.quantity} {item.unit} | {item.buyerName || "-"} | {timeText}
        </p>
      </article>

      <article className="viewport-fluid-row unavailable-fluid-row w-full max-w-full items-center gap-1.5 rounded-lg border border-market-red/35 bg-market-red/10 p-2 shadow-touch sm:gap-2 xl:gap-3 xl:p-3">
        <div>
          <p className="fluid-row-label text-[11px] font-bold leading-tight text-red-100/60">สินค้า</p>
          <h3 className="fluid-row-title line-clamp-2 font-black leading-tight text-white">{item.name}</h3>
        </div>
        <div>
          <p className="fluid-row-label text-[11px] font-bold leading-tight text-red-100/60">จำนวน</p>
          <p className="text-sm font-black leading-tight text-market-mint sm:text-base xl:text-lg">
            {item.quantity} {item.unit}
          </p>
        </div>
        <RowValue label="ผู้บันทึก" value={item.buyerName || "-"} />
        <RowValue label="เวลา" value={timeText} />
        <button
          type="button"
          onClick={onBack}
          className="fluid-row-action flex items-center justify-center gap-1 rounded-lg border border-market-blue/60 bg-market-blue/12 font-black text-sky-100 xl:gap-2"
        >
          <RotateCcw className="h-4 w-4 shrink-0 xl:h-5 xl:w-5" />
          กลับไปรอซื้อ
        </button>
      </article>
    </>
  );
}

function CheckPage({
  items,
  checkedTotal,
  boughtTotal,
  onComplete,
  onMissing,
}: {
  items: FreshBuyItem[];
  checkedTotal: number;
  boughtTotal: number;
  onComplete: (item: FreshBuyItem) => void;
  onMissing: (item: FreshBuyItem) => void;
}) {
  return (
    <section>
      <SectionHeader
        title="เช็คขึ้นรถ"
        detail={`ความคืบหน้า ${checkedTotal} / ${boughtTotal} | รอเช็ค ${items.length} รายการ`}
        icon={Truck}
      />
      <div className="mb-3 h-3 overflow-hidden rounded-full bg-white/10 sm:mb-4 sm:h-4">
        <div
          className="h-full rounded-full bg-market-mint transition-all"
          style={{ width: `${boughtTotal === 0 ? 0 : Math.round((checkedTotal / boughtTotal) * 100)}%` }}
        />
      </div>
      {items.length === 0 ? (
        <EmptyState text="ไม่มีรายการรอเช็คขึ้นรถ" />
      ) : (
        <div className="grid gap-2">
          {items.map((item) => (
            <CheckItemRow
              key={item.id}
              item={item}
              onComplete={() => onComplete(item)}
              onMissing={() => onMissing(item)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function CheckItemRow({
  item,
  onComplete,
  onMissing,
}: {
  item: FreshBuyItem;
  onComplete: () => void;
  onMissing: () => void;
}) {
  const actualPriceText = item.actualPrice === "" ? "-" : `${item.actualPrice}`;
  const boughtTimeText = formatPurchaseTimeOnly(item.boughtAt);

  return (
    <>
      <article className="viewport-mobile-card grid w-full max-w-full gap-1.5 rounded-lg border border-white/10 bg-market-panel/92 p-2.5 shadow-touch">
        <p className="text-[13px] font-bold leading-snug text-emerald-50/90">
          <span className="font-black text-white">{item.name}</span> | {item.quantity} {item.unit} | {actualPriceText} | {item.buyerName || "-"} | {boughtTimeText}
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={onComplete}
            className="min-h-10 rounded-lg bg-market-green px-3 text-sm font-black text-market-ink transition hover:bg-market-mint"
          >
            ครบ
          </button>
          <button
            type="button"
            onClick={onMissing}
            className="min-h-10 rounded-lg border border-market-amber/70 bg-market-amber/12 px-3 text-sm font-black text-amber-100 transition hover:bg-market-amber hover:text-market-ink"
          >
            ของไม่ครบ
          </button>
        </div>
      </article>

      <article className="viewport-fluid-row check-fluid-row w-full max-w-full items-center gap-1.5 rounded-lg border border-white/10 bg-market-panel/92 p-2 shadow-touch sm:gap-2 xl:gap-3 xl:p-3">
        <div>
          <p className="fluid-row-label text-[11px] font-bold leading-tight text-emerald-100/50">สินค้า</p>
          <h3 className="fluid-row-title line-clamp-2 font-black leading-tight text-white">{item.name}</h3>
        </div>
        <div>
          <p className="fluid-row-label text-[11px] font-bold leading-tight text-emerald-100/50">จำนวน</p>
          <p className="text-sm font-black leading-tight text-market-mint sm:text-base xl:text-lg">
            {item.quantity} {item.unit}
          </p>
        </div>
        <RowValue label="ราคาซื้อ" value={actualPriceText} strong />
        <RowValue label="ผู้ซื้อ" value={item.buyerName || "-"} />
        <RowValue label="เวลาซื้อ" value={boughtTimeText} />
        <button
          type="button"
          onClick={onComplete}
          className="fluid-row-action rounded-lg bg-market-green font-black text-market-ink transition hover:bg-market-mint"
        >
          ครบ
        </button>
        <button
          type="button"
          onClick={onMissing}
          className="fluid-row-action rounded-lg border border-market-amber/70 bg-market-amber/12 font-black text-amber-100 transition hover:bg-market-amber hover:text-market-ink"
        >
          ของไม่ครบ
        </button>
      </article>
    </>
  );
}

function HistoryPage({
  statuses,
  groupedByStatus,
  onPrint,
}: {
  statuses: ItemStatus[];
  groupedByStatus: (status: ItemStatus) => FreshBuyItem[];
  onPrint: () => void;
}) {
  return (
    <section>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SectionHeader title="ประวัติวันนี้" detail="แยกตามสถานะ พร้อมหน้าพิมพ์สำรอง" icon={History} />
        <button
          type="button"
          onClick={onPrint}
          className="flex min-h-14 items-center justify-center gap-2 rounded-lg bg-white px-5 text-base font-black text-market-ink"
        >
          <FileDown className="h-5 w-5" />
          พิมพ์รายการซื้อ
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {statuses.map((status) => {
          const group = groupedByStatus(status);
          return (
            <div key={status} className={`rounded-lg border p-4 ${STATUS_STYLES[status]}`}>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-lg font-black">{STATUS_LABELS[status]}</h3>
                <span className="text-2xl font-black">{group.length}</span>
              </div>
              <div className="grid gap-2">
                {group.length === 0 ? (
                  <p className="text-sm font-semibold opacity-70">ไม่มีรายการ</p>
                ) : (
                  group.map((item) => <HistoryRow key={item.id} item={item} />)
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/8 bg-white/5 p-3">
      <p className="text-xs text-emerald-100/50">{label}</p>
      <p className="mt-1 break-words text-sm text-emerald-50">{value}</p>
    </div>
  );
}

function SectionHeader({
  title,
  detail,
  icon: Icon,
}: {
  title: string;
  detail: string;
  icon: React.ElementType;
}) {
  return (
    <div className="mb-3 flex items-center gap-2 sm:mb-4 sm:gap-3">
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-market-green text-market-ink sm:h-12 sm:w-12">
        <Icon className="h-5 w-5 sm:h-6 sm:w-6" />
      </div>
      <div>
        <h2 className="text-xl font-black text-white sm:text-2xl">{title}</h2>
        <p className="text-xs font-semibold text-emerald-100/64 sm:text-sm">{detail}</p>
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="grid min-h-44 place-items-center rounded-lg border border-dashed border-white/16 bg-market-panel/62 p-4 text-center sm:min-h-64 sm:p-6">
      <div>
        <UserRoundCheck className="mx-auto h-10 w-10 text-market-mint sm:h-12 sm:w-12" />
        <p className="mt-2 text-lg font-black text-white sm:mt-3 sm:text-xl">{text}</p>
      </div>
    </div>
  );
}

function HistoryRow({ item }: { item: FreshBuyItem }) {
  return (
    <div className="rounded-lg bg-black/16 p-3 text-sm font-semibold">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-base font-black">{item.name}</span>
        <span>
          {item.quantity} {item.unit}
        </span>
      </div>
      <p className="mt-1 opacity-80">
        ผู้ซื้อ {item.buyerName || "-"} | เวลา {formatDisplayTime(item.boughtAt || item.checkedAt)}
      </p>
      {item.issueNote && <p className="mt-1 font-bold">{item.issueNote}</p>}
    </div>
  );
}

function PrintSection({ items }: { items: FreshBuyItem[] }) {
  const rowsPerTable = 42;
  const itemGroups: FreshBuyItem[][] =
    items.length === 0
      ? [[]]
      : Array.from({ length: Math.ceil(items.length / rowsPerTable) }, (_, groupIndex) =>
          items.slice(groupIndex * rowsPerTable, (groupIndex + 1) * rowsPerTable),
        );

  return (
    <section className="print-area hidden">
      <div className="print-header">
        <h1>FreshBuy Team OS - รายการซื้อวันนี้</h1>
        <p>วันที่พิมพ์: {nowStamp()}</p>
        <p>รวมทั้งหมด: {items.length} รายการ</p>
      </div>

      <div className="print-grid">
        {itemGroups.map((group, groupIndex) => (
          <table key={groupIndex} className="print-table">
            <thead>
              <tr>
                <th>รายการ</th>
                <th>จำนวน</th>
                <th>หน่วย</th>
                <th>ซื้อแล้ว</th>
                <th>ขาดตลาด</th>
                <th>ราคา</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="print-empty">
                    ไม่มีรายการ
                  </td>
                </tr>
              ) : (
                group.map((item) => (
                  <tr key={item.id}>
                    <td>{item.name}</td>
                    <td>{item.quantity}</td>
                    <td>{item.unit}</td>
                    <td>
                      <span className="print-check-box" aria-hidden="true"></span>
                    </td>
                    <td>
                      <span className="print-check-box" aria-hidden="true"></span>
                    </td>
                    <td>
                      <span className="print-price-line" aria-hidden="true"></span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        ))}
      </div>
    </section>
  );
}

function PurchasePrintSection({
  items,
  productCategoryByName,
}: {
  items: FreshBuyItem[];
  productCategoryByName: Record<string, ProductCategory>;
}) {
  const groupedItems = PRODUCT_CATEGORIES.map((category) => ({
    category,
    items: items.filter((item) =>
      (productCategoryByName[normalizeProductName(item.name)] ?? "อื่นๆ") === category,
    ),
  })).filter((group) => group.items.length > 0);

  return (
    <section className="print-area hidden">
      <div className="print-header">
        <h1>FreshBuy Team OS - รายการซื้อวันนี้</h1>
        <p>วันที่พิมพ์: {nowStamp()}</p>
        <p>รอซื้อทั้งหมด: {items.length} รายการ</p>
      </div>
      <div className="purchase-print-grid">
        {groupedItems.length === 0 ? (
          <p className="print-empty">ไม่มีรายการรอซื้อ</p>
        ) : groupedItems.map((group) => (
          <section key={group.category} className="purchase-print-section">
            <h2>{group.category} ({group.items.length})</h2>
            <table className="purchase-print-table">
              <thead><tr><th>รายการ</th><th>จำนวน</th><th>หน่วย</th></tr></thead>
              <tbody>
                {group.items.map((item) => (
                  <tr key={item.id}><td>{item.name}</td><td>{item.quantity}</td><td>{item.unit}</td></tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </section>
  );
}
