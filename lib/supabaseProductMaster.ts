import {
  type RealtimeChannel,
  type RealtimePostgresChangesPayload,
} from "@supabase/supabase-js";
import { supabase, type ItemRealtimeStatus } from "./supabaseFreshBuy";
import type { ProductCategory, ProductMasterInput, ProductMasterItem, ProductUnit } from "./types";

type ProductMasterRow = {
  id: string;
  name: string;
  category: string;
  default_unit: string;
  default_max_price: string | null;
  note: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type ProductMasterRealtimePayload = RealtimePostgresChangesPayload<ProductMasterRow>;

let productMasterChannelSequence = 0;

function createProductMasterChannelTopic() {
  productMasterChannelSequence += 1;
  return `product_master:${Date.now()}:${productMasterChannelSequence}:${Math.random().toString(36).slice(2)}`;
}

function requireClient() {
  if (!supabase) throw new Error("Supabase env is missing");
  return supabase;
}

function parsePrice(value: string | null): number | "" {
  if (!value || value === "-") return "";
  const price = Number(value);
  return Number.isFinite(price) ? price : "";
}

function toProduct(row: ProductMasterRow): ProductMasterItem {
  return {
    id: row.id,
    name: row.name,
    category: row.category as ProductCategory,
    defaultUnit: row.default_unit as ProductUnit,
    defaultMaxPrice: parsePrice(row.default_max_price),
    note: row.note ?? "",
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toInsertRow(product: ProductMasterInput) {
  return {
    name: product.name.trim(),
    category: product.category,
    default_unit: product.defaultUnit.trim(),
    default_max_price: product.defaultMaxPrice === "" ? null : String(product.defaultMaxPrice),
    note: product.note.trim() || null,
    active: true,
  };
}

export async function fetchActiveProducts(): Promise<ProductMasterItem[]> {
  const client = requireClient();
  const { data, error } = await client
    .from("product_master")
    .select("*")
    .eq("active", true)
    .order("category", { ascending: true })
    .order("name", { ascending: true });

  if (error) throw error;
  return ((data ?? []) as ProductMasterRow[]).map(toProduct);
}

export async function fetchAllProducts(): Promise<ProductMasterItem[]> {
  const client = requireClient();
  const { data, error } = await client
    .from("product_master")
    .select("*")
    .order("category", { ascending: true })
    .order("name", { ascending: true });

  if (error) throw error;
  return ((data ?? []) as ProductMasterRow[]).map(toProduct);
}

export async function createProduct(product: ProductMasterInput): Promise<ProductMasterItem> {
  const client = requireClient();
  const { data, error } = await client
    .from("product_master")
    .insert(toInsertRow(product))
    .select("*")
    .single();

  if (error) throw error;
  return toProduct(data as ProductMasterRow);
}

export async function updateProduct(
  id: string,
  product: ProductMasterInput,
): Promise<ProductMasterItem> {
  const client = requireClient();
  const { data, error } = await client
    .from("product_master")
    .update(toInsertRow(product))
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return toProduct(data as ProductMasterRow);
}

export async function archiveProduct(id: string): Promise<void> {
  const client = requireClient();
  const { error } = await client.from("product_master").update({ active: false }).eq("id", id);
  if (error) throw error;
}

export function subscribeToProductMaster(
  onChange: (payload: ProductMasterRealtimePayload) => void,
  onStatus?: (status: ItemRealtimeStatus, error?: Error) => void,
): RealtimeChannel | null {
  if (!supabase) return null;

  return supabase
    .channel(createProductMasterChannelTopic())
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "product_master",
      },
      onChange,
    )
    .subscribe((status, error) => {
      onStatus?.(status as ItemRealtimeStatus, error);
    });
}

export async function removeProductMasterSubscription(channel: RealtimeChannel | null) {
  if (!supabase || !channel) return;
  await supabase.removeChannel(channel);
}
