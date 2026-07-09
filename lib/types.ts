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
