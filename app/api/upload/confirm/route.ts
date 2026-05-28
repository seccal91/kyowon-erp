import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import pool from "../../../../lib/db";
import { parseExcelByHeader, cellToStr, cellToDate, cellToNum } from "../../../../lib/excel-parser";
import { parseAddress } from "../../../../lib/address-parser";
import { REGION_MAP } from "../../../../lib/regions";

export const runtime = "nodejs";

const MODE_REQUIRED: Record<string, string[]> = {
  merchants: ["조직코드"],
  orders:    ["가맹교실ID", "주문일", "수량"],
  branches:  ["지사명"],
};

async function ensureHistory(client: any) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS upload_history (
      id BIGSERIAL PRIMARY KEY,
      filename TEXT NOT NULL,
      mode TEXT NOT NULL,
      uploaded_at TIMESTAMP DEFAULT NOW(),
      uploaded_by TEXT,
      total_rows INT DEFAULT 0,
      inserted INT DEFAULT 0,
      updated INT DEFAULT 0,
      errors INT DEFAULT 0,
      skipped INT DEFAULT 0
    )
  `);
}

// ─── Confirm: merchants ───────────────────────────────────────────────────────
async function confirmMerchants(rows: Record<string, unknown>[], client: any) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS merchants (
      merchant_code TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT DEFAULT 'active',
      contract_date DATE, termination_date DATE, created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS merchant_mappings (
      merchant_code TEXT PRIMARY KEY, org_id BIGINT, contract_date DATE,
      member_count INT DEFAULT 0, major TEXT, minor TEXT, status TEXT DEFAULT 'active',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await client.query(`ALTER TABLE merchant_mappings ADD COLUMN IF NOT EXISTS major TEXT`);
  await client.query(`ALTER TABLE merchant_mappings ADD COLUMN IF NOT EXISTS minor TEXT`);

  const orgsRes = await client.query(`SELECT id, regions FROM organizations`);
  const regionToOrgId: Record<string, number> = {};
  for (const org of orgsRes.rows) {
    for (const r of (org.regions || [])) {
      regionToOrgId[`${r.major}||${r.minor}`] = Number(org.id);
    }
  }

  let inserted = 0, updated = 0, errors = 0, skipped = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      const code = cellToStr(row["조직코드"]);
      const name = cellToStr(row["교실명"] ?? row["가맹점명"] ?? null);
      const address = cellToStr(row["주소"] ?? null);
      const contractDate = cellToDate(row["계약일"]);
      const termDate = cellToDate(row["해지일자"]);
      const status = termDate ? "terminated" : "active";

      if (!code) { errors++; continue; }

      // Check existing
      const ex = await client.query(`SELECT merchant_code FROM merchants WHERE merchant_code = $1`, [code]);
      const isNew = ex.rows.length === 0;

      if (isNew && !name) { errors++; continue; }

      // Upsert merchant (only update non-null fields)
      if (isNew) {
        await client.query(
          `INSERT INTO merchants (merchant_code, name, status, contract_date, termination_date)
           VALUES ($1, $2, $3, $4, $5)`,
          [code, name, status, contractDate, termDate]
        );
        inserted++;
      } else {
        const sets: string[] = ["status = $2"];
        const vals: any[] = [code, status];
        if (name) { sets.push(`name = $${vals.length + 1}`); vals.push(name); }
        if (contractDate) { sets.push(`contract_date = $${vals.length + 1}`); vals.push(contractDate); }
        if (termDate) { sets.push(`termination_date = $${vals.length + 1}`); vals.push(termDate); }
        await client.query(`UPDATE merchants SET ${sets.join(", ")} WHERE merchant_code = $1`, vals);
        updated++;
      }

      // Resolve org from address
      let major: string | null = null, minor: string | null = null, orgId: number | null = null;
      if (address) {
        const parsed = parseAddress(address);
        if (parsed?.major && parsed?.minor) {
          major = parsed.major; minor = parsed.minor;
          orgId = regionToOrgId[`${major}||${minor}`] ?? null;
        }
      }

      if (orgId || isNew) {
        await client.query(
          `INSERT INTO merchant_mappings (merchant_code, org_id, major, minor, contract_date, status)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (merchant_code) DO UPDATE
           SET org_id = COALESCE(EXCLUDED.org_id, merchant_mappings.org_id),
               major = COALESCE(EXCLUDED.major, merchant_mappings.major),
               minor = COALESCE(EXCLUDED.minor, merchant_mappings.minor),
               contract_date = COALESCE(EXCLUDED.contract_date, merchant_mappings.contract_date),
               status = EXCLUDED.status`,
          [code, orgId, major, minor, contractDate, status]
        );
      }
    } catch { errors++; }
  }

  return { inserted, updated, errors, skipped };
}

// ─── Confirm: orders ──────────────────────────────────────────────────────────
async function confirmOrders(rows: Record<string, unknown>[], client: any) {
  await client.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_date DATE`);
  await client.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_type TEXT`);
  await client.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS grade TEXT`);
  await client.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled BOOLEAN DEFAULT FALSE`);

  let inserted = 0, errors = 0, skipped = 0;

  for (const row of rows) {
    try {
      const code = cellToStr(row["가맹교실ID"]);
      const orderDate = cellToDate(row["주문일"]);
      const qty = cellToNum(row["수량"]);
      const orderTypeRaw = cellToStr(row["주문구분"]);
      const isNew = cellToStr(row["신규여부"]).toUpperCase();
      const cancelRaw = cellToStr(row["취소여부"]);
      const grade = cellToStr(row["학년"]) || null;

      if (!code || !orderDate || qty === null || qty === 0) { skipped++; continue; }

      let orderType: string;
      if (orderTypeRaw === "초도") orderType = "초도";
      else if (orderTypeRaw === "영업교재") orderType = "영업교재";
      else if (orderTypeRaw === "정규") orderType = "정규";
      else if (orderTypeRaw === "신규복회" || orderTypeRaw === "신규/복회") {
        orderType = isNew === "Y" ? "신규" : "복회";
      } else orderType = orderTypeRaw || "정규";

      const cancelled = cancelRaw === "취소완료";
      const d = new Date(orderDate);
      const year = d.getFullYear();
      const month = d.getMonth() + 1;

      await client.query(
        `INSERT INTO orders (merchant_code, order_date, year, month, order_type, grade, quantity, cancelled)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [code, orderDate, year, month, orderType, grade, qty, cancelled]
      );
      inserted++;
    } catch { errors++; }
  }

  return { inserted, updated: 0, errors, skipped };
}

// ─── Confirm: branches ────────────────────────────────────────────────────────
async function confirmBranches(rows: Record<string, unknown>[], client: any) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS organizations (
      id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL,
      regions JSONB DEFAULT '[]'::jsonb, group_name TEXT DEFAULT '예외',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  let inserted = 0, updated = 0, errors = 0, skipped = 0;

  for (const row of rows) {
    try {
      const name = cellToStr(row["지사명"]);
      const regionRaw = cellToStr(row["지역"] ?? row["대분류"] ?? null);
      const minorRaw = cellToStr(row["중분류"] ?? null);
      if (!name) { errors++; continue; }

      let major = "", minor: string | null = null;
      if (regionRaw) {
        for (const key of Object.keys(REGION_MAP)) {
          if (regionRaw.includes(key) || key.includes(regionRaw)) { major = key; break; }
        }
        minor = minorRaw || null;
      }

      const ex = await client.query(`SELECT id, regions FROM organizations WHERE name = $1`, [name]);
      if (ex.rows.length === 0) {
        const regionArr = major ? [{ major, minor }] : [];
        await client.query(
          `INSERT INTO organizations (name, regions, group_name) VALUES ($1, $2, '예외')`,
          [name, JSON.stringify(regionArr)]
        );
        inserted++;
      } else if (major) {
        const org = ex.rows[0];
        const regs: any[] = org.regions ?? [];
        const has = regs.some((r: any) => r.major === major && r.minor === minor);
        if (!has) {
          regs.push({ major, minor });
          await client.query(`UPDATE organizations SET regions = $1 WHERE id = $2`, [JSON.stringify(regs), org.id]);
          updated++;
        } else { skipped++; }
      } else { skipped++; }
    } catch { errors++; }
  }

  return { inserted, updated, errors, skipped };
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
      return NextResponse.json({ message: `필수 컬럼 없음: ${missingRequired.join(", ")}` }, { status: 400 });
    }
    if (!rows.length) return NextResponse.json({ message: "데이터 없음" }, { status: 400 });

    client = await pool.connect();
    await ensureHistory(client);

    let stats: any;
    if (mode === "merchants") stats = await confirmMerchants(rows, client);
    else if (mode === "orders") stats = await confirmOrders(rows, client);
    else stats = await confirmBranches(rows, client);

    // Log history
    const histRes = await client.query(
      `INSERT INTO upload_history (filename, mode, uploaded_by, total_rows, inserted, updated, errors, skipped)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [file.name, mode, token.email || token.name || "admin",
       rows.length, stats.inserted, stats.updated, stats.errors, stats.skipped]
    );

    return NextResponse.json({
      ok: true,
      history_id: histRes.rows[0]?.id,
      total_rows: rows.length,
      ...stats,
    });
  } catch (err) {
    console.error("confirm error:", err);
    return NextResponse.json({ message: String(err) }, { status: 500 });
  } finally {
    if (client) client.release();
  }
}
