import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ configured: Boolean(process.env.IMPORT_PAGE_PIN) });
}

export async function POST(request: Request) {
  const configuredPin = process.env.IMPORT_PAGE_PIN;

  if (!configuredPin) {
    return NextResponse.json(
      { ok: false, configured: false, error: "IMPORT_PAGE_PIN is not configured" },
      { status: 503 },
    );
  }

  let submittedPin = "";
  try {
    const body = (await request.json()) as { pin?: unknown };
    submittedPin = typeof body.pin === "string" ? body.pin : "";
  } catch {
    submittedPin = "";
  }

  return NextResponse.json({ ok: submittedPin === configuredPin, configured: true });
}
