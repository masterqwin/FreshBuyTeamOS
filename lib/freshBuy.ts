import type { BuyerName, FreshBuyItem, ItemStatus, ParsedImportRow } from "./types";

export const STORAGE_KEY = "fresh-buy-team-os-v1";
export const PRODUCT_MASTER_STORAGE_KEY = "fresh-buy-product-master-v1";
export const BUYERS: BuyerName[] = ["ผู้ซื้อ 1", "ผู้ซื้อ 2", "ผู้ซื้อ 3", "คนเช็คของ"];

export function normalizeProductName(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("th-TH");
}

export const STATUS_LABELS: Record<ItemStatus, string> = {
  pending: "รอซื้อ",
  bought: "ซื้อแล้ว",
  checked: "เช็คครบ",
  missing: "ของไม่ครบ",
  unavailable: "ไม่มีของ",
  expensive: "แพงเกินไป",
  cancelled: "ยกเลิก",
};

export const STATUS_STYLES: Record<ItemStatus, string> = {
  pending: "border-market-blue/60 bg-market-blue/10 text-sky-100",
  bought: "border-market-green/60 bg-market-green/12 text-emerald-100",
  checked: "border-market-mint/70 bg-market-mint/15 text-green-50",
  missing: "border-market-amber/70 bg-market-amber/15 text-amber-50",
  unavailable: "border-market-red/70 bg-market-red/15 text-red-50",
  expensive: "border-orange-400/70 bg-orange-500/15 text-orange-50",
  cancelled: "border-slate-500/70 bg-slate-500/15 text-slate-100",
};

export function nowStamp() {
  return new Date().toLocaleString("th-TH", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export function nowIsoStamp() {
  return new Date().toISOString();
}

export function formatDisplayTime(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString("th-TH", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export function playBeep(tone: "ok" | "warn" | "soft" = "ok") {
  if (typeof window === "undefined") return;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;

  const ctx = new AudioContextClass();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const frequency = tone === "ok" ? 740 : tone === "warn" ? 260 : 520;

  osc.type = tone === "warn" ? "square" : "sine";
  osc.frequency.setValueAtTime(frequency, ctx.currentTime);
  gain.gain.setValueAtTime(0.001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.13);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.15);
  window.setTimeout(() => void ctx.close(), 220);
}

export function parseImportText(text: string): ParsedImportRow[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.includes("\t") ? "\t" : ",";
      const [name = "", quantity = "0", unit = "", maxPrice = "0", ...noteParts] = line
        .split(separator)
        .map((part) => part.trim());

      return {
        name,
        quantity: quantity || "0",
        unit,
        maxPrice: Number(maxPrice) || 0,
        note: noteParts.join(separator).trim(),
      };
    })
    .filter((row) => row.name.length > 0);
}

export function createUuid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

export function rowsToItems(rows: ParsedImportRow[]): FreshBuyItem[] {
  return rows.map((row) => ({
    id: createUuid(),
    name: row.name,
    quantity: row.quantity,
    unit: row.unit,
    maxPrice: row.maxPrice,
    note: row.note,
    status: "pending",
    buyerName: "",
    boughtAt: "",
    actualPrice: "",
    checkedAt: "",
    issueNote: "",
    vehicleStatus: "unchecked",
  }));
}

export function getSummary(items: FreshBuyItem[]) {
  return {
    total: items.length,
    pending: items.filter((item) => item.status === "pending").length,
    bought: items.filter((item) => item.status === "bought").length,
    checked: items.filter((item) => item.status === "checked").length,
    unavailable: items.filter((item) => item.status === "unavailable").length,
  };
}
