import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import pool from "../../../../lib/db";
import {
  cellToDate,
  cellToNum,
  cellToStr,
  isCancelled,
  normalizeOrderType,
  parseExcelByHeader,
  pick,
} from "../../../../lib/excel-parser";

export const runtime = "nodejs";

type Mode = "merchants" | "orders" | "branches";

const MODE_LABEL: Record<Mode, string> = {
  merchants: "가맹점",
  orders: "주문",
  branches: "지사",
};

const ALIASES = {
  merchantCode: ["조직코드", "가맹교실ID", "가맹점코드", "코드", "merchant_code", "code"],
  merchantName: ["교실명", "가맹점명", "가맹교실명", "상호", "name"],
  address: ["주소", "address"],
  contractDate: ["계약일", "계약일자", "contract_date"],
  terminationDate: ["해지일자", "해지일", "termination_date"],
  orderDate: ["주문일", "주문일자", "주문연도월일", "order_date", "date"],
  orderType: ["주문구분", "주문종류", "주문유형", "order_type", "type"],
  quantity: ["수량", "주문수", "quantity", "qty"],
  cancelled: ["취소여부", "취소", "cancelled"],
  grade: ["학년", "grade"],
  newFlag: ["신규여부", "신규", "new_flag"],
  branchName: ["지사명", "branch", "branch_name"],
  regionMajor: ["지역", "대분류", "시도", "major"],
  regionMinor: ["중분류", "시군구", "minor"],
};

function missingAliases(headers: string[], required: string[][]) {
  const headerSet = new Set(headers.map((h) => h.replace(/\s+/g, "")));
  return required
    .filter((aliases) => !aliases.some((alias) => headerSet.has(alias.replace(/\s+/g, ""))))
    .map((aliases) => aliases[0]);
}

async function previewOrders(rows: Record<string, unknown>[], client: any) {
  const newRows: any[] = [];
  const errorRows: any[] = [];

  const codes = [...new Set(rows.map((row) => cellToStr(pick(row, ALIASES.merchantCode))).filter(Boolean))];
  const knownCodes = new Set<string>();
  if (codes.length > 0) {
    const res = await client.query(
      `SELECT merchant_code FROM merchant_mappings WHERE merchant_code = ANY($1)`,
      [codes]
    );
    for (const row of res.rows) knownCodes.add(row.merchant_code);
  }

  rows.forEach((row, index) => {
    const code = cellToStr(pick(row, ALIASES.merchantCode));
    const orderDate = cellToDate(pick(row, ALIASES.orderDate));
    const qty = cellToNum(pick(row, ALIASES.quantity));
    const rawType = pick(row, ALIASES.orderType);
    const orderType = normalizeOrderType(rawType, pick(row, ALIASES.newFlag));
    const cancelled = isCancelled(pick(row, ALIASES.cancelled));
    const grade = cellToStr(pick(row, ALIASES.grade));

    const reasons: string[] = [];
    if (!code) reasons.push("조직코드 누락");
    if (!orderDate) reasons.push("주문일 파싱 실패");
    if (!cellToStr(rawType)) reasons.push("주문구분 누락");
    if (qty === null || qty === 0) reasons.push("수량 없음");

    if (reasons.length > 0) {
      errorRows.push({
        rowNum: index + 2,
        reason: reasons.join(", "),
        data: {
          조직코드: code,
          주문일: cellToStr(pick(row, ALIASES.orderDate)),
          주문구분: cellToStr(rawType),
          수량: cellToStr(pick(row, ALIASES.quantity)),
        },
      });
      return;
    }

    newRows.push({
      rowNum: index + 2,
      key: code,
      after: {
        조직코드: code,
        주문일: orderDate,
        주문구분: orderType,
        수량: qty,
        취소여부: cancelled ? "취소완료" : "",
        학년: grade || "",
        가맹점매핑: knownCodes.has(code) ? "등록됨" : "미등록",
      },
    });
  });

  return {
    mode: "orders",
    stats: { new: newRows.length, update: 0, error: errorRows.length, skip: 0 },
    new_rows: newRows.slice(0, 200),
    update_rows: [],
    error_rows: errorRows.slice(0, 200),
    total_rows: rows.length,
  };
}

async function previewMerchants(rows: Record<string, unknown>[], client: any) {
  const newRows: any[] = [];
  const updateRows: any[] = [];
  const errorRows: any[] = [];
  const skipRows: any[] = [];

  const codes = rows.map((row) => cellToStr(pick(row, ALIASES.merchantCode))).filter(Boolean);
  const existing: Record<string, any> = {};
  if (codes.length > 0) {
    const res = await client.query(
      `SELECT merchant_code, name, status, contract_date, termination_date FROM merchants WHERE merchant_code = ANY($1)`,
      [codes]
    );
    for (const row of res.rows) existing[row.merchant_code] = row;
  }

  rows.forEach((row, index) => {
    const code = cellToStr(pick(row, ALIASES.merchantCode));
    const name = cellToStr(pick(row, ALIASES.merchantName));
    const address = cellToStr(pick(row, ALIASES.address));
    const contractDate = cellToDate(pick(row, ALIASES.contractDate));
    const terminationDate = cellToDate(pick(row, ALIASES.terminationDate));
    const status = terminationDate ? "해지" : "정상";

    if (!code) {
      errorRows.push({ rowNum: index + 2, reason: "조직코드 누락", data: row });
      return;
    }

    const after: Record<string, unknown> = { 조직코드: code };
    if (name) after.교실명 = name;
    if (address) after.주소 = address;
    if (contractDate) after.계약일 = contractDate;
    if (terminationDate) after.해지일자 = terminationDate;
    after.상태 = status;

    const previous = existing[code];
    if (!previous) {
      if (!name) {
        errorRows.push({ rowNum: index + 2, reason: "신규 등록에는 교실명이 필요합니다.", data: row });
        return;
      }
      newRows.push({ rowNum: index + 2, key: code, after });
      return;
    }

    const before: Record<string, unknown> = {
      교실명: previous.name,
      계약일: previous.contract_date ? String(previous.contract_date).split("T")[0] : "",
      해지일자: previous.termination_date ? String(previous.termination_date).split("T")[0] : "",
      상태: previous.status === "terminated" ? "해지" : "정상",
    };
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const [key, value] of Object.entries(after)) {
      if (key === "조직코드") continue;
      if (value !== "" && value !== null && String(value) !== String(before[key] ?? "")) {
        changes[key] = { from: before[key] ?? "", to: value };
      }
    }
    if (Object.keys(changes).length === 0) skipRows.push({ rowNum: index + 2, key: code });
    else updateRows.push({ rowNum: index + 2, key: code, before, after, changes });
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

async function previewBranches(rows: Record<string, unknown>[], client: any) {
  const newRows: any[] = [];
  const updateRows: any[] = [];
  const errorRows: any[] = [];
  const skipRows: any[] = [];

  const names = rows.map((row) => cellToStr(pick(row, ALIASES.branchName))).filter(Boolean);
  const existing: Record<string, any> = {};
  if (names.length > 0) {
    const res = await client.query(`SELECT id, name, regions FROM organizations WHERE name = ANY($1)`, [names]);
    for (const row of res.rows) existing[row.name] = row;
  }

  rows.forEach((row, index) => {
    const name = cellToStr(pick(row, ALIASES.branchName));
    const major = cellToStr(pick(row, ALIASES.regionMajor));
    const minor = cellToStr(pick(row, ALIASES.regionMinor));

    if (!name) {
      errorRows.push({ rowNum: index + 2, reason: "지사명 누락", data: row });
      return;
    }

    const after = { 지사명: name, 대분류: major, 중분류: minor };
    const previous = existing[name];
    if (!previous) {
      newRows.push({ rowNum: index + 2, key: name, after });
      return;
    }

    const currentRegions = (previous.regions ?? [])
      .map((region: any) => `${region.major}${region.minor ? ` ${region.minor}` : ""}`)
      .join(", ");
    const nextRegion = major ? `${major}${minor ? ` ${minor}` : ""}` : "";

    if (nextRegion && !currentRegions.includes(nextRegion)) {
      updateRows.push({
        rowNum: index + 2,
        key: name,
        before: { 지역: currentRegions },
        after: { 지역: currentRegions ? `${currentRegions}, ${nextRegion}` : nextRegion },
        changes: { 지역: { from: currentRegions, to: `${nextRegion} 추가` } },
      });
    } else {
      skipRows.push({ rowNum: index + 2, key: name });
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

export async function POST(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) return NextResponse.json({ message: "권한 없음" }, { status: 401 });

  let client;
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    const mode = String(formData.get("mode") || "") as Mode;

    if (!file || !(file instanceof File)) return NextResponse.json({ message: "파일이 없습니다." }, { status: 400 });
    if (!MODE_LABEL[mode]) return NextResponse.json({ message: "업로드 종류가 올바르지 않습니다." }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = parseExcelByHeader(buffer, []);

    const required =
      mode === "orders"
        ? [ALIASES.merchantCode, ALIASES.orderDate, ALIASES.orderType, ALIASES.quantity]
        : mode === "merchants"
          ? [ALIASES.merchantCode]
          : [ALIASES.branchName];
    const missingRequired = missingAliases(parsed.headers, required);
    if (missingRequired.length > 0) {
      return NextResponse.json(
        { ok: false, message: `필수 컬럼 없음: ${missingRequired.join(", ")}`, missing_cols: missingRequired },
        { status: 400 }
      );
    }
    if (parsed.rows.length === 0) return NextResponse.json({ message: "데이터 행이 없습니다." }, { status: 400 });

    client = await pool.connect();
    const result =
      mode === "orders"
        ? await previewOrders(parsed.rows, client)
        : mode === "merchants"
          ? await previewMerchants(parsed.rows, client)
          : await previewBranches(parsed.rows, client);

    return NextResponse.json({ ok: true, filename: file.name, ...result });
  } catch (error) {
    console.error("upload preview error:", error);
    return NextResponse.json({ message: String(error) }, { status: 500 });
  } finally {
    if (client) client.release();
  }
}
