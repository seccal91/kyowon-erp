import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import * as XLSX from "xlsx";
import pool from "../../../../lib/db";

export const runtime = "nodejs";
export const config = {
  api: {
    bodyParser: {
      sizeLimit: "16mb",
    },
  },
};

async function ensureSummaryTable(client: any) {
  // merchant_order_summaries 테이블 - 상품종류별 수량 집계
  await client.query(`
    CREATE TABLE IF NOT EXISTS merchant_order_summaries (
      id SERIAL PRIMARY KEY,
      merchant_code TEXT NOT NULL,
      year INT NOT NULL,
      month INT NOT NULL,
      product_counts JSONB DEFAULT '{"영업교재": 0, "정규": 0, "초도": 0, "신규": 0}',
      total_quantity INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(merchant_code, year, month)
    )
  `);
}

function firstValue(row: any, ...keys: string[]) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      const value = row[key];
      if (value !== undefined && value !== null && String(value).trim() !== "") {
        return value;
      }
    }
  }
  return undefined;
}

function firstStr(row: any, ...keys: string[]) {
  const value = firstValue(row, ...keys);
  return value === undefined ? "" : String(value).trim();
}

function firstNum(row: any, ...keys: string[]) {
  const value = firstValue(row, ...keys);
  if (value === undefined) return 0;
  const num = Number(value);
  return Number.isNaN(num) ? 0 : num;
}

function parseExcelDate(raw: unknown) {
  if (raw === undefined || raw === null || raw === "") return null;

  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return raw;
  }

  if (typeof raw === "number") {
    const decoded = XLSX.SSF.parse_date_code(raw);
    if (decoded) {
      return new Date(decoded.y, decoded.m - 1, decoded.d);
    }
  }

  const text = String(raw).trim();
  const slug = text.replace(/\./g, "-");
  const match = slug.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (match) {
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }

  const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) {
    return new Date(Number(compact[1]), Number(compact[2]) - 1, Number(compact[3]));
  }

  return null;
}

function normalizeProductType(rawType: string) {
  const text = rawType.replace(/\s+/g, "").toLowerCase();
  if (text.includes("영업") || text.includes("sales") || text.includes("business")) return "영업교재";
  if (text.includes("정규") || text.includes("regular")) return "정규";
  if (text.includes("초도") || text.includes("initial")) return "초도";
  if (text.includes("신규") || text.includes("new")) return "신규";
  return rawType;
}

function isCancelled(raw: unknown) {
  const text = String(raw ?? "").trim().toUpperCase();
  return text === "Y" || text === "YES" || text === "TRUE" || text === "1" || text.includes("취소");
}

export async function GET(req: NextRequest) {
  try {
    const client = await pool.connect();
    await ensureSummaryTable(client);

    const merchantCode = req.nextUrl.searchParams.get("merchant_code");
    const year = req.nextUrl.searchParams.get("year");

    let query = `
      SELECT merchant_code, year, month, product_counts, total_quantity, created_at
      FROM merchant_order_summaries
      WHERE 1=1
    `;
    const params: any[] = [];

    if (merchantCode) {
      query += ` AND merchant_code = $${params.length + 1}`;
      params.push(merchantCode);
    }

    if (year) {
      query += ` AND year = $${params.length + 1}`;
      params.push(parseInt(year, 10));
    }

    query += ` ORDER BY year DESC, month DESC`;

    const res = await client.query(query, params);
    client.release();
    return NextResponse.json({ orders: res.rows });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ message: "서버 오류" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let client;
  try {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
    if (!token || token.role !== "admin") {
      return NextResponse.json({ message: "권한 없음" }, { status: 401 });
    }

    const body = await req.json();
    const orders: Array<any> = body.orders || [];

    if (!Array.isArray(orders) || orders.length === 0) {
      return NextResponse.json({ message: "주문 데이터 필요" }, { status: 400 });
    }

    client = await pool.connect();
    await ensureSummaryTable(client);

    let inserted = 0;
    const failed: any[] = [];
    const productTypes = ["영업교재", "정규", "초도", "신규"];

    for (let idx = 0; idx < orders.length; idx++) {
      const order = orders[idx];
      const rowNum = idx + 2; // Excel 행 번호

      try {
        const dateValue = firstValue(
          order,
          "날짜",
          "date",
          "주문일",
          "order_date",
          "orderDate"
        );
        const code = firstStr(order, "코드", "code", "조직코드", "merchant_code", "merchantCode");
        const productTypeRaw = firstStr(
          order,
          "상품종류",
          "productType",
          "product_type",
          "상품유형",
          "order_type",
          "type"
        );
        const quantity = firstNum(order, "수량", "quantity", "qty", "quantity", "수량합");
        const cancelledValue = firstValue(order, "취소여부", "cancelled", "cancel", "isCancelled", "취소");

        const parsedDate = parseExcelDate(dateValue);
        if (!parsedDate || !code || !productTypeRaw) {
          failed.push({ row: rowNum, error: "날짜, 코드, 상품종류 필수" });
          continue;
        }

        const year = parsedDate.getFullYear();
        const month = parsedDate.getMonth() + 1;
        const normalizedType = normalizeProductType(productTypeRaw);
        if (!productTypes.includes(normalizedType)) {
          failed.push({ row: rowNum, error: `알 수 없는 상품종류: ${productTypeRaw}` });
          continue;
        }

        const qty = isCancelled(cancelledValue) ? -quantity : quantity;

        const existingRes = await client.query(
          `SELECT product_counts, total_quantity FROM merchant_order_summaries 
           WHERE merchant_code = $1 AND year = $2 AND month = $3`,
          [code, year, month]
        );

        let productCounts = {
          "영업교재": 0,
          "정규": 0,
          "초도": 0,
          "신규": 0,
        };
        let totalQty = 0;

        if (existingRes.rows.length > 0) {
          const existing = existingRes.rows[0];
          productCounts = existing.product_counts || productCounts;
          totalQty = existing.total_quantity || 0;
        }

        productCounts[normalizedType as keyof typeof productCounts] =
          (productCounts[normalizedType as keyof typeof productCounts] || 0) + qty;
        totalQty += qty;

        await client.query(
          `INSERT INTO merchant_order_summaries (merchant_code, year, month, product_counts, total_quantity)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (merchant_code, year, month) DO UPDATE
           SET product_counts = EXCLUDED.product_counts, total_quantity = EXCLUDED.total_quantity`,
          [code, year, month, JSON.stringify(productCounts), totalQty]
        );
      } catch (itemErr) {
        console.error(`행 ${rowNum} 처리 중 오류:`, itemErr);
        failed.push({ row: rowNum, error: String(itemErr) });
      }
    }

    if (client) client.release();

    return NextResponse.json({
      ok: true,
      inserted: orders.length - failed.length,
      failed: failed.length,
      message: `${orders.length - failed.length}개 반영됨${failed.length > 0 ? ` / ${failed.length}개 실패` : ""}`,
      failedDetails: failed.slice(0, 20),
    });
  } catch (err) {
    console.error("주문 업로드 중 오류:", err);
    if (client) client.release();
    return NextResponse.json({
      ok: false,
      message: "서버 오류: " + String(err),
    }, { status: 500 });
  }
}
