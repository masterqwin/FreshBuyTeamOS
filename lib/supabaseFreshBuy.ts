import {
  createClient,
  type RealtimeChannel,
  type RealtimePostgresChangesPayload,
  type SupabaseClient,
} from "@supabase/supabase-js";
import type { BuyerName, FreshBuyItem, ItemStatus, VehicleStatus } from "./types";

type BuyItemRow = {
  id: string;
  name: string;
  quantity: string;
  unit: string;
  max_price: string | null;
  note: string | null;
  status: string;
  buyer_name: string | null;
  bought_at: string | null;
  actual_price: string | null;
  checked_at?: string | null;
  issue_note?: string | null;
  vehicle_status: string | null;
  created_at: string;
  updated_at: string;
  day_key: string;
};

type ReplaceAllItemsRpcRow = {
  success: boolean;
  inserted_count: number;
};

type ClearAllItemsRpcRow = {
  success: boolean;
  deleted_count: number;
};

const GLOBAL_LIST_DAY_KEY = "global";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl as string, supabaseAnonKey as string)
  : null;

export function getTodayDayKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value ?? String(date.getFullYear());
  const month = parts.find((part) => part.type === "month")?.value ?? String(date.getMonth() + 1).padStart(2, "0");
  const day = parts.find((part) => part.type === "day")?.value ?? String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parsePrice(value: string | null): number | "" {
  if (!value || value === "-") return "";
  const price = Number(value);
  return Number.isFinite(price) ? price : "";
}

function toItem(row: BuyItemRow): FreshBuyItem {
  return {
    id: row.id,
    name: row.name,
    quantity: row.quantity,
    unit: row.unit,
    maxPrice: Number(row.max_price) || 0,
    note: row.note ?? "",
    status: row.status as ItemStatus,
    buyerName: (row.buyer_name ?? "") as BuyerName | "",
    boughtAt: row.bought_at ?? "",
    actualPrice: parsePrice(row.actual_price),
    checkedAt: row.checked_at ?? "",
    issueNote: row.issue_note ?? "",
    vehicleStatus: (row.vehicle_status ?? "unchecked") as VehicleStatus,
  };
}

function toRow(item: FreshBuyItem) {
  return {
    id: item.id,
    name: item.name,
    quantity: item.quantity,
    unit: item.unit,
    max_price: item.maxPrice === 0 ? null : String(item.maxPrice),
    note: item.note || null,
    status: item.status,
    buyer_name: item.buyerName || null,
    bought_at: item.boughtAt || null,
    actual_price: item.actualPrice === "" ? null : String(item.actualPrice),
    checked_at: item.checkedAt || null,
    issue_note: item.issueNote || null,
    vehicle_status: item.vehicleStatus ?? "unchecked",
    day_key: GLOBAL_LIST_DAY_KEY,
  };
}

function toPatchRow(patch: Partial<FreshBuyItem>) {
  const row: Record<string, string | null> = {};

  if (patch.name !== undefined) row.name = patch.name;
  if (patch.quantity !== undefined) row.quantity = patch.quantity;
  if (patch.unit !== undefined) row.unit = patch.unit;
  if (patch.maxPrice !== undefined) row.max_price = patch.maxPrice === 0 ? null : String(patch.maxPrice);
  if (patch.note !== undefined) row.note = patch.note || null;
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.buyerName !== undefined) row.buyer_name = patch.buyerName || null;
  if (patch.boughtAt !== undefined) row.bought_at = patch.boughtAt || null;
  if (patch.actualPrice !== undefined) row.actual_price = patch.actualPrice === "" ? null : String(patch.actualPrice);
  if (patch.checkedAt !== undefined) row.checked_at = patch.checkedAt || null;
  if (patch.issueNote !== undefined) row.issue_note = patch.issueNote || null;
  if (patch.vehicleStatus !== undefined) row.vehicle_status = patch.vehicleStatus ?? "unchecked";

  return row;
}

function requireClient() {
  if (!supabase) throw new Error("Supabase env is missing");
  return supabase;
}

export async function fetchAllItems(): Promise<FreshBuyItem[]> {
  const client = requireClient();
  const { data, error } = await client
    .from("buy_items")
    .select("*")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) throw error;
  return ((data ?? []) as BuyItemRow[]).map(toItem);
}

export async function replaceAllItems(items: FreshBuyItem[]) {
  return replaceAllItemsAtomic(items);
}

export async function replaceAllItemsAtomic(items: FreshBuyItem[]) {
  const client = requireClient();
  const { data, error } = await client.rpc("freshbuy_replace_all_items", { items: items.map(toRow) });
  if (error) throw error;

  const result = (data?.[0] ?? null) as ReplaceAllItemsRpcRow | null;
  if (!result?.success || result.inserted_count !== items.length) {
    throw new Error(`Atomic replace inserted ${result?.inserted_count ?? "unknown"} of ${items.length} items`);
  }
}

export async function clearAllItems() {
  return clearAllItemsAtomic();
}

export async function appendItems(items: FreshBuyItem[]) {
  if (items.length === 0) return;
  const client = requireClient();
  const { error } = await client.from("buy_items").insert(items.map(toRow));
  if (error) throw error;
}

export async function clearAllItemsAtomic() {
  const client = requireClient();
  const { data, error } = await client.rpc("freshbuy_clear_all_items");
  if (error) throw error;

  const result = (data?.[0] ?? null) as ClearAllItemsRpcRow | null;
  if (!result?.success) {
    throw new Error("Atomic clear failed");
  }
}

export async function updateDayItem(id: string, patch: Partial<FreshBuyItem>) {
  const client = requireClient();
  const { error } = await client.from("buy_items").update(toPatchRow(patch)).eq("id", id);
  if (error) throw error;
}

export type ItemRealtimePayload = RealtimePostgresChangesPayload<BuyItemRow>;
export type ItemRealtimeStatus = "SUBSCRIBED" | "TIMED_OUT" | "CLOSED" | "CHANNEL_ERROR";

export function itemFromRealtimeRow(row: BuyItemRow | Record<string, unknown>): FreshBuyItem {
  return toItem(row as BuyItemRow);
}

export function subscribeToItems(
  onChange: (payload: ItemRealtimePayload) => void,
  onStatus?: (status: ItemRealtimeStatus, error?: Error) => void,
): RealtimeChannel | null {
  if (!supabase) return null;

  return supabase
    .channel("buy_items:global")
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "buy_items",
      },
      onChange,
    )
    .subscribe((status, error) => {
      onStatus?.(status as ItemRealtimeStatus, error);
    });
}
