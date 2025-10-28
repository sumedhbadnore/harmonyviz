import { NextResponse } from "next/server";

let presets: any[] = [];

export async function GET() {
  return NextResponse.json(presets);
}

export async function POST(request: Request) {
  const data = await request.json();
  presets.push(data);
  return NextResponse.json({ success: true, data });
}
