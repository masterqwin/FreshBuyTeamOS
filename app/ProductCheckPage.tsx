"use client";

import { Archive, Pencil, Plus, RefreshCcw, Search, Send, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  PRODUCT_MASTER_STORAGE_KEY,
  createUuid,
  normalizeProductName,
  playBeep,
  rowsToItems,
} from "@/lib/freshBuy";
import { isSupabaseConfigured, type ItemRealtimeStatus } from "@/lib/supabaseFreshBuy";
import {
  archiveProduct,
  createProduct,
  fetchActiveProducts,
  removeProductMasterSubscription,
  subscribeToProductMaster,
  updateProduct,
} from "@/lib/supabaseProductMaster";
import {
  PRODUCT_CATEGORIES,
  PRODUCT_UNITS,
  type FreshBuyItem,
  type ProductCategory,
  type ProductMasterInput,
  type ProductMasterItem,
  type ProductUnit,
  type PurchaseMethod,
  type PhoneOrderItem,
} from "@/lib/types";

type CategoryFilter = "ทั้งหมด" | ProductCategory;
type CheckValue = { quantity: string; unit: ProductUnit };
type ProductEditorState = {
  mode: "create" | "edit";
  id?: string;
  name: string;
  category: ProductCategory;
  defaultUnit: string;
  defaultMaxPrice: string;
  note: string;
  purchaseMethod: PurchaseMethod;
  supplierName: string;
};

const ALL_CATEGORY_FILTERS: CategoryFilter[] = ["ทั้งหมด", ...PRODUCT_CATEGORIES];

const CATEGORY_ROW_STYLES: Record<ProductCategory, { row: string; badge: string }> = {
  ผักใบ: {
    row: "border-emerald-400/25 bg-emerald-400/[0.06] hover:border-emerald-300/40 hover:bg-emerald-400/[0.09]",
    badge: "border-emerald-300/30 bg-emerald-300/10 text-emerald-100",
  },
  ผักผล: {
    row: "border-orange-300/25 bg-orange-300/[0.06] hover:border-orange-300/40 hover:bg-orange-300/[0.09]",
    badge: "border-orange-300/30 bg-orange-300/10 text-orange-100",
  },
  ผักเมืองหนาว: {
    row: "border-sky-300/25 bg-sky-300/[0.06] hover:border-sky-300/40 hover:bg-sky-300/[0.09]",
    badge: "border-sky-300/30 bg-sky-300/10 text-sky-100",
  },
  ผักแพ๊คและเห็ด: {
    row: "border-cyan-300/25 bg-cyan-300/[0.06] hover:border-cyan-300/40 hover:bg-cyan-300/[0.09]",
    badge: "border-cyan-300/30 bg-cyan-300/10 text-cyan-100",
  },
  เครื่องเทศ: {
    row: "border-amber-300/25 bg-amber-300/[0.06] hover:border-amber-300/40 hover:bg-amber-300/[0.09]",
    badge: "border-amber-300/30 bg-amber-300/10 text-amber-100",
  },
  อื่นๆ: {
    row: "border-slate-300/20 bg-slate-300/[0.05] hover:border-slate-300/35 hover:bg-slate-300/[0.08]",
    badge: "border-slate-300/25 bg-slate-300/10 text-slate-100",
  },
};

const EMPTY_EDITOR: ProductEditorState = {
  mode: "create",
  name: "",
  category: PRODUCT_CATEGORIES[0],
  defaultUnit: "กก.",
  defaultMaxPrice: "",
  note: "",
  purchaseMethod: "walk",
  supplierName: "",
};

function hasPurchaseQuantity(value: string) {
  const quantity = Number(value.trim());
  return Number.isFinite(quantity) && quantity > 0;
}

function normalizeProductUnit(value: string): ProductUnit {
  return PRODUCT_UNITS.includes(value as ProductUnit) ? (value as ProductUnit) : PRODUCT_UNITS[0];
}

function comparableProductName(value: string) {
  return value.trim().toLocaleLowerCase("th-TH");
}

function mergeProduct(products: ProductMasterItem[], nextProduct: ProductMasterItem) {
  const withoutCurrent = products.filter((product) => product.id !== nextProduct.id);
  if (!nextProduct.active) return withoutCurrent;
  return [...withoutCurrent, nextProduct].sort((left, right) =>
    `${left.category}:${left.name}`.localeCompare(`${right.category}:${right.name}`, "th"),
  );
}

function initializeCheckValues(
  products: ProductMasterItem[],
  current: Record<string, CheckValue>,
  clearQuantities: boolean,
) {
  return Object.fromEntries(
    products.map((product) => [
      product.id,
      {
        quantity: clearQuantities ? "" : current[product.id]?.quantity ?? "",
        unit: clearQuantities
          ? normalizeProductUnit(product.defaultUnit)
          : current[product.id]?.unit ?? normalizeProductUnit(product.defaultUnit),
      },
    ]),
  );
}

export default function ProductCheckPage({
  currentBuyItems,
  currentPhoneOrderItems,
  onSendWalk,
  onSendPhone,
  onStartNewCycle,
  isAdminUnlocked,
  isAdminPinConfigured,
  onRequestAdmin,
  onLogout,
  onBackup,
  onClearToday,
  isClearingToday,
}: {
  currentBuyItems: FreshBuyItem[];
  currentPhoneOrderItems: PhoneOrderItem[];
  onSendWalk: (items: FreshBuyItem[]) => Promise<boolean>;
  onSendPhone: (item: PhoneOrderItem) => Promise<boolean>;
  onStartNewCycle: () => Promise<boolean>;
  isAdminUnlocked: boolean;
  isAdminPinConfigured: boolean | null;
  onRequestAdmin: () => void;
  onLogout: () => void;
  onBackup: () => void;
  onClearToday: () => void;
  isClearingToday: boolean;
}) {
  const [products, setProducts] = useState<ProductMasterItem[]>([]);
  const [checkValues, setCheckValues] = useState<Record<string, CheckValue>>({});
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("ทั้งหมด");
  const [searchText, setSearchText] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isBulkSubmitting, setIsBulkSubmitting] = useState(false);
  const [isStartingNewCycle, setIsStartingNewCycle] = useState(false);
  const [isSavingProduct, setIsSavingProduct] = useState(false);
  const [productError, setProductError] = useState("");
  const [productRealtimeStatus, setProductRealtimeStatus] = useState(
    isSupabaseConfigured ? "กำลังเชื่อมต่อ" : "ออฟไลน์",
  );
  const [editor, setEditor] = useState<ProductEditorState | null>(null);
  const hydratedRef = useRef(false);
  const bulkSubmittingRef = useRef(false);

  function applyProducts(nextProducts: ProductMasterItem[], clearQuantities = false) {
    setProducts(nextProducts);
    setCheckValues((current) => initializeCheckValues(nextProducts, current, clearQuantities));
  }

  async function loadProducts(clearQuantities = false) {
    setIsLoading(true);
    setProductError("");
    try {
      if (!isSupabaseConfigured) {
        const saved = window.localStorage.getItem(PRODUCT_MASTER_STORAGE_KEY);
        const localProducts = saved
          ? (JSON.parse(saved) as ProductMasterItem[]).map((product) => ({
              ...product,
              purchaseMethod: product.purchaseMethod ?? "walk",
              supplierName: product.supplierName ?? "",
            }))
          : [];
        applyProducts(localProducts.filter((product) => product.active), clearQuantities);
        setProductRealtimeStatus("ออฟไลน์");
      } else {
        const remoteProducts = await fetchActiveProducts();
        applyProducts(remoteProducts, clearQuantities);
      }
    } catch (error) {
      console.error("Product Master load failed", error);
      setProductError("โหลด Product Master ไม่สำเร็จ กรุณาตรวจว่าได้รัน SQL product_master แล้ว");
    } finally {
      hydratedRef.current = true;
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadProducts();
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    let cancelled = false;
    const channel = subscribeToProductMaster(
      () => {
        if (cancelled) return;
        void fetchActiveProducts()
          .then((remoteProducts) => {
            if (cancelled) return;
            applyProducts(remoteProducts);
            setProductError("");
          })
          .catch((error) => {
            console.error("Product Master realtime refresh failed", error);
          });
      },
      (status: ItemRealtimeStatus, error) => {
        if (cancelled) return;
        if (status === "SUBSCRIBED") {
          setProductRealtimeStatus("เชื่อมต่อแล้ว");
        } else if (status === "CLOSED") {
          setProductRealtimeStatus("ออฟไลน์");
        } else {
          setProductRealtimeStatus("ผิดพลาด");
          if (error) console.error(`Product Master realtime ${status.toLowerCase()}`, error);
        }
      },
    );

    return () => {
      cancelled = true;
      void removeProductMasterSubscription(channel);
    };
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured && hydratedRef.current) {
      window.localStorage.setItem(PRODUCT_MASTER_STORAGE_KEY, JSON.stringify(products));
    }
  }, [products]);

  const availableProducts = useMemo(() => {
    const currentProductNames = new Set(
      currentBuyItems.map((item) => normalizeProductName(item.name)),
    );
    const currentPhoneProductIds = new Set(
      currentPhoneOrderItems.map((item) => item.productMasterId).filter(Boolean),
    );
    const currentPhoneProductNames = new Set(
      currentPhoneOrderItems.map((item) => normalizeProductName(item.productName)),
    );
    return products.filter((product) => {
      if (currentProductNames.has(normalizeProductName(product.name))) return false;
      if (currentPhoneProductIds.has(product.id)) return false;
      if (currentPhoneProductNames.has(normalizeProductName(product.name))) return false;
      return true;
    });
  }, [currentBuyItems, currentPhoneOrderItems, products]);

  const filteredProducts = useMemo(() => {
    const query = searchText.trim().toLocaleLowerCase("th-TH");
    return availableProducts.filter((product) => {
      const matchesCategory = categoryFilter === "ทั้งหมด" || product.category === categoryFilter;
      const matchesSearch = !query || product.name.toLocaleLowerCase("th-TH").includes(query);
      return matchesCategory && matchesSearch;
    });
  }, [availableProducts, categoryFilter, searchText]);

  const selectedProducts = useMemo(
    () => availableProducts.filter((product) => hasPurchaseQuantity(checkValues[product.id]?.quantity ?? "")),
    [availableProducts, checkValues],
  );

  async function startNewCheck() {
    if (isStartingNewCycle) return;
    if (!window.confirm("เริ่มรอบใหม่จะล้างทั้งรายการซื้อวันนี้และรายการโทรสั่ง\nแต่จะไม่ลบข้อมูลสินค้า Product Master\nต้องการดำเนินการต่อหรือไม่?")) return;

    setIsStartingNewCycle(true);
    setProductError("");
    try {
      const succeeded = await onStartNewCycle();
      if (succeeded) {
        await loadProducts(true);
        playBeep("ok");
      } else {
        setProductError("เริ่มรอบใหม่ไม่สำเร็จ รายการเดิมยังไม่ถูกซ่อน กรุณาลองอีกครั้ง");
      }
    } finally {
      setIsStartingNewCycle(false);
    }
  }

  async function sendSelectedProducts() {
    if (bulkSubmittingRef.current || selectedProducts.length === 0) return;
    bulkSubmittingRef.current = true;
    setIsBulkSubmitting(true);
    setProductError("");
    const successfulIds = new Set<string>();
    const failedNames: string[] = [];
    try {
      const walkProducts = selectedProducts.filter((product) => product.purchaseMethod === "walk");
      if (walkProducts.length > 0) {
        const walkItems = rowsToItems(walkProducts.map((product) => {
          const value = checkValues[product.id];
          return {
            name: product.name,
            quantity: value.quantity.trim(),
            unit: value.unit,
            maxPrice: product.defaultMaxPrice === "" ? 0 : product.defaultMaxPrice,
            note: product.note,
          };
        }));
        if (await onSendWalk(walkItems)) {
          walkProducts.forEach((product) => successfulIds.add(product.id));
        } else {
          failedNames.push(...walkProducts.map((product) => product.name));
        }
      }

      const phoneProducts = selectedProducts.filter((product) => product.purchaseMethod === "phone");
      const phoneResults = await Promise.all(phoneProducts.map(async (product) => {
        const value = checkValues[product.id];
        const timestamp = new Date().toISOString();
        const succeeded = await onSendPhone({
          id: createUuid(),
          productMasterId: product.id,
          productName: product.name,
          quantity: value.quantity.trim(),
          unit: value.unit,
          supplierName: product.supplierName,
          note: product.note,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        return { product, succeeded };
      }));
      for (const { product, succeeded } of phoneResults) {
        if (succeeded) successfulIds.add(product.id);
        else failedNames.push(product.name);
      }

      if (successfulIds.size > 0) {
        setCheckValues((current) => Object.fromEntries(Object.entries(current).map(([id, value]) => [
          id,
          successfulIds.has(id) ? { ...value, quantity: "" } : value,
        ])));
      }
      if (failedNames.length > 0) {
        setProductError(`ส่งไม่สำเร็จ: ${failedNames.join(", ")} กรุณาลองอีกครั้ง`);
        playBeep("warn");
      }
    } finally {
      bulkSubmittingRef.current = false;
      setIsBulkSubmitting(false);
    }
  }

  function openEditProduct(product: ProductMasterItem) {
    setEditor({
      mode: "edit",
      id: product.id,
      name: product.name,
      category: product.category,
      defaultUnit: normalizeProductUnit(product.defaultUnit),
      defaultMaxPrice: product.defaultMaxPrice === "" ? "" : String(product.defaultMaxPrice),
      note: product.note,
      purchaseMethod: product.purchaseMethod,
      supplierName: product.supplierName,
    });
  }

  async function saveProduct() {
    if (!editor || isSavingProduct) return;
    const name = editor.name.trim();
    const defaultUnit = editor.defaultUnit.trim();
    if (!name || !defaultUnit) {
      window.alert("กรุณากรอกชื่อสินค้าและหน่วยปกติ");
      return;
    }
    const supplierName = editor.supplierName.trim();
    if (editor.purchaseMethod === "phone" && !supplierName) {
      window.alert("กรุณากรอกชื่อร้านสำหรับสินค้าโทร/LINE สั่ง");
      return;
    }

    const duplicate = products.some(
      (product) =>
        product.id !== editor.id && comparableProductName(product.name) === comparableProductName(name),
    );
    if (duplicate) {
      window.alert(`มีสินค้า “${name}” อยู่ใน Product Master แล้ว`);
      return;
    }

    const parsedMaxPrice = editor.defaultMaxPrice.trim() === "" ? "" : Number(editor.defaultMaxPrice);
    if (parsedMaxPrice !== "" && (!Number.isFinite(parsedMaxPrice) || parsedMaxPrice < 0)) {
      window.alert("ราคาสูงสุดไม่ถูกต้อง");
      return;
    }

    const input: ProductMasterInput = {
      name,
      category: editor.category,
      defaultUnit: normalizeProductUnit(defaultUnit),
      defaultMaxPrice: parsedMaxPrice,
      note: editor.note.trim(),
      purchaseMethod: editor.purchaseMethod,
      supplierName: editor.purchaseMethod === "phone" ? supplierName : "",
    };

    setIsSavingProduct(true);
    setProductError("");
    try {
      let savedProduct: ProductMasterItem;
      if (!isSupabaseConfigured) {
        const now = new Date().toISOString();
        const existing = editor.id ? products.find((product) => product.id === editor.id) : undefined;
        savedProduct = {
          id: existing?.id ?? createUuid(),
          ...input,
          active: true,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        };
      } else if (editor.mode === "edit" && editor.id) {
        savedProduct = await updateProduct(editor.id, input);
      } else {
        savedProduct = await createProduct(input);
      }

      setProducts((current) => mergeProduct(current, savedProduct));
      setCheckValues((current) => ({
        ...current,
        [savedProduct.id]: current[savedProduct.id] ?? { quantity: "", unit: savedProduct.defaultUnit },
      }));
      setEditor(null);
      playBeep("ok");
    } catch (error) {
      console.error("Product Master save failed", error);
      setProductError("บันทึกสินค้าไม่สำเร็จ อาจมีชื่อสินค้าซ้ำหรือยังไม่ได้รัน SQL");
      playBeep("warn");
    } finally {
      setIsSavingProduct(false);
    }
  }

  async function removeProduct(product: ProductMasterItem) {
    if (!window.confirm(`ยืนยันลบสินค้า “${product.name}” ออกจาก Product Master?\nประวัติการซื้อเดิมจะไม่ถูกลบ`)) {
      return;
    }

    setProductError("");
    try {
      if (isSupabaseConfigured) await archiveProduct(product.id);
      setProducts((current) => current.filter((candidate) => candidate.id !== product.id));
      setCheckValues((current) => {
        const next = { ...current };
        delete next[product.id];
        return next;
      });
      playBeep("warn");
    } catch (error) {
      console.error("Product Master archive failed", error);
      setProductError("ลบสินค้าไม่สำเร็จ");
      playBeep("warn");
    }
  }

  return (
    <section className="pb-28 sm:pb-24">
      <div className="rounded-lg border border-white/10 bg-market-panel/92 p-3 shadow-touch sm:p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-2xl font-black text-white">เช็คสินค้า</h2>
            <p className="mt-1 text-sm font-semibold text-emerald-100/65">
              ใส่จำนวนเฉพาะสินค้าที่ต้องซื้อ · Product Master {products.length} รายการ · Realtime {productRealtimeStatus}
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => void startNewCheck()}
              disabled={isLoading || isStartingNewCycle}
              className="flex min-h-12 items-center justify-center gap-2 rounded-lg border border-market-blue/60 bg-market-blue/12 px-4 text-sm font-black text-sky-100 disabled:opacity-50"
            >
              <RefreshCcw className="h-4 w-4" />
              {isStartingNewCycle ? "กำลังเริ่มรอบใหม่..." : "เริ่มเช็คสินค้าที่ต้องซื้อใหม่"}
            </button>
            {isAdminUnlocked ? (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setEditor({ ...EMPTY_EDITOR })}
                  className="flex min-h-12 items-center justify-center gap-2 rounded-lg bg-market-green px-3 text-sm font-black text-market-ink"
                >
                  <Plus className="h-5 w-5" />
                  เพิ่มสินค้า
                </button>
                <button
                  type="button"
                  onClick={onLogout}
                  className="min-h-12 rounded-lg border border-market-amber/60 bg-market-amber/10 px-3 text-sm font-black text-amber-100"
                >
                  ล็อก Admin
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={onRequestAdmin}
                disabled={isAdminPinConfigured !== true}
                className="min-h-12 rounded-lg border border-market-amber/60 bg-market-amber/10 px-4 text-sm font-black text-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                จัดการ Product Master (Owner PIN)
              </button>
            )}
          </div>
        </div>

        {isAdminPinConfigured === false && (
          <p className="mt-3 rounded-lg border border-market-amber/50 bg-market-amber/10 px-3 py-2 text-sm font-bold text-amber-100">
            ยังไม่ได้ตั้งค่า IMPORT_PAGE_PIN — การเช็คและส่งรายการยังใช้งานได้ตามปกติ แต่ไม่สามารถเพิ่ม แก้ไข หรือลบ Product Master ได้
          </p>
        )}

        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="flex flex-wrap gap-2">
            {ALL_CATEGORY_FILTERS.map((category) => (
              <button
                key={category}
                type="button"
                onClick={() => setCategoryFilter(category)}
                className={`min-h-10 rounded-lg border px-3 text-sm font-black transition ${
                  categoryFilter === category
                    ? "border-market-mint bg-market-mint text-market-ink"
                    : "border-white/12 bg-white/5 text-emerald-50"
                }`}
              >
                {category}
              </button>
            ))}
          </div>
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-emerald-100/45" />
            <input
              type="search"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="ค้นหาชื่อสินค้า"
              className="h-12 w-full rounded-lg border border-market-line bg-market-ink pl-10 pr-3 font-bold text-white outline-none focus:border-market-mint"
            />
          </label>
        </div>
      </div>

      {productError && (
        <div className="mt-3 rounded-lg border border-market-red/55 bg-market-red/12 px-4 py-3 font-bold text-red-100">
          {productError}
        </div>
      )}

      <div className="mt-3 grid gap-2">
        {isLoading ? (
          <div className="rounded-lg border border-white/10 bg-market-panel/80 p-8 text-center font-black text-emerald-100/70">
            กำลังโหลด Product Master...
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="rounded-lg border border-dashed border-white/15 bg-market-panel/70 p-8 text-center font-black text-emerald-100/70">
            ไม่พบสินค้าในหมวดหมู่หรือคำค้นนี้
          </div>
        ) : (
          filteredProducts.map((product) => {
            const value = checkValues[product.id] ?? {
              quantity: "",
              unit: normalizeProductUnit(product.defaultUnit),
            };
            const selected = hasPurchaseQuantity(value.quantity);
            const categoryStyle = CATEGORY_ROW_STYLES[product.category];
            return (
              <article
                key={product.id}
                className={`grid gap-2 rounded-lg border p-2.5 shadow-touch transition-colors sm:grid-cols-[minmax(160px,1fr)_120px_120px_auto] sm:items-center sm:p-3 ${categoryStyle.row} ${
                  selected ? "ring-1 ring-market-green/55" : ""
                }`}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-lg font-black text-white">{product.name}</h3>
                    <span className={`rounded-md border px-2 py-1 text-[11px] font-black ${categoryStyle.badge}`}>
                      {product.category}
                    </span>
                    <span className={`rounded-md border px-2 py-1 text-[11px] font-black ${
                      product.purchaseMethod === "phone"
                        ? "border-sky-300/35 bg-sky-300/10 text-sky-100"
                        : "border-emerald-300/30 bg-emerald-300/8 text-emerald-100"
                    }`}>
                      {product.purchaseMethod === "phone"
                        ? `โทร/LINE สั่ง · ${product.supplierName}`
                        : "เดินซื้อเอง"}
                    </span>
                  </div>
                  {(product.defaultMaxPrice !== "" || product.note) && (
                    <p className="mt-1 truncate text-xs font-semibold text-emerald-100/60">
                      {product.defaultMaxPrice !== "" ? `เพดาน ${product.defaultMaxPrice} บาท` : ""}
                      {product.defaultMaxPrice !== "" && product.note ? " · " : ""}
                      {product.note}
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 sm:contents">
                  <label>
                    <span className="mb-1 block text-[11px] font-bold text-emerald-100/55 sm:hidden">จำนวน</span>
                    <input
                      value={value.quantity}
                      onChange={(event) =>
                        setCheckValues((current) => ({
                          ...current,
                          [product.id]: { ...value, quantity: event.target.value },
                        }))
                      }
                      inputMode="decimal"
                      placeholder="จำนวน"
                      className="h-12 w-full min-w-0 rounded-lg border border-market-line bg-market-ink px-2 text-center text-lg font-black text-white outline-none focus:border-market-mint"
                    />
                  </label>
                  <label>
                    <span className="mb-1 block text-[11px] font-bold text-emerald-100/55 sm:hidden">หน่วย</span>
                    <select
                      value={value.unit}
                      onChange={(event) =>
                        setCheckValues((current) => ({
                          ...current,
                          [product.id]: { ...value, unit: event.target.value as ProductUnit },
                        }))
                      }
                      className="h-12 w-full min-w-0 rounded-lg border border-market-line bg-market-ink px-2 text-center font-black text-white outline-none focus:border-market-mint"
                    >
                      {PRODUCT_UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                    </select>
                  </label>
                </div>
                {isAdminUnlocked ? (
                  <div className="grid grid-cols-2 gap-2 sm:w-[180px]">
                    <button
                      type="button"
                      onClick={() => openEditProduct(product)}
                      className="flex min-h-11 items-center justify-center gap-1 rounded-lg border border-market-blue/55 bg-market-blue/10 px-2 text-xs font-black text-sky-100"
                    >
                      <Pencil className="h-4 w-4" /> แก้ไข
                    </button>
                    <button
                      type="button"
                      onClick={() => void removeProduct(product)}
                      className="flex min-h-11 items-center justify-center gap-1 rounded-lg border border-market-red/55 bg-market-red/10 px-2 text-xs font-black text-red-100"
                    >
                      <Archive className="h-4 w-4" /> ลบสินค้า
                    </button>
                  </div>
                ) : (
                  <span className="hidden text-center text-xs font-bold text-emerald-100/40 sm:block sm:w-[180px]">
                    Owner PIN สำหรับจัดการสินค้า
                  </span>
                )}
              </article>
            );
          })
        )}
      </div>

      <div className="fixed inset-x-3 bottom-3 z-40 mx-auto max-w-2xl rounded-xl border border-market-green/45 bg-market-panel/95 p-2.5 shadow-2xl backdrop-blur sm:bottom-4 sm:flex sm:items-center sm:justify-between sm:gap-3 sm:p-3">
        <p className="mb-2 text-center text-sm font-black text-emerald-50 sm:mb-0 sm:text-left">
          เลือกแล้ว {selectedProducts.length} รายการ
        </p>
        <button
          type="button"
          onClick={() => void sendSelectedProducts()}
          disabled={selectedProducts.length === 0 || isBulkSubmitting}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-market-green px-5 font-black text-market-ink disabled:cursor-not-allowed disabled:bg-slate-600 disabled:text-slate-300 sm:w-auto sm:min-w-56"
        >
          <Send className={`h-5 w-5 ${isBulkSubmitting ? "animate-pulse" : ""}`} />
          {isBulkSubmitting
            ? "กำลังส่งรายการ..."
            : `ส่งรายการ ${selectedProducts.length} รายการ`}
        </button>
      </div>

      <details className="mt-4 rounded-lg border border-white/10 bg-market-panel/72 p-3">
        <summary className="cursor-pointer font-black text-emerald-100">เครื่องมือรายการวันนี้</summary>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={onBackup}
            className="min-h-12 rounded-lg border border-market-blue/60 bg-market-blue/12 px-4 font-black text-sky-100"
          >
            Backup วันนี้เป็น CSV
          </button>
          <button
            type="button"
            onClick={onClearToday}
            disabled={isClearingToday}
            className="min-h-12 rounded-lg border border-market-red/60 bg-market-red/12 px-4 font-black text-red-100 disabled:opacity-50"
          >
            {isClearingToday ? "กำลังล้าง..." : "ล้างข้อมูลวันนี้"}
          </button>
        </div>
      </details>

      {editor && (
        <ProductEditorModal
          editor={editor}
          supplierSuggestions={Array.from(new Set(products
            .filter((product) => product.active && product.supplierName.trim())
            .map((product) => product.supplierName.trim())))
            .sort((left, right) => left.localeCompare(right, "th"))}
          isSaving={isSavingProduct}
          onChange={setEditor}
          onSave={() => void saveProduct()}
          onClose={() => setEditor(null)}
        />
      )}
    </section>
  );
}

function ProductEditorModal({
  editor,
  supplierSuggestions,
  isSaving,
  onChange,
  onSave,
  onClose,
}: {
  editor: ProductEditorState;
  supplierSuggestions: string[];
  isSaving: boolean;
  onChange: (editor: ProductEditorState) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/75 px-3 py-5 backdrop-blur-sm">
      <section className="w-full max-w-lg rounded-lg border border-market-mint/35 bg-market-panel p-4 shadow-touch sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-2xl font-black text-white">
            {editor.mode === "create" ? "เพิ่มสินค้า" : "แก้ไขสินค้า"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="grid h-11 w-11 place-items-center rounded-lg border border-white/12 bg-white/5 text-white"
            aria-label="ปิด"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 grid gap-3">
          <EditorField label="ชื่อสินค้า *">
            <input
              value={editor.name}
              onChange={(event) => onChange({ ...editor, name: event.target.value })}
              autoFocus
              className="h-12 w-full rounded-lg border border-market-line bg-market-ink px-3 font-bold text-white outline-none focus:border-market-mint"
            />
          </EditorField>
          <EditorField label="หมวดหมู่ *">
            <select
              value={editor.category}
              onChange={(event) => onChange({ ...editor, category: event.target.value as ProductCategory })}
              className="h-12 w-full rounded-lg border border-market-line bg-market-ink px-3 font-bold text-white outline-none focus:border-market-mint"
            >
              {PRODUCT_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </EditorField>
          <EditorField label="วิธีจัดซื้อ *">
            <select
              value={editor.purchaseMethod}
              onChange={(event) => {
                const purchaseMethod = event.target.value as PurchaseMethod;
                onChange({
                  ...editor,
                  purchaseMethod,
                  supplierName: purchaseMethod === "walk" ? "" : editor.supplierName,
                });
              }}
              className="h-12 w-full rounded-lg border border-market-line bg-market-ink px-3 font-bold text-white outline-none focus:border-market-mint"
            >
              <option value="walk">เดินซื้อเอง</option>
              <option value="phone">โทร/LINE สั่ง</option>
            </select>
          </EditorField>
          {editor.purchaseMethod === "phone" && (
            <EditorField label="ชื่อร้าน *">
              <input
                value={editor.supplierName}
                onChange={(event) => onChange({ ...editor, supplierName: event.target.value })}
                list="product-supplier-suggestions"
                placeholder="เลือกชื่อเดิมหรือพิมพ์ชื่อร้านใหม่"
                className="h-12 w-full rounded-lg border border-market-line bg-market-ink px-3 font-bold text-white outline-none focus:border-market-mint"
              />
              <datalist id="product-supplier-suggestions">
                {supplierSuggestions.map((supplier) => <option key={supplier} value={supplier} />)}
              </datalist>
            </EditorField>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <EditorField label="หน่วยปกติ *">
              <select
                value={editor.defaultUnit}
                onChange={(event) => onChange({ ...editor, defaultUnit: event.target.value })}
                className="h-12 w-full rounded-lg border border-market-line bg-market-ink px-3 font-bold text-white outline-none focus:border-market-mint"
              >
                {PRODUCT_UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
              </select>
            </EditorField>
            <EditorField label="ราคาสูงสุด">
              <input
                value={editor.defaultMaxPrice}
                onChange={(event) => onChange({ ...editor, defaultMaxPrice: event.target.value })}
                inputMode="decimal"
                className="h-12 w-full rounded-lg border border-market-line bg-market-ink px-3 font-bold text-white outline-none focus:border-market-mint"
              />
            </EditorField>
          </div>
          <EditorField label="หมายเหตุ">
            <textarea
              value={editor.note}
              onChange={(event) => onChange({ ...editor, note: event.target.value })}
              className="min-h-24 w-full rounded-lg border border-market-line bg-market-ink p-3 font-bold text-white outline-none focus:border-market-mint"
            />
          </EditorField>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onClose}
            className="min-h-14 rounded-lg border border-white/15 bg-white/5 px-4 font-black text-white"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={isSaving}
            className="min-h-14 rounded-lg bg-market-green px-4 font-black text-market-ink disabled:bg-slate-600"
          >
            {isSaving ? "กำลังบันทึก..." : "บันทึกสินค้า"}
          </button>
        </div>
      </section>
    </div>
  );
}

function EditorField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label>
      <span className="mb-1.5 block text-sm font-black text-emerald-100/70">{label}</span>
      {children}
    </label>
  );
}
