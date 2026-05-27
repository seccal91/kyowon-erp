"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import * as XLSX from "xlsx";

type Order = {
  merchant_code: string;
  year: number;
  month: number;
  product_counts: Record<string, number>;
  total_quantity: number;
};

export default function OrdersUploadPage() {
  const { status } = useSession();
  const router = useRouter();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());

  useEffect(() => {
    if (status === "unauthenticated") router.push("/auth/signin");
  }, [status, router]);

  useEffect(() => {
    if (status === "authenticated") fetchOrders();
  }, [status, selectedYear]);

  async function fetchOrders() {
    setLoading(true);
    try {
      const res = await fetch(`/api/orders/upload?year=${selectedYear}`);
      const data = await res.json();
      setOrders(data.orders || []);
    } catch (error) {
      console.error(error);
      setMessage("주문 데이터 로드 실패");
    } finally {
      setLoading(false);
    }
  }

  async function handleFileUpload(file: File) {
    setUploading(true);
    setMessage(null);
    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const data = e.target?.result as ArrayBuffer;
          const workbook = XLSX.read(data, { type: "array" });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(sheet);

          const res = await fetch("/api/orders/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orders: rows }),
          });

          const result = await res.json();
          if (res.ok) {
            setMessage(
              `✓ ${result.inserted}개 반영됨${result.failed > 0 ? ` / ${result.failed}개 실패` : ""}`
            );
            if (result.failedDetails?.length > 0) {
              console.log("실패한 항목:", result.failedDetails);
            }
            fetchOrders();
          } else {
            setMessage(result.message || "업로드 실패");
          }
        } catch (err) {
          setMessage("파일 처리 중 오류: " + String(err));
        } finally {
          setUploading(false);
        }
      };
      reader.readAsArrayBuffer(file);
    } catch (error) {
      setMessage("파일 읽기 실패");
      setUploading(false);
    }
  }

  const yearOptions = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i);
  const filteredOrders = orders.sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    if (a.month !== b.month) return b.month - a.month;
    return a.merchant_code.localeCompare(b.merchant_code);
  });

  if (status === "loading" || loading)
    return <div style={{ padding: 24, color: "#0f172a" }}>Loading...</div>;

  return (
    <div style={{ padding: 24, background: "#f8fafc", minHeight: "100vh", color: "#0f172a" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto", display: "grid", gap: 24 }}>
        {/* 헤더 */}
        <section
          style={{
            background: "#ffffff",
            borderRadius: 20,
            padding: 24,
            boxShadow: "0 20px 60px rgba(15,23,42,0.08)",
          }}
        >
          <h2 style={{ margin: 0, color: "#0f172a" }}>주문 데이터 관리</h2>
          <p style={{ marginTop: 8, color: "#64748b" }}>
            가맹점의 월별 주문 데이터를 업로드하고 상품종류별 판매 현황을 관리합니다.
          </p>
        </section>

        {/* 파일 업로드 */}
        <section
          style={{
            background: "#ffffff",
            borderRadius: 20,
            padding: 24,
            boxShadow: "0 20px 60px rgba(15,23,42,0.08)",
          }}
        >
          <h3 style={{ marginTop: 0, color: "#0f172a" }}>파일 업로드</h3>

          <div style={{ padding: 18, background: "#eff6ff", borderRadius: 12, marginBottom: 16 }}>
            <div style={{ fontWeight: 600, color: "#1d4ed8", marginBottom: 8 }}>업로드 형식</div>
            <div style={{ color: "#1e40af", fontSize: 13, lineHeight: 1.6 }}>
              • 파일: Excel (.xlsx)
              <br />
              • 컬럼: 날짜, 코드, 상품종류, 수량, 취소여부(선택), 학년(선택)
              <br />
              • 상품종류: 영업교재, 정규, 초도, 신규
              <br />
              • 취소여부: Y (취소) 또는 N (정상, 기본값)
              <br />
              • 날짜 형식: YYYY-MM-DD 또는 YYYY/MM/DD
              <br />
              • 같은 날짜/코드의 주문은 상품별 수량으로 집계됩니다.
            </div>
          </div>

          <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
            <label
              style={{
                padding: "12px 20px",
                borderRadius: 10,
                border: "2px dashed #cbd5e1",
                background: "#f8fafc",
                color: "#0f172a",
                cursor: "pointer",
                fontWeight: 600,
                display: "inline-block",
              }}
            >
              파일 선택
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileUpload(file);
                }}
                style={{ display: "none" }}
                disabled={uploading}
              />
            </label>
            {uploading && <span style={{ color: "#64748b" }}>업로드 중...</span>}
          </div>

          {message && (
            <div
              style={{
                padding: 12,
                borderRadius: 10,
                background: message.includes("✓") ? "#ecfdf5" : "#fef2f2",
                color: message.includes("✓") ? "#047857" : "#dc2626",
                marginBottom: 16,
              }}
            >
              {message}
            </div>
          )}
        </section>

        {/* 주문 데이터 현황 */}
        <section
          style={{
            background: "#ffffff",
            borderRadius: 20,
            padding: 24,
            boxShadow: "0 20px 60px rgba(15,23,42,0.08)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3 style={{ margin: 0, color: "#0f172a" }}>주문 현황</h3>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(parseInt(e.target.value))}
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid #cbd5e1",
                backgroundColor: "#ffffff",
                color: "#0f172a",
                fontWeight: 600,
              }}
            >
              {yearOptions.map((year) => (
                <option key={year} value={year}>
                  {year}년
                </option>
              ))}
            </select>
          </div>

          {filteredOrders.length === 0 ? (
            <div style={{ color: "#64748b", padding: 24, textAlign: "center" }}>
              등록된 주문이 없습니다.
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
                <thead>
                  <tr style={{ background: "#f1f5f9", color: "#0f172a", fontWeight: 700 }}>
                    <th style={{ padding: 12, borderBottom: "1px solid #e2e8f0", textAlign: "left" }}>
                      코드
                    </th>
                    <th style={{ padding: 12, borderBottom: "1px solid #e2e8f0", textAlign: "center" }}>
                      년/월
                    </th>
                    <th style={{ padding: 12, borderBottom: "1px solid #e2e8f0", textAlign: "right" }}>
                      영업교재
                    </th>
                    <th style={{ padding: 12, borderBottom: "1px solid #e2e8f0", textAlign: "right" }}>
                      정규
                    </th>
                    <th style={{ padding: 12, borderBottom: "1px solid #e2e8f0", textAlign: "right" }}>
                      초도
                    </th>
                    <th style={{ padding: 12, borderBottom: "1px solid #e2e8f0", textAlign: "right" }}>
                      신규
                    </th>
                    <th style={{ padding: 12, borderBottom: "1px solid #e2e8f0", textAlign: "right" }}>
                      합계
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map((order, idx) => (
                    <tr key={idx} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: 12 }}>
                        <strong style={{ color: "#0f172a" }}>{order.merchant_code}</strong>
                      </td>
                      <td style={{ padding: 12, textAlign: "center", color: "#64748b", fontSize: 13 }}>
                        {order.year}/{String(order.month).padStart(2, "0")}
                      </td>
                      <td style={{ padding: 12, textAlign: "right", color: "#0f172a", fontWeight: 500 }}>
                        {order.product_counts["영업교재"] || 0}
                      </td>
                      <td style={{ padding: 12, textAlign: "right", color: "#0f172a", fontWeight: 500 }}>
                        {order.product_counts["정규"] || 0}
                      </td>
                      <td style={{ padding: 12, textAlign: "right", color: "#0f172a", fontWeight: 500 }}>
                        {order.product_counts["초도"] || 0}
                      </td>
                      <td style={{ padding: 12, textAlign: "right", color: "#0f172a", fontWeight: 500 }}>
                        {order.product_counts["신규"] || 0}
                      </td>
                      <td
                        style={{
                          padding: 12,
                          textAlign: "right",
                          color: "#ffffff",
                          fontWeight: 700,
                          background: "#3b82f6",
                          borderRadius: 6,
                        }}
                      >
                        {order.total_quantity}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
