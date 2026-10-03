import {
  type RealtimeChannel,
  type RealtimePostgresChangesPayload,
} from "@supabase/supabase-js";
import { supabase, type ItemRealtimeStatus } from "./supabaseFreshBuy";
import type { PhoneOrderItem } from "./types";

type PhoneOrderRow = {
  id: string;
  product_master_id: string | null;
  product_name: string;
  quantity: string;
  unit: string;
  supplier_name: string;
  note: string | null;
  created_at: string;
  updated_at: string;
};

export type PhoneOrderRealtimePayload = RealtimePostgresChangesPayload<PhoneOrderRow>;

let phoneOrderChannelSequence = 0;

function createPhoneOrderChannelTopic() {
  phoneOrderChannelSequence += 1;
  return `phone_order_items:${Date.now()}:${phoneOrderChannelSequence}:${Math.random().toString(36).slice(2)}`;
}

function requireClient() {
  if (!supabase) throw new Error("Supabase env is missing");
  return supabase;
}

function toItem(row: PhoneOrderRow): PhoneOrderItem {
  return {
    id: row.id,
    productMasterId: row.product_master_id,
    productName: row.product_name,
    quantity: row.quantity,
    unit: row.unit,
    supplierName: row.supplier_name,
    note: row.note ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRow(item: PhoneOrderItem) {
  return {
    id: item.id,
    product_master_id: item.productMasterId,
    product_name: item.productName,
    quantity: item.quantity,
    unit: item.unit,
    supplier_name: item.supplierName,
    note: item.note || null,
  };
}

export async function fetchPhoneOrderItems(): Promise<PhoneOrderItem[]> {
  const client = requireClient();
  const { data, error } = await client
    .from("phone_order_items")
    .select("*")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as PhoneOrderRow[]).map(toItem);
}

export async function appendPhoneOrderItem(item: PhoneOrderItem) {
  const client = requireClient();
  const { error } = await client.from("phone_order_items").insert(toRow(item));
  if (error) throw error;
}

export async function updatePhoneOrderItem(
  id: string,
  updates: Pick<PhoneOrderItem, "quantity" | "unit" | "supplierName">,
): Promise<PhoneOrderItem> {
  const client = requireClient();
  const { data, error } = await client
    .from("phone_order_items")
    .update({
      quantity: updates.quantity.trim(),
      unit: updates.unit.trim(),
      supplier_name: updates.supplierName.trim(),
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return toItem(data as PhoneOrderRow);
}

export async function deletePhoneOrderItem(id: string) {
  const client = requireClient();
  const { error } = await client.from("phone_order_items").delete().eq("id", id);
  if (error) throw error;
}

export function phoneOrderFromRealtimeRow(row: PhoneOrderRow | Record<string, unknown>) {
  return toItem(row as PhoneOrderRow);
}

export function subscribeToPhoneOrderItems(
  onChange: (payload: PhoneOrderRealtimePayload) => void,
  onStatus?: (status: ItemRealtimeStatus, error?: Error) => void,
): RealtimeChannel | null {
  if (!supabase) return null;
  return supabase
    .channel(createPhoneOrderChannelTopic())
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "phone_order_items" },
      onChange,
    )
    .subscribe((status, error) => onStatus?.(status as ItemRealtimeStatus, error));
}

export async function removePhoneOrderSubscription(channel: RealtimeChannel | null) {
  if (!supabase || !channel) return;
  await supabase.removeChannel(channel);
}
