"use client";

import {
  Check,
  ClipboardList,
  FileDown,
  History,
  PackageX,
  RotateCcw,
  ShoppingBasket,
  Truck,
  Upload,
  UserRoundCheck,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  BUYERS,
  STATUS_LABELS,
  STATUS_STYLES,
  STORAGE_KEY,
  formatDisplayTime,
  getSummary,
  nowIsoStamp,
  nowStamp,
  parseImportText,
  playBeep,
  rowsToItems,
} from "@/lib/freshBuy";
import {
  appendDayItems,
  clearDayItems,
  fetchDayItems,
  getTodayDayKey,
  isSupabaseConfigured,
  replaceDayItems,
  subscribeToDayItems,
  updateDayItem,
} from "@/lib/supabaseFreshBuy";
import type { BuyerName, FreshBuyItem, ItemStatus, VehicleStatus } from "@/lib/types";

type TabId = "import" | "pending" | "bought" | "unavailable" | "check" | "history";
type PriceModalMode = "buy" | "edit";
type BoughtFilter = "bought" | "loaded" | "incomplete" | "unchecked";
type PriceModalState = {
  item: FreshBuyItem;
  mode: PriceModalMode;
} | null;

const tabs: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: "import", label: "นำเข้ารายการ", icon: Upload },
  { id: "pending", label: "ต้องซื้อวันนี้", icon: ShoppingBasket },
  { id: "bought", label: "ซื้อแล้ว", icon: Check },
  { id: "unavailable", label: "ไม่มีของ", icon: PackageX },
  { id: "check", label: "เช็คขึ้นรถ", icon: Truck },
  { id: "history", label: "ประวัติวันนี้", icon: History },
];

const historyStatuses: ItemStatus[] = ["pending", "bought", "checked", "unavailable", "missing", "cancelled"];
const THAI_LETTERS = [
  "ก",
  "ข",
  "ค",
  "ฆ",
  "ง",
  "จ",
  "ฉ",
  "ช",
  "ซ",
  "ฌ",
  "ญ",
  "ฎ",
  "ฏ",
  "ฐ",
  "ฑ",
  "ฒ",
  "ณ",
  "ด",
  "ต",
  "ถ",
  "ท",
  "ธ",
  "น",
  "บ",
  "ป",
  "ผ",
  "ฝ",
  "พ",
  "ฟ",
  "ภ",
  "ม",
  "ย",
  "ร",
  "ล",
  "ว",
  "ศ",
  "ษ",
  "ส",
  "ห",
  "ฬ",
  "อ",
  "ฮ",
];
const THAI_LEADING_VOWELS = new Set(["เ", "แ", "โ", "ใ", "ไ"]);
const THAI_CONSONANTS = new Set(THAI_LETTERS);
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

function getActualPriceNumber(item: FreshBuyItem): number {
  if (item.actualPrice === "" || String(item.actualPrice).trim() === "-") return 0;
  const price = Number(item.actualPrice);
  return Number.isFinite(price) ? price : 0;
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

function getThaiInitialKey(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "";

  const chars = Array.from(trimmed);
  const startIndex = THAI_LEADING_VOWELS.has(chars[0]) ? 1 : 0;
  for (let index = startIndex; index < chars.length; index += 1) {
    const char = chars[index];
    if (THAI_CONSONANTS.has(char)) return char;
  }

  return "";
}

const sampleData = `ผักกาดขาว\t5\tกก.\t25\tเอาสวย ไม่ช้ำ
แตงกวา\t10\tกก.\t30
พริกแดง\t2\tกก.\t90`;

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabId>("import");
  const [activeBuyer, setActiveBuyer] = useState<BuyerName>("ผู้ซื้อ 1");
  const [items, setItems] = useState<FreshBuyItem[]>([]);
  const [pasteText, setPasteText] = useState(sampleData);
  const [hydrated, setHydrated] = useState(false);
  const [priceModal, setPriceModal] = useState<PriceModalState>(null);
  const [buyPrice, setBuyPrice] = useState("");
  const [boughtFilter, setBoughtFilter] = useState<BoughtFilter>("bought");
  const [pendingLetterFilter, setPendingLetterFilter] = useState<string | null>(null);
  const [isBackupConfirmOpen, setIsBackupConfirmOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const dayKey = useMemo(() => getTodayDayKey(), []);

  useEffect(() => {
    if (isSupabaseConfigured) return;

    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        setItems(JSON.parse(saved) as FreshBuyItem[]);
      } catch {
        setItems([]);
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
    if (!isSupabaseConfigured) return;

    let cancelled = false;

    async function refreshItems() {
      try {
        const remoteItems = await fetchDayItems(dayKey);
        if (!cancelled) {
          setItems(remoteItems);
          setHydrated(true);
        }
      } catch (error) {
        console.error("Supabase load failed, using localStorage fallback", error);
        const saved = window.localStorage.getItem(STORAGE_KEY);
        if (saved && !cancelled) {
          try {
            setItems(JSON.parse(saved) as FreshBuyItem[]);
          } catch {
            setItems([]);
          }
        }
        if (!cancelled) setHydrated(true);
      }
    }

    void refreshItems();
    const channel = subscribeToDayItems(dayKey, () => {
      void refreshItems();
    });

    return () => {
      cancelled = true;
      if (channel) void channel.unsubscribe();
    };
  }, [dayKey]);

  const parsedRows = useMemo(() => parseImportText(pasteText), [pasteText]);
  const summary = useMemo(() => getSummary(items), [items]);
  const pendingItems = items.filter((item) => item.status === "pending");
  const filteredPendingItems = pendingLetterFilter
    ? pendingItems.filter((item) => getThaiInitialKey(item.name) === pendingLetterFilter)
    : pendingItems;
  const boughtItems = items.filter((item) => item.status === "bought");
  const unavailableItems = items.filter((item) => item.status === "unavailable");
  const vehicleQueueItems = boughtItems.filter((item) => getVehicleStatus(item) === "unchecked");
  const checkedTotal = boughtItems.filter((item) => getVehicleStatus(item) !== "unchecked").length;
  const boughtTotalForProgress = boughtItems.length;
  const activeTabLabel = tabs.find((tab) => tab.id === activeTab)?.label ?? "";

  function saveLocalFallback(nextItems: FreshBuyItem[]) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextItems));
  }

  async function replaceTodayList() {
    const nextItems = rowsToItems(parsedRows);
    setItems(nextItems);
    setActiveTab("pending");
    playBeep("ok");
    if (!isSupabaseConfigured) return;

    try {
      await replaceDayItems(dayKey, nextItems);
    } catch (error) {
      console.error("Supabase replace failed", error);
      saveLocalFallback(nextItems);
    }
  }

  async function appendTodayList() {
    const newItems = rowsToItems(parsedRows);
    const nextItems = [...items, ...newItems];
    setItems(nextItems);
    setActiveTab("pending");
    playBeep("ok");
    if (!isSupabaseConfigured) return;

    try {
      await appendDayItems(dayKey, newItems);
    } catch (error) {
      console.error("Supabase append failed", error);
      saveLocalFallback(nextItems);
    }
  }

  async function clearToday() {
    if (!window.confirm("ยืนยันการล้างข้อมูลวันนี้?\nข้อมูลรายการซื้อวันนี้ทั้งหมดจะถูกลบ")) return;
    setItems([]);
    setPasteText(sampleData);
    playBeep("warn");
    if (!isSupabaseConfigured) return;

    try {
      await clearDayItems(dayKey);
    } catch (error) {
      console.error("Supabase clear failed", error);
      saveLocalFallback([]);
    }
  }

  function updateItem(id: string, patch: Partial<FreshBuyItem>) {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
    if (!isSupabaseConfigured) return;

    void updateDayItem(id, patch).catch((error) => {
      console.error("Supabase update failed", error);
    });
  }

  function confirmBackupCsv() {
    const csv = buildDailyBackupCsv(items, dayKey);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `freshbuy_${dayKey}.csv`;
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
    return items.filter((item) => item.status === status);
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

          <nav className="hidden grid-cols-2 gap-2 sm:grid md:grid-cols-3 xl:grid-cols-6">
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

      <section className="no-print mx-auto grid max-w-7xl grid-cols-2 gap-2 px-3 pt-3 sm:gap-3 sm:px-4 sm:pt-5 md:grid-cols-5 lg:px-6">
        <SummaryCard label="ต้องซื้อทั้งหมด" value={summary.total} tone="mint" />
        <SummaryCard label="รอซื้อ" value={summary.pending} tone="blue" />
        <SummaryCard label="ซื้อแล้ว" value={summary.bought} tone="green" />
        <SummaryCard label="เช็คครบ" value={summary.checked} tone="mint" />
        <SummaryCard label="ไม่มีของ" value={summary.unavailable} tone="red" />
      </section>

      <section className="no-print mx-auto max-w-7xl px-3 py-3 sm:px-4 sm:py-5 lg:px-6">
        {activeTab === "import" && (
          <ImportPage
            pasteText={pasteText}
            parsedCount={parsedRows.length}
            items={parsedRows}
            onTextChange={setPasteText}
            onCreate={replaceTodayList}
            onAppend={appendTodayList}
            onBackup={() => setIsBackupConfirmOpen(true)}
            onClear={clearToday}
          />
        )}

        {activeTab === "pending" && (
          <PendingPage
            items={filteredPendingItems}
            totalItems={pendingItems.length}
            selectedLetter={pendingLetterFilter}
            onLetterChange={setPendingLetterFilter}
            activeBuyer={activeBuyer}
            onBought={openBuyPopup}
            onUnavailable={markUnavailable}
          />
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
            onPrint={() => window.print()}
          />
        )}
      </section>

      <PrintSection items={items} />
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

function SummaryCard({ label, value, tone }: { label: string; value: number; tone: "mint" | "blue" | "green" | "red" }) {
  const toneClass = {
    mint: "text-market-mint",
    blue: "text-market-blue",
    green: "text-market-green",
    red: "text-market-red",
  }[tone];

  return (
    <div className="rounded-lg border border-white/10 bg-market-panel/88 p-3 shadow-touch sm:p-4">
      <p className="text-xs font-bold text-emerald-100/62">{label}</p>
      <p className={`mt-1 text-2xl font-black sm:mt-2 sm:text-3xl ${toneClass}`}>{value}</p>
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
  onTextChange,
  onCreate,
  onAppend,
  onBackup,
  onClear,
}: {
  pasteText: string;
  parsedCount: number;
  items: ReturnType<typeof parseImportText>;
  onTextChange: (value: string) => void;
  onCreate: () => void;
  onAppend: () => void;
  onBackup: () => void;
  onClear: () => void;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.78fr)]">
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

        <textarea
          value={pasteText}
          onChange={(event) => onTextChange(event.target.value)}
          className="mt-4 min-h-[320px] w-full rounded-lg border border-market-line bg-market-ink p-4 text-lg font-semibold leading-8 text-emerald-50 outline-none ring-market-mint/40 transition placeholder:text-emerald-100/30 focus:border-market-mint focus:ring-4"
          placeholder="ผักกาดขาว&#9;5&#9;กก.&#9;25&#9;เอาสวย ไม่ช้ำ"
        />

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <button
            type="button"
            onClick={onCreate}
            disabled={parsedCount === 0}
            className="min-h-16 rounded-lg bg-market-green px-5 text-lg font-black text-market-ink transition hover:bg-market-mint disabled:cursor-not-allowed disabled:bg-slate-600 disabled:text-slate-300"
          >
            สร้างรายการซื้อวันนี้
          </button>
          <button
            type="button"
            onClick={onAppend}
            disabled={parsedCount === 0}
            className="min-h-16 rounded-lg border border-market-mint/60 bg-market-mint/12 px-5 text-lg font-black text-market-mint transition hover:bg-market-mint hover:text-market-ink disabled:cursor-not-allowed disabled:border-slate-600 disabled:bg-slate-600 disabled:text-slate-300"
          >
            เพิ่มรายการวันนี้
          </button>
          <button
            type="button"
            onClick={onBackup}
            className="min-h-16 rounded-lg border border-market-blue/60 bg-market-blue/12 px-5 text-lg font-black text-sky-100 transition hover:bg-market-blue hover:text-market-ink"
          >
            Backup วันนี้เป็น CSV
          </button>
          <button
            type="button"
            onClick={onClear}
            className="min-h-16 rounded-lg border border-market-red/70 bg-market-red/12 px-5 text-lg font-black text-red-100 transition hover:bg-market-red hover:text-white"
          >
            ล้างข้อมูลวันนี้
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
  );
}

function PendingPage({
  items,
  totalItems,
  selectedLetter,
  onLetterChange,
  activeBuyer,
  onBought,
  onUnavailable,
}: {
  items: FreshBuyItem[];
  totalItems: number;
  selectedLetter: string | null;
  onLetterChange: (letter: string | null) => void;
  activeBuyer: BuyerName;
  onBought: (item: FreshBuyItem) => void;
  onUnavailable: (item: FreshBuyItem) => void;
}) {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const countText = selectedLetter
    ? `รอซื้อ ${items.length} / ${totalItems} รายการ`
    : `รอซื้อ ${totalItems} รายการ`;

  return (
    <section>
      <div className="mb-3 grid gap-2 sm:mb-4 sm:gap-3 xl:grid-cols-[minmax(220px,0.55fr)_minmax(0,1.45fr)]">
        <SectionHeader
          title="ต้องซื้อวันนี้"
          detail={`ผู้ใช้งาน: ${activeBuyer} | ${countText}`}
          icon={ShoppingBasket}
        />
        <div className="grid min-h-[52px] items-center gap-2 rounded-lg border border-white/10 bg-market-panel/72 p-2 sm:min-h-[68px] sm:gap-3 sm:p-3 md:grid-cols-[1fr_auto]">
          <div className="min-h-7 text-center sm:min-h-9 md:text-left">
            {selectedLetter && (
              <p className="text-xl font-black leading-tight text-white sm:text-2xl">
                กำลังกรอง: <span className="text-market-mint">{selectedLetter}</span>
              </p>
            )}
          </div>
          <div className="flex flex-wrap justify-end gap-2 sm:gap-3">
            <button
              type="button"
              onClick={() => setIsSearchOpen(true)}
              className="min-h-10 rounded-lg border border-market-mint/70 bg-market-green px-3 text-sm font-black text-market-ink transition hover:bg-market-mint sm:min-h-11 sm:px-4"
            >
              ค้นหา
            </button>
            <button
              type="button"
              onClick={() => onLetterChange(null)}
              className="min-h-10 rounded-lg border border-white/70 bg-white px-3 text-sm font-black text-market-ink transition hover:border-market-mint/80 sm:min-h-11 sm:px-4"
            >
              ทั้งหมด
            </button>
          </div>
        </div>
      </div>
      {items.length === 0 ? (
        <EmptyState text={selectedLetter ? `ไม่มีรายการขึ้นต้นด้วย ${selectedLetter}` : "ไม่มีรายการรอซื้อแล้ว"} />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3 2xl:grid-cols-4">
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
      {isSearchOpen && (
        <ThaiLetterSearchModal
          selectedLetter={selectedLetter}
          onSelect={(letter) => {
            onLetterChange(letter);
            setIsSearchOpen(false);
          }}
          onCancel={() => setIsSearchOpen(false)}
        />
      )}
    </section>
  );
}

function ThaiLetterSearchModal({
  selectedLetter,
  onSelect,
  onCancel,
}: {
  selectedLetter: string | null;
  onSelect: (letter: string) => void;
  onCancel: () => void;
}) {
  return (
    <div className="no-print fixed inset-0 z-50 grid place-items-center bg-black/72 px-4 backdrop-blur-sm">
      <section className="w-full max-w-lg rounded-lg border border-market-mint/30 bg-market-panel p-4 shadow-touch">
        <h2 className="text-center text-2xl font-black text-white">เลือกตัวอักษรค้นหา</h2>
        <div className="mt-4 grid grid-cols-6 gap-2 sm:grid-cols-7">
          {THAI_LETTERS.map((letter) => (
            <button
              key={letter}
              type="button"
              onClick={() => onSelect(letter)}
              className={`grid h-[52px] min-w-[52px] place-items-center rounded-md border px-2 text-[21px] font-bold leading-none transition ${
                selectedLetter === letter
                  ? "border-market-mint bg-market-mint text-market-ink"
                  : "border-white/70 bg-white text-market-ink hover:border-market-mint/80"
              }`}
            >
              {letter}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="mt-4 min-h-12 w-full rounded-lg border border-white/14 bg-white/6 px-4 text-base font-black text-emerald-50"
        >
          ยกเลิก
        </button>
      </section>
    </div>
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
    <article className="flex min-h-[138px] flex-col justify-between rounded-lg border border-white/10 bg-market-panel/92 p-3 shadow-touch sm:min-h-[178px] sm:p-4">
      <div>
        <h3 className="line-clamp-2 text-xl font-black leading-tight text-white sm:text-2xl">{item.name}</h3>
        <p className="mt-1 text-lg font-black text-market-mint sm:mt-2 sm:text-xl">
          {item.quantity} {item.unit}
        </p>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:mt-4">
        <button
          type="button"
          onClick={onBought}
          className="min-h-11 rounded-lg bg-market-green px-3 text-sm font-black text-market-ink transition hover:bg-market-mint sm:min-h-14 sm:text-base"
        >
          ซื้อแล้ว
        </button>
        <button
          type="button"
          onClick={onUnavailable}
          className="min-h-11 rounded-lg border border-market-red/70 bg-market-red/12 px-3 text-sm font-black text-red-100 transition hover:bg-market-red hover:text-white sm:min-h-14 sm:text-base"
        >
          ไม่มีของ
        </button>
      </div>
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
  const boughtTimeText = formatDisplayTime(item.boughtAt);

  return (
    <>
      <article className="grid w-full max-w-full gap-1.5 rounded-lg border border-market-green/30 bg-market-green/10 p-2.5 shadow-touch sm:hidden">
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

      <article className="hidden gap-3 rounded-lg border border-market-green/30 bg-market-green/10 p-3 shadow-touch sm:grid md:grid-cols-[minmax(180px,1.45fr)_100px_100px_105px_minmax(130px,1fr)_150px_104px_142px] md:items-center">
        <div>
          <p className="text-[11px] font-bold leading-tight text-emerald-100/50 md:hidden">สินค้า</p>
          <h3 className="line-clamp-2 text-xl font-black leading-tight text-white">{item.name}</h3>
        </div>
        <div>
          <p className="text-[11px] font-bold leading-tight text-emerald-100/50 md:hidden">จำนวน</p>
          <p className="text-lg font-black text-market-mint">
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
          className="flex min-h-12 items-center justify-center rounded-lg border border-market-mint/50 bg-market-mint/12 px-3 font-black text-market-mint transition hover:bg-market-mint hover:text-market-ink"
        >
          แก้ราคา
        </button>
        <button
          type="button"
          onClick={onBack}
          className="flex min-h-12 items-center justify-center gap-2 rounded-lg border border-market-blue/60 bg-market-blue/12 px-3 font-black text-sky-100"
        >
          <RotateCcw className="h-5 w-5" />
          กลับไปรอซื้อ
        </button>
      </article>
    </>
  );
}

function RowValue({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <p className="text-[11px] font-bold leading-tight text-emerald-100/50 md:hidden">{label}</p>
      <p className={`${strong ? "text-sm font-black text-white sm:text-lg" : "text-sm font-bold text-emerald-50"}`}>
        {value}
      </p>
    </div>
  );
}

function VehicleStatusBadge({ status }: { status: VehicleStatus }) {
  const className = getVehicleStatusClassName(status);

  return (
    <div>
      <p className="text-[11px] font-bold leading-tight text-emerald-100/50 md:hidden">สถานะขึ้นรถ</p>
      <span className={`inline-flex min-h-7 items-center rounded-lg border px-2 text-xs font-black sm:min-h-9 sm:px-3 sm:text-sm ${className}`}>
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
  const timeText = formatDisplayTime(item.boughtAt || item.checkedAt);

  return (
    <>
      <article className="grid w-full max-w-full gap-1.5 rounded-lg border border-market-red/35 bg-market-red/10 p-2.5 shadow-touch sm:hidden">
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

      <article className="hidden gap-3 rounded-lg border border-market-red/35 bg-market-red/10 p-3 shadow-touch sm:grid md:grid-cols-[minmax(220px,1.6fr)_120px_140px_minmax(150px,1fr)_150px] md:items-center">
        <div>
          <p className="text-[11px] font-bold leading-tight text-red-100/60 md:hidden">สินค้า</p>
          <h3 className="line-clamp-2 text-xl font-black leading-tight text-white">{item.name}</h3>
        </div>
        <div>
          <p className="text-[11px] font-bold leading-tight text-red-100/60 md:hidden">จำนวน</p>
          <p className="text-lg font-black text-market-mint">
            {item.quantity} {item.unit}
          </p>
        </div>
        <RowValue label="ผู้บันทึก" value={item.buyerName || "-"} />
        <RowValue label="เวลา" value={timeText} />
        <button
          type="button"
          onClick={onBack}
          className="flex min-h-12 items-center justify-center gap-2 rounded-lg border border-market-blue/60 bg-market-blue/12 px-3 font-black text-sky-100"
        >
          <RotateCcw className="h-5 w-5" />
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
  const boughtTimeText = formatDisplayTime(item.boughtAt);

  return (
    <>
      <article className="grid w-full max-w-full gap-1.5 rounded-lg border border-white/10 bg-market-panel/92 p-2.5 shadow-touch sm:hidden">
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

      <article className="hidden gap-3 rounded-lg border border-white/10 bg-market-panel/92 p-3 shadow-touch sm:grid md:grid-cols-[minmax(190px,1.5fr)_110px_110px_120px_minmax(140px,1fr)_88px_112px] md:items-center">
        <div>
          <p className="text-[11px] font-bold leading-tight text-emerald-100/50 md:hidden">สินค้า</p>
          <h3 className="line-clamp-2 text-xl font-black leading-tight text-white">{item.name}</h3>
        </div>
        <div>
          <p className="text-[11px] font-bold leading-tight text-emerald-100/50 md:hidden">จำนวน</p>
          <p className="text-lg font-black text-market-mint">
            {item.quantity} {item.unit}
          </p>
        </div>
        <RowValue label="ราคาซื้อ" value={actualPriceText} strong />
        <RowValue label="ผู้ซื้อ" value={item.buyerName || "-"} />
        <RowValue label="เวลาซื้อ" value={boughtTimeText} />
        <button
          type="button"
          onClick={onComplete}
          className="min-h-12 rounded-lg bg-market-green px-3 text-base font-black text-market-ink transition hover:bg-market-mint"
        >
          ครบ
        </button>
        <button
          type="button"
          onClick={onMissing}
          className="min-h-12 rounded-lg border border-market-amber/70 bg-market-amber/12 px-3 text-base font-black text-amber-100 transition hover:bg-market-amber hover:text-market-ink"
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
