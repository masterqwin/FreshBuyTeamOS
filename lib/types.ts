export type ItemStatus =
  | "pending"
  | "bought"
  | "checked"
  | "missing"
  | "unavailable"
  | "expensive"
  | "cancelled";

export type BuyerName = "ผู้ซื้อ 1" | "ผู้ซื้อ 2" | "ผู้ซื้อ 3" | "คนเช็คของ";
export type VehicleStatus = "unchecked" | "loaded" | "incomplete";

export const PRODUCT_CATEGORIES = [
  "ผักใบ",
  "ผักผล",
  "ผักเมืองหนาว",
  "ผักแพ๊คและเห็ด",
  "เครื่องเทศ",
  "อื่นๆ",
] as const;

export const PRODUCT_UNITS = [
  "กก.",
  "บาท",
  "ถุง",
  "กำ",
  "โล",
  "แพ็ค",
  "หลอด",
  "แท่ง",
  "ห่อ",
  "แผ่น",
  "ลูก",
  "มัด",
  "ขวด",
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];
export type ProductUnit = (typeof PRODUCT_UNITS)[number];

export type ProductMasterItem = {
  id: string;
  name: string;
  category: ProductCategory;
  defaultUnit: ProductUnit;
  defaultMaxPrice: number | "";
  note: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ProductMasterInput = Pick<
  ProductMasterItem,
  "name" | "category" | "defaultUnit" | "defaultMaxPrice" | "note"
>;

export type FreshBuyItem = {
  id: string;
  name: string;
  quantity: string;
  unit: string;
  maxPrice: number;
  note: string;
  status: ItemStatus;
  buyerName: BuyerName | "";
  boughtAt: string;
  actualPrice: number | "";
  checkedAt: string;
  issueNote: string;
  vehicleStatus?: VehicleStatus;
};

export type ParsedImportRow = Pick<
  FreshBuyItem,
  "name" | "quantity" | "unit" | "maxPrice" | "note"
>;
