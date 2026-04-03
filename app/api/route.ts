import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export async function POST(request: Request) {
  try {
    // 1. .env.local에 있는 열쇠로 DB에 접속합니다.
    const sql = neon(process.env.POSTGRES_URL!);
    
    // 2. 만약 DB에 '직영 급여 창고(kyowon_salary)'가 없다면 지금 당장 만듭니다!
    await sql`
      CREATE TABLE IF NOT EXISTS kyowon_salary (
        id SERIAL PRIMARY KEY,
        academy VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        position VARCHAR(255) NOT NULL,
        total_pay NUMERIC NOT NULL,
        total_deduction NUMERIC NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // 3. 사용자가 화면에서 보낸 데이터를 받습니다.
    const data = await request.json(); 

    // 4. 받은 데이터를 창고에 차곡차곡 저장합니다.
    for (const row of data) {
      await sql`
        INSERT INTO kyowon_salary (academy, name, position, total_pay, total_deduction)
        VALUES (${row.academy}, ${row.name}, ${row.position}, ${row.totalPay}, ${row.totalDeduction})
      `;
    }

    // 5. 성공했다고 프론트엔드에 알려줍니다.
    return NextResponse.json({ message: "DB 저장 성공!" }, { status: 200 });
  } catch (error) {
    console.error("DB 연동 에러 상세내역:", error);
    return NextResponse.json({ error: "데이터베이스 저장 중 문제가 발생했습니다." }, { status: 500 });
  }
}