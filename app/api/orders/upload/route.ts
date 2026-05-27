import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import pool from "../../../../lib/db";

export const runtime = "nodejs";

async function ensureTables(client: any) {
  // orders 테이블 - 상품종류별 수량 집계
  await client.query(`
    CREATE TABLE IF NOT EXISTS orders (
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

export async function GET(req: NextRequest) {
  try {
    const client = await pool.connect();
    await ensureTables(client);

    const merchantCode = req.nextUrl.searchParams.get("merchant_code");
    const year = req.nextUrl.searchParams.get("year");

    let query = `
      SELECT merchant_code, year, month, product_counts, total_quantity, created_at
      FROM orders
      WHERE 1=1
    `;
    const params: any[] = [];

    if (merchantCode) {
      query += ` AND merchant_code = $${params.length + 1}`;
      params.push(merchantCode);
    }

    if (year) {
      query += ` AND year = $${params.length + 1}`;
      params.push(parseInt(year));
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
    await ensureTables(client);

    const inserted: number = 0;
    const failed: any[] = [];
    const productTypes = ["영업교재", "정규", "초도", "신규"];

    for (let idx = 0; idx < orders.length; idx++) {
      const order = orders[idx];
      const rowNum = idx + 2; // Excel 행 번호

      try {
        const dateStr = String(order.날짜 || order["날짜"] || "").trim();
        const code = String(order.코드 || order["코드"] || "").trim();
        const productType = String(order.상품종류 || order["상품종류"] || "").trim();
        const quantityStr = String(order.수량 || order["수량"] || "0").trim();
        const cancelledStr = String(order.취소여부 || order["취소여부"] || "N").trim().toUpperCase();

        if (!dateStr || !code || !productType) {
          failed.push({ row: rowNum, error: "날짜, 코드, 상품종류 필수" });
          continue;
        }

        // 날짜 파싱
        let year: number, month: number;
        if (/^\d{1,5}$/.test(dateStr)) {
          // Excel 날짜 번호
          const excelDate = parseInt(dateStr);
          const jsDate = new Date((excelDate - 25569) * 86400 * 1000);
          year = jsDate.getFullYear();
          month = jsDate.getMonth() + 1;
        } else {
          const match = dateStr.match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);
          if (match) {
            year = parseInt(match[1]);
            month = parseInt(match[2]);
          } else {
            failed.push({ row: rowNum, error: "날짜 형식 오류" });
            continue;
          }
        }

        // 수량 파싱
        const quantity = parseInt(quantityStr) || 0;

        // 취소 여부
        const isCancelled = cancelledStr === "Y";

        // 상품종류 정규화
        let normalizedType = productType;
        if (!productTypes.includes(normalizedType)) {
          failed.push({ row: rowNum, error: `알 수 없는 상품종류: ${productType}` });
          continue;
        }

        // 취소 주문은 수량 차감
        const qty = isCancelled ? -quantity : quantity;

        // 기존 데이터 조회
        const existingRes = await client.query(
          `SELECT product_counts, total_quantity FROM orders 
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

        // 수량 업데이트
        productCounts[normalizedType as keyof typeof productCounts] =
          (productCounts[normalizedType as keyof typeof productCounts] || 0) + qty;
        totalQty += qty;

        // UPSERT
        await client.query(
          `INSERT INTO orders (merchant_code, year, month, product_counts, total_quantity)
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

    client.release();

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
