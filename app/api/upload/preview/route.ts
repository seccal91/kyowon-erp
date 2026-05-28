import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import pool from "../../../../lib/db";
import { parseExcelByHeader, cellToStr, cellToDate, cellToNum } from "../../../../lib/excel-parser";

export const runtime = "nodejs";

// ─── Mode configs ────────────────────────────────────────────────────────────
const MODE_REQUIRED: Record<string, string[]> = {
  merchants: ["조직코드"],
  orders:    ["가맹교실ID", "주문일", "수량"],
  branches:  ["지사명"],
};

// ─── Per-mode preview builders ────────────────────────────────────────────────

async function previewMerchants(rows: Record<string, unknown>[], client: any) {
  const newRows: any[] = [];
  const updateRows: any[] = [];
  const errorRows: any[] = [];
  const skipRows: any[] = [];

  const codes = rows.map(r => cellToStr(r["조직코드"])).filter(Boolean);
  const existing: Record<string, any> = {};
  if (codes.length) {
    const res = await client.query(
      `SELECT merchant_code, name, status, contract_date, termination_date FROM merchants WHERE merchant_code = ANY($1)`,
      [codes]
    );
    for (const r of res.rows) existing[r.merchant_code] = r;
  }

  rows.forEach((row, i) => {
    const code = cellToStr(row["조직코드"]);
    const name = cellToStr(row["교실명"] ?? row["가맹점명"] ?? null);
    const contractDate = cellToDate(row["계약일"]);
    const termDate = cellToDate(row["해지일자"]);
    const status = termDate ? "terminated" : "active";

    if (!code) { errorRows.push({ rowNum: i + 2, reason: "조직코드 누락", data: row }); return; }

    const after: Record<string, any> = {};
    if (name) after["교실명"] = name;
    if (contractDate) after["계약일"] = contractDate;
    if (termDate) after["해지일자"] = termDate;
    after["상태"] = status;

    const prev = existing[code];
    if (!prev) {
      if (!name) { errorRows.push({ rowNum: i + 2, reason: "교실명 누락 (신규 등록 불가)", data: row }); return; }
      newRows.push({ rowNum: i + 2, key: code, after });
    } else {
      const before: Record<string, any> = {
        "교실명": prev.name,
        "계약일": prev.contract_date ? String(prev.contract_date).split("T")[0] : null,
        "해지일자": prev.termination_date ? String(prev.termination_date).split("T")[0] : null,
        "상태": prev.status,
      };
      const changes: Record<string, { from: any; to: any }> = {};
      for (const [k, v] of Object.entries(after)) {
        if (v !== null && v !== "" && String(v) !== String(before[k] ?? "")) {
          changes[k] = { from: before[k], to: v };
        }
      }
      if (Object.keys(changes).length === 0) {
        skipRows.push({ rowNum: i + 2, key: code });
      } else {
        updateRows.push({ rowNum: i + 2, key: code, before, after, changes });
      }
    }
  });

  return {
    mode: "merchants",
    stats: { new: newRows.length, update: updateRows.length, error: errorRows.length, skip: skipRows.length },
    new_rows: newRows.slice(0, 200),
    update_rows: updateRows.slice(0, 200),
    error_rows: errorRows.slice(0, 200),
    total_rows: rows.length,
  };
}

async function previewOrders(rows: Record<string, unknown>[], client: any) {
  const validRows: any[] = [];
  const errorRows: any[] = [];

  // Load known merchant codes for validation
  const allCodes = [...new Set(rows.map(r => cellToStr(r["가맹교실ID"])).filter(Boolean))];
  const knownCodes = new Set<string>();
  if (allCodes.length) {
    const res = await client.query(
      `SELECT merchant_code FROM merchant_mappings WHERE merchant_code = ANY($1)`,
      [allCodes]
    );
    for (const r of res.rows) knownCodes.add(r.merchant_code);
  }

  rows.forEach((row, i) => {
    const code = cellToStr(row["가맹교실ID"]);
    const orderDate = cellToDate(row["주문일"]);
    const qty = cellToNum(row["수량"]);
    const orderTypeRaw = cellToStr(row["주문구분"]);
    const isNew = cellToStr(row["신규여부"]).toUpperCase();
    const cancelRaw = cellToStr(row["취소여부"]);
    const grade = cellToStr(row["학년"]);

    const reasons: string[] = [];
    if (!code) reasons.push("가맹교실ID 누락");
    if (!orderDate) reasons.push("주문일 파싱 실패");
    if (qty === null || qty === 0) reasons.push("수량 없음");

    if (reasons.length) {
      errorRows.push({ rowNum: i + 2, reason: reasons.join(", "), data: { 가맹교실ID: code, 주문일: cellToStr(row["주문일"]), 수량: row["수량"] } });
      return;
    }

    let orderType: string;
    if (orderTypeRaw === "초도") orderType = "초도";
    else if (orderTypeRaw === "영업교재") orderType = "영업교재";
    else if (orderTypeRaw === "정규") orderType = "정규";
    else if (orderTypeRaw === "신규복회" || orderTypeRaw === "신규/복회") {
      orderType = isNew === "Y" ? "신규" : "복회";
    } else orderType = orderTypeRaw || "정규";

    const cancelled = cancelRaw === "취소완료";
    const unknownMerchant = !knownCodes.has(code);

    validRows.push({
      rowNum: i + 2,
      after: {
        가맹교실ID: code,
        주문일: orderDate,
        주문구분: orderType,
        학년: grade || null,
        수량: qty,
        취소: cancelled ? "취소" : "",
        미매핑: unknownMerchant ? "⚠ 미등록 가맹점" : "",
      },
    });
  });

  return {
    mode: "orders",
    stats: { new: validRows.length, update: 0, error: errorRows.length, skip: 0 },
    new_rows: validRows.slice(0, 200),
    update_rows: [],
    error_rows: errorRows.slice(0, 200),
    total_rows: rows.length,
  };
}

async function previewBranches(rows: Record<string, unknown>[], client: any) {
  const newRows: any[] = [];
  const updateRows: any[] = [];
  const errorRows: any[] = [];
  const skipRows: any[] = [];

  const names = rows.map(r => cellToStr(r["지사명"])).filter(Boolean);
  const existing: Record<string, any> = {};
  if (names.length) {
    const res = await client.query(
      `SELECT id, name, regions, group_name FROM organizations WHERE name = ANY($1)`,
      [names]
    );
    for (const r of res.rows) existing[r.name] = r;
  }

  rows.forEach((row, i) => {
    const name = cellToStr(row["지사명"]);
    const region = cellToStr(row["지역"] ?? row["대분류"] ?? null);
    const minor = cellToStr(row["중분류"] ?? null);

    if (!name) { errorRows.push({ rowNum: i + 2, reason: "지사명 누락", data: row }); return; }

    const after: Record<string, any> = { 지사명: name };
    if (region) after["지역"] = region;
    if (minor) after["중분류"] = minor;

    const prev = existing[name];
    if (!prev) {
      newRows.push({ rowNum: i + 2, key: name, after });
    } else {
      const existingRegions = (prev.regions ?? []).map((r: any) => `${r.major}${r.minor ? " " + r.minor : ""}`).join(", ");
      const newRegion = region ? `${region}${minor ? " " + minor : ""}` : "";
      if (newRegion && !existingRegions.includes(region)) {
        updateRows.push({
          rowNum: i + 2, key: name,
          before: { 지역: existingRegions },
          after: { 지역: existingRegions ? `${existingRegions}, ${newRegion}` : newRegion },
          changes: { 지역: { from: existingRegions, to: newRegion + " 추가" } },
        });
      } else {
        skipRows.push({ rowNum: i + 2, key: name });
      }
    }
  });

  return {
    mode: "branches",
    stats: { new: newRows.length, update: updateRows.length, error: errorRows.length, skip: skipRows.length },
    new_rows: newRows.slice(0, 200),
    update_rows: updateRows.slice(0, 200),
    error_rows: errorRows.slice(0, 200),
    total_rows: rows.length,
  };
}

// ─── Route ────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) return NextResponse.json({ message: "권한 없음" }, { status: 401 });

  let client;
  try {
    const fd = await req.formData();
    const file = fd.get("file");
    const mode = String(fd.get("mode") || "");

    if (!file || !(file instanceof File)) return NextResponse.json({ message: "파일 없음" }, { status: 400 });
    if (!MODE_REQUIRED[mode]) return NextResponse.json({ message: "mode 오류" }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const { rows, missingRequired } = parseExcelByHeader(buffer, MODE_REQUIRED[mode]);

    if (missingRequired.length) {
      return NextResponse.json({
        ok: false,
        missing_cols: missingRequired,
        message: `필수 컬럼 없음: ${missingRequired.join(", ")}`,
      }, { status: 400 });
    }

    if (!rows.length) return NextResponse.json({ message: "데이터 없음" }, { status: 400 });

    client = await pool.connect();

    let result: any;
    if (mode === "merchants") result = await previewMerchants(rows, client);
    else if (mode === "orders") result = await previewOrders(rows, client);
    else result = await previewBranches(rows, client);

    return NextResponse.json({ ok: true, filename: file.name, ...result });
  } catch (err) {
    console.error("preview error:", err);
    return NextResponse.json({ message: String(err) }, { status: 500 });
  } finally {
    if (client) client.release();
  }
}
