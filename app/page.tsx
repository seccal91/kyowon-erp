import Link from "next/link";

export default function HomePage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "#f8fafc",
        color: "#0f172a",
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
    >
      <section
        style={{
          width: "100%",
          maxWidth: 560,
          background: "#ffffff",
          border: "1px solid #e2e8f0",
          borderRadius: 20,
          padding: 32,
          boxShadow: "0 20px 60px rgba(15,23,42,0.08)",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 13, color: "#2563eb", fontWeight: 800, marginBottom: 10 }}>
          KYOWON ERP
        </div>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900 }}>서비스 준비 중입니다</h1>
        <p style={{ margin: "14px 0 0", color: "#64748b", lineHeight: 1.7 }}>
          일반 사용자용 사이트는 추후 공개 예정입니다.
          관리자 기능은 인증된 계정으로만 접근할 수 있습니다.
        </p>
        <Link
          href="/admin"
          style={{
            display: "inline-block",
            marginTop: 24,
            padding: "12px 18px",
            borderRadius: 10,
            background: "#2563eb",
            color: "#ffffff",
            textDecoration: "none",
            fontWeight: 800,
          }}
        >
          관리자 페이지로 이동
        </Link>
      </section>
    </main>
  );
}
