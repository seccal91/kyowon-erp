"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";

type Mode = "orders" | "merchants" | "branches";
type Step = "idle" | "previewing" | "preview" | "confirming" | "done";

interface PreviewRow {
  rowNum: number;
  key?: string;
  after: Record<string, unknown>;
}

interface ErrorRow {
  rowNum: number;
  reason: string;
  data: Record<string, unknown>;
}

interface PreviewData {
  filename: string;
  mode: Mode;
  total_rows: number;
  stats: { new: number; update: number; error: number; skip: number };
  new_rows: PreviewRow[];
  update_rows: unknown[];
  error_rows: ErrorRow[];
}

interface ConfirmResult {
  ok: boolean;
  total_rows: number;
  inserted: number;
  updated: number;
  errors: number;
  skipped: number;
}

interface HistoryRow {
  id: number;
  filename: string;
  mode: string;
  uploaded_at: string;
  total_rows: number;
  inserted: number;
  updated: number;
  errors: number;
  skipped: number;
}

const TABS: Record<Mode, { label: string; desc: string; columns: string[]; required: string[] }> = {
  orders: {
    label: "주문 데이터",
    desc: "주문 계산에 필요한 최소 정보만 저장합니다. 원본 엑셀 파일과 개인정보 컬럼은 저장하지 않습니다.",
    columns: ["조직코드", "주문일", "주문구분", "수량", "취소여부", "학년", "신규여부"],
    required: ["조직코드", "주문일", "주문구분", "수량"],
  },
  merchants: {
    label: "가맹점 등록",
    desc: "가맹점 코드, 교실명, 주소, 계약일만 사용합니다. 주소는 지역 배정을 위해서만 읽습니다.",
    columns: ["조직코드", "교실명", "주소", "계약일", "해지일자"],
    required: ["조직코드"],
  },
  branches: {
    label: "지사 & 지역",
    desc: "지사명과 지역 정보를 기준으로 지사를 등록하거나 지역을 추가합니다.",
    columns: ["지사명", "대분류", "중분류"],
    required: ["지사명"],
  },
};

const thStyle: React.CSSProperties = {
  padding: "9px 12px",
  background: "#f8fafc",
  color: "#475569",
  fontSize: 12,
  fontWeight: 800,
  borderBottom: "2px solid #e2e8f0",
  textAlign: "left",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "8px 12px",
  color: "#0f172a",
  fontSize: 12,
  borderBottom: "1px solid #f1f5f9",
  whiteSpace: "nowrap",
};

const cardStyle: React.CSSProperties = {
  background: "#ffffff",
  borderRadius: 12,
  boxShadow: "0 4px 24px rgba(15,23,42,0.07)",
  overflow: "hidden",
};

function Button({
  children,
  onClick,
  disabled,
  tone = "primary",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: "primary" | "dark" | "muted";
}) {
  const background = tone === "primary" ? "#2563eb" : tone === "dark" ? "#0f172a" : "#64748b";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        border: "none",
        borderRadius: 8,
        padding: "10px 16px",
        background: disabled ? "#cbd5e1" : background,
        color: "#ffffff",
        fontWeight: 800,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

function LoadingOverlay({ step, filename }: { step: Step; filename?: string }) {
  if (step !== "previewing" && step !== "confirming") return null;
  const title = step === "previewing" ? "파일을 분석하는 중입니다" : "데이터를 등록하는 중입니다";
  const detail =
    step === "previewing"
      ? "엑셀 행을 읽고 등록 대상과 오류 행을 나누고 있습니다."
      : "미리보기에서 확인한 데이터만 DB에 반영하고 있습니다.";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.48)",
        display: "grid",
        placeItems: "center",
        zIndex: 1000,
        padding: 24,
      }}
    >
      <div
        style={{
          width: "min(440px, 100%)",
          background: "#ffffff",
          borderRadius: 16,
          padding: "30px 28px",
          boxShadow: "0 24px 80px rgba(15,23,42,0.28)",
          textAlign: "center",
        }}
      >
        <style>{`
          @keyframes kyowon-fill {
            0% { width: 0%; }
            55% { width: 74%; }
            100% { width: 100%; }
          }
          @keyframes kyowon-pulse {
            0%, 100% { opacity: .58; transform: translateY(0); }
            50% { opacity: 1; transform: translateY(-1px); }
          }
        `}</style>
        <div style={{ position: "relative", display: "inline-block", marginBottom: 18 }}>
          <div
            style={{
              fontSize: 38,
              fontWeight: 900,
              letterSpacing: 1,
              color: "#dbeafe",
              lineHeight: 1,
            }}
          >
            KYOWON
          </div>
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              overflow: "hidden",
              whiteSpace: "nowrap",
              animation: "kyowon-fill 1.8s ease-in-out infinite",
            }}
          >
            <div
              style={{
                fontSize: 38,
                fontWeight: 900,
                letterSpacing: 1,
                color: "#2563eb",
                lineHeight: 1,
              }}
            >
              KYOWON
            </div>
          </div>
        </div>
        <div style={{ fontSize: 17, fontWeight: 900, color: "#0f172a", marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: 13, color: "#64748b", lineHeight: 1.6 }}>{detail}</div>
        {filename && (
          <div
            style={{
              marginTop: 14,
              padding: "8px 10px",
              borderRadius: 8,
              background: "#f8fafc",
              color: "#475569",
              fontSize: 12,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {filename}
          </div>
        )}
        <div style={{ marginTop: 18, color: "#2563eb", fontSize: 12, fontWeight: 800, animation: "kyowon-pulse 1.2s ease-in-out infinite" }}>
          대용량 파일은 시간이 조금 걸릴 수 있습니다. 창을 닫지 말아주세요.
        </div>
      </div>
    </div>
  );
}

function downloadTemplate(mode: Mode) {
  const rows =
    mode === "orders"
      ? [
          ["조직코드", "주문일", "주문구분", "수량", "취소여부", "학년", "신규여부"],
          ["A12345", "2026-04-01", "정규", 1, "", "초3", ""],
          ["A12345", "2026-04-02", "신규/복회", 1, "", "초4", "Y"],
          ["A12345", "2026-04-03", "정규", 1, "취소완료", "초3", ""],
        ]
      : mode === "merchants"
        ? [
            ["조직코드", "교실명", "주소", "계약일", "해지일자"],
            ["A12345", "서초교실", "서울특별시 서초구 ...", "2024-01-01", ""],
          ]
        : [
            ["지사명", "대분류", "중분류"],
            ["서부지사", "서울특별시", "서대문구"],
          ];

  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, "업로드양식");
  XLSX.writeFile(workbook, `${TABS[mode].label}_업로드양식.xlsx`);
}

function DataTable({ rows, type }: { rows: PreviewRow[] | ErrorRow[]; type: "new" | "error" }) {
  if (rows.length === 0) return <div style={{ padding: 18, color: "#94a3b8", fontSize: 13 }}>표시할 행이 없습니다.</div>;
  const sample = rows[0] as any;
  const keys = Object.keys(type === "error" ? sample.data ?? {} : sample.after ?? {});

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
        <thead>
          <tr>
            <th style={thStyle}>행</th>
            {type === "error" && <th style={thStyle}>오류 사유</th>}
            {keys.map((key) => (
              <th key={key} style={thStyle}>
                {key}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row: any) => {
            const data = type === "error" ? row.data : row.after;
            return (
              <tr key={row.rowNum}>
                <td style={{ ...tdStyle, color: "#64748b" }}>{row.rowNum}</td>
                {type === "error" && <td style={{ ...tdStyle, color: "#dc2626", fontWeight: 800 }}>{row.reason}</td>}
                {keys.map((key) => (
                  <td key={key} style={tdStyle}>
                    {String(data?.[key] ?? "")}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function HistoryTable({ rows }: { rows: HistoryRow[] }) {
  const modeLabel: Record<string, string> = { orders: "주문", merchants: "가맹점", branches: "지사" };
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {["일시", "파일명", "종류", "전체", "등록", "업데이트", "오류", "건너뜀"].map((header) => (
              <th key={header} style={thStyle}>
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={8} style={{ ...tdStyle, padding: 20, textAlign: "center", color: "#94a3b8" }}>
                업로드 이력이 없습니다.
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.id}>
                <td style={tdStyle}>{new Date(row.uploaded_at).toLocaleString("ko-KR")}</td>
                <td style={tdStyle}>{row.filename}</td>
                <td style={tdStyle}>{modeLabel[row.mode] ?? row.mode}</td>
                <td style={{ ...tdStyle, textAlign: "right" }}>{row.total_rows.toLocaleString()}</td>
                <td style={{ ...tdStyle, textAlign: "right", color: "#15803d", fontWeight: 800 }}>{row.inserted.toLocaleString()}</td>
                <td style={{ ...tdStyle, textAlign: "right", color: "#2563eb" }}>{row.updated.toLocaleString()}</td>
                <td style={{ ...tdStyle, textAlign: "right", color: row.errors ? "#dc2626" : "#94a3b8" }}>{row.errors.toLocaleString()}</td>
                <td style={{ ...tdStyle, textAlign: "right", color: "#94a3b8" }}>{row.skipped.toLocaleString()}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function UploadPage() {
  const { status } = useSession();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<Mode>("orders");
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<Step>("idle");
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [result, setResult] = useState<ConfirmResult | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/auth/signin");
  }, [router, status]);

  useEffect(() => {
    fetch("/api/upload/history")
      .then((res) => (res.ok ? res.json() : { history: [] }))
      .then((data) => setHistory(data.history ?? []))
      .catch(() => {});
  }, [result]);

  function reset(nextMode = mode) {
    setMode(nextMode);
    setFile(null);
    setStep("idle");
    setPreview(null);
    setResult(null);
    setMessage(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function analyze() {
    if (!file || step === "previewing" || step === "confirming") return;
    setStep("previewing");
    setMessage(null);

    const formData = new FormData();
    formData.append("mode", mode);
    formData.append("file", file);

    try {
      const res = await fetch("/api/upload/preview", { method: "POST", body: formData });
      const body = await res.json();
      if (!res.ok) {
        setMessage(body.message ?? "파일 분석에 실패했습니다.");
        setStep("idle");
        return;
      }
      setPreview(body);
      setStep("preview");
    } catch {
      setMessage("네트워크 오류가 발생했습니다.");
      setStep("idle");
    }
  }

  async function confirm() {
    if (!file || !preview || step === "confirming") return;
    setStep("confirming");
    setMessage(null);

    const formData = new FormData();
    formData.append("mode", mode);
    formData.append("file", file);

    try {
      const res = await fetch("/api/upload/confirm", { method: "POST", body: formData });
      const body = await res.json();
      if (!res.ok) {
        setMessage(body.message ?? "DB 반영에 실패했습니다.");
        setStep("preview");
        return;
      }
      setResult(body);
      setStep("done");
    } catch {
      setMessage("네트워크 오류가 발생했습니다.");
      setStep("preview");
    }
  }

  if (status === "loading") return <div style={{ padding: 40, color: "#0f172a" }}>Loading...</div>;

  const tab = TABS[mode];
  const busy = step === "previewing" || step === "confirming";
  const canConfirm = Boolean(preview && (preview.stats.new > 0 || preview.stats.update > 0));

  return (
    <div style={{ padding: "24px 28px", background: "#f1f5f9", minHeight: "100vh", color: "#0f172a" }}>
      <LoadingOverlay step={step} filename={file?.name} />
      <div style={{ maxWidth: 1200, margin: "0 auto", display: "grid", gap: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, color: "#0f172a" }}>데이터 등록</h2>
          <p style={{ margin: "6px 0 0", color: "#64748b", fontSize: 13 }}>
            엑셀을 분석한 뒤 미리보기에서 변경 내용을 확인하고 등록합니다.
          </p>
        </div>

        <section style={cardStyle}>
          <div style={{ display: "flex", borderBottom: "1px solid #e2e8f0", flexWrap: "wrap" }}>
            {(Object.keys(TABS) as Mode[]).map((tabKey) => (
              <button
                key={tabKey}
                type="button"
                onClick={() => reset(tabKey)}
                disabled={busy}
                style={{
                  padding: "13px 20px",
                  border: "none",
                  borderBottom: mode === tabKey ? "2px solid #2563eb" : "2px solid transparent",
                  background: "transparent",
                  color: mode === tabKey ? "#2563eb" : "#64748b",
                  fontWeight: mode === tabKey ? 800 : 600,
                  cursor: busy ? "not-allowed" : "pointer",
                }}
              >
                {TABS[tabKey].label}
              </button>
            ))}
          </div>

          <div style={{ padding: 20, display: "grid", gap: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontWeight: 800, marginBottom: 6 }}>{tab.label}</div>
                <div style={{ color: "#64748b", fontSize: 13 }}>{tab.desc}</div>
              </div>
              <Button tone="muted" onClick={() => downloadTemplate(mode)} disabled={busy}>
                양식 다운로드
              </Button>
            </div>

            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {tab.columns.map((column) => {
                const required = tab.required.includes(column);
                return (
                  <span
                    key={column}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 999,
                      border: required ? "1px solid #bfdbfe" : "1px solid #e2e8f0",
                      background: required ? "#eff6ff" : "#f8fafc",
                      color: required ? "#1d4ed8" : "#64748b",
                      fontSize: 12,
                      fontWeight: required ? 800 : 500,
                    }}
                  >
                    {column}
                    {required ? " 필수" : ""}
                  </span>
                );
              })}
            </div>

            <label
              style={{
                display: "block",
                border: "2px dashed #cbd5e1",
                borderRadius: 12,
                background: "#f8fafc",
                padding: "30px 20px",
                textAlign: "center",
                cursor: busy ? "not-allowed" : "pointer",
                opacity: busy ? 0.62 : 1,
              }}
            >
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.xls"
                disabled={busy}
                style={{ display: "none" }}
                onChange={(event) => {
                  const nextFile = event.target.files?.[0] ?? null;
                  if (!nextFile) return;
                  if (!nextFile.name.match(/\.(xlsx|xls)$/i)) {
                    setMessage("엑셀 파일(.xlsx/.xls)만 업로드할 수 있습니다.");
                    return;
                  }
                  setFile(nextFile);
                  setPreview(null);
                  setResult(null);
                  setStep("idle");
                  setMessage(null);
                }}
              />
              <div style={{ fontWeight: 800, color: file ? "#2563eb" : "#475569" }}>
                {file ? file.name : "엑셀 파일 선택"}
              </div>
              <div style={{ marginTop: 4, color: "#94a3b8", fontSize: 12 }}>
                파일은 서버에 보관하지 않고 필요한 컬럼만 추출합니다.
              </div>
            </label>

            {busy && (
              <div
                style={{
                  padding: "12px 14px",
                  borderRadius: 10,
                  background: "#eff6ff",
                  color: "#1d4ed8",
                  border: "1px solid #bfdbfe",
                  fontSize: 13,
                  fontWeight: 800,
                }}
              >
                {step === "previewing" ? "파일 분석 중입니다. 잠시만 기다려주세요." : "데이터 등록 중입니다. 완료될 때까지 기다려주세요."}
              </div>
            )}

            {message && (
              <div style={{ padding: "10px 14px", borderRadius: 8, background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca", fontSize: 13 }}>
                {message}
              </div>
            )}

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Button tone="dark" onClick={analyze} disabled={!file || busy}>
                {step === "previewing" ? "분석 중..." : "파일 분석"}
              </Button>
              {(step === "preview" || step === "confirming") && (
                <Button onClick={confirm} disabled={!canConfirm || busy}>
                  {step === "confirming" ? "등록 중..." : "확인 후 등록"}
                </Button>
              )}
              {(step === "preview" || step === "done") && (
                <Button tone="muted" onClick={() => reset()} disabled={busy}>
                  초기화
                </Button>
              )}
            </div>
          </div>
        </section>

        {preview && step !== "done" && (
          <div style={{ display: "grid", gap: 16 }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {[
                ["전체", preview.total_rows, "#64748b"],
                ["등록 대상", preview.stats.new, "#15803d"],
                ["업데이트", preview.stats.update, "#2563eb"],
                ["오류", preview.stats.error, "#dc2626"],
                ["변경없음", preview.stats.skip, "#94a3b8"],
              ].map(([label, value, color]) => (
                <div key={String(label)} style={{ padding: "10px 16px", borderRadius: 10, background: `${color}18` }}>
                  <b style={{ color: String(color), fontSize: 22 }}>{Number(value).toLocaleString()}</b>
                  <span style={{ marginLeft: 8, color: "#475569", fontSize: 13 }}>{label}</span>
                </div>
              ))}
            </div>

            <section style={cardStyle}>
              <div style={{ padding: "12px 18px", background: "#15803d", color: "#ffffff", fontWeight: 800 }}>
                신규 등록 대상 {preview.stats.new.toLocaleString()}건
              </div>
              <DataTable rows={preview.new_rows} type="new" />
            </section>

            {preview.error_rows.length > 0 && (
              <section style={cardStyle}>
                <div style={{ padding: "12px 18px", background: "#dc2626", color: "#ffffff", fontWeight: 800 }}>
                  오류 {preview.stats.error.toLocaleString()}건
                </div>
                <DataTable rows={preview.error_rows} type="error" />
              </section>
            )}
          </div>
        )}

        {step === "done" && result && (
          <section style={{ ...cardStyle, border: "1px solid #bbf7d0" }}>
            <div style={{ padding: "12px 18px", background: "#15803d", color: "#ffffff", fontWeight: 800 }}>등록 완료</div>
            <div style={{ padding: 20, display: "flex", gap: 16, flexWrap: "wrap" }}>
              <span>전체 {result.total_rows.toLocaleString()}건</span>
              <b style={{ color: "#15803d" }}>등록 {result.inserted.toLocaleString()}건</b>
              <b style={{ color: "#2563eb" }}>업데이트 {result.updated.toLocaleString()}건</b>
              <b style={{ color: result.errors ? "#dc2626" : "#64748b" }}>오류 {result.errors.toLocaleString()}건</b>
              <span style={{ color: "#64748b" }}>건너뜀 {result.skipped.toLocaleString()}건</span>
            </div>
          </section>
        )}

        <section style={cardStyle}>
          <div style={{ padding: "12px 18px", background: "#334155", color: "#ffffff", fontWeight: 800 }}>업로드 이력</div>
          <HistoryTable rows={history} />
        </section>
      </div>
    </div>
  );
}
