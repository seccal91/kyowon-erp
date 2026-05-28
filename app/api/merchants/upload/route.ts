import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import pool from "../../../../lib/db";
import { parseAddress } from "../../../../lib/address-parser";

export const runtime = "nodejs";

async function ensureTables(client: any) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS merchants (
      merchant_code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      contract_date DATE,
      termination_date DATE,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS merchant_mappings (
      merchant_code TEXT PRIMARY KEY,
      org_id BIGINT,
      contract_date DATE,
      member_count INT DEFAULT 0,
      status TEXT DEFAULT 'active',
      major TEXT,
      minor TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await client.query(`ALTER TABLE merchant_mappings ADD COLUMN IF NOT EXISTS major TEXT`);
  await client.query(`ALTER TABLE merchant_mappings ADD COLUMN IF NOT EXISTS minor TEXT`);
}

export async function GET(req: NextRequest) {
  try {
    const client = await pool.connect();
    await ensureTables(client);

    const res = await client.query(`
      SELECT m.merchant_code, m.name, m.status, m.contract_date, m.termination_date,
             mm.major, mm.minor
      FROM merchants m
      LEFT JOIN merchant_mappings mm ON mm.merchant_code = m.merchant_code
      ORDER BY m.status ASC, m.name ASC
    `);
    client.release();
    return NextResponse.json({ merchants: res.rows });
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
    const merchants: Array<any> = body.merchants || [];

    if (!Array.isArray(merchants) || merchants.length === 0) {
      return NextResponse.json({ message: "가맹점 데이터 필요" }, { status: 400 });
    }

    client = await pool.connect();
    await ensureTables(client);

    const orgsRes = await client.query(`SELECT id, name, regions FROM organizations`);
    const regionToOrgId: Record<string, number> = {};
    for (const org of orgsRes.rows) {
      for (const region of (org.regions || [])) {
        regionToOrgId[`${region.major}||${region.minor}`] = Number(org.id);
      }
    }

    const inserted: string[] = [];
    const failed: any[] = [];

    for (let idx = 0; idx < merchants.length; idx++) {
      const merchant = merchants[idx];
      const rowNum = idx + 2;
      try {
        const code = String(merchant.조직코드 || merchant["조직코드"] || "").trim();
        const name = String(merchant.교실명 || merchant["교실명"] || "").trim();
        const address = String(merchant.주소 || merchant["주소"] || "").trim();
        const contractDateStr = String(merchant.계약일 || merchant["계약일"] || "").trim();
        const terminationDateStr = String(merchant.해지일자 || merchant["해지일자"] || "").trim();

        if (!code || !name) {
          failed.push({ row: rowNum, code, error: "조직코드 또는 교실명 누락" });
          continue;
        }

        const parseDate = (raw: string): string | null => {
          if (!raw) return null;
          const cleaned = raw
            .trim()
            .replace(/\s+/g, " ")
            .replace(/\./g, "-")
            .replace(/T.*$/, "")
            .replace(/\.0+$/, "")
            .replace(/\u00A0/g, " ")
            .replace(/[^0-9\-\/ ]/g, "")
            .trim();

          if (/^\d{1,5}$/.test(cleaned)) {
            const d = new Date((parseInt(cleaned, 10) - 25569) * 86400 * 1000);
            return d.toISOString().split("T")[0];
          }

          const isoMatch = cleaned.match(/(\d{4})[-\/ ](\d{1,2})[-\/ ](\d{1,2})/);
          if (isoMatch) {
            const year = isoMatch[1];
            const month = String(Number(isoMatch[2])).padStart(2, "0");
            const day = String(Number(isoMatch[3])).padStart(2, "0");
            return `${year}-${month}-${day}`;
          }

          const compactMatch = cleaned.match(/^(\d{4})(\d{2})(\d{2})$/);
          if (compactMatch) {
            return `${compactMatch[1]}-${compactMatch[2]}-${compactMatch[3]}`;
          }

          const parsed = new Date(cleaned);
          if (!Number.isNaN(parsed.getTime())) {
            return parsed.toISOString().split("T")[0];
          }

          return null;
        };

        const contractDate = parseDate(contractDateStr);
        const terminationDate = parseDate(terminationDateStr);
        const status = terminationDate ? "terminated" : "active";

        let major: string | null = null;
        let minor: string | null = null;
        let orgId: number | null = null;

        if (address) {
          const parsed = parseAddress(address);
          if (parsed?.major && parsed?.minor) {
            major = parsed.major;
            minor = parsed.minor;
            orgId = regionToOrgId[`${major}||${minor}`] ?? null;
          }
        }

        await client.query(
          `INSERT INTO merchants (merchant_code, name, status, contract_date, termination_date)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (merchant_code) DO UPDATE
           SET name = EXCLUDED.name, status = EXCLUDED.status,
               contract_date = EXCLUDED.contract_date, termination_date = EXCLUDED.termination_date`,
          [code, name, status, contractDate, terminationDate]
        );

        if (orgId) {
          await client.query(
            `INSERT INTO merchant_mappings (merchant_code, org_id, major, minor, contract_date, status)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (merchant_code) DO UPDATE
             SET org_id = EXCLUDED.org_id, major = EXCLUDED.major, minor = EXCLUDED.minor,
                 contract_date = EXCLUDED.contract_date, status = EXCLUDED.status`,
            [code, orgId, major, minor, contractDate, status]
          );
        }

        inserted.push(code);
      } catch (itemErr) {
        console.error(`행 ${rowNum} 처리 중 오류:`, itemErr);
        failed.push({ row: rowNum, code: merchant.조직코드, error: String(itemErr) });
      }
    }

    client.release();

    return NextResponse.json({
      ok: true,
      inserted: inserted.length,
      failed: failed.length,
      message: `${inserted.length}개 저장됨${failed.length > 0 ? ` / ${failed.length}개 실패` : ""}`,
      failedDetails: failed.slice(0, 20),
    });
  } catch (err) {
    console.error("업로드 중 전체 오류:", err);
    if (client) client.release();
    return NextResponse.json({ ok: false, message: "서버 오류: " + String(err) }, { status: 500 });
  }
}
