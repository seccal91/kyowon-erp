"use client";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// ─── Types ────────────────────────────────────────────────────────────────────

type Mode = "merchants" | "orders" | "branches";
type Step = "idle" | "previewing" | "preview" | "confirming" | "done";

interface PreviewRow { rowNum: number; key?: string; after: Record<string, any>; }
interface UpdateRow { rowNum: number; key: string; before: Record<string, any>; after: Record<string, any>; changes: Record<string, { from: any; to: any }>; }
interface ErrorRow { rowNum: number; reason: string; data: Record<string, any>; }

interface PreviewData {
  filename: string;
  mode: Mode;
  total_rows: number;
  stats: { new: number; update: number; error: number; skip: number };
  new_rows: PreviewRow[];
  update_rows: UpdateRow[];
  error_rows: ErrorRow[];
}

interface HistoryRow {
  id: number; filename: string; mode: string; uploaded_at: string;
  uploaded_by: string; total_rows: number; inserted: number;
  updated: number; errors: number; skipped: number;
}

interface ConfirmResult {
  ok: boolean; total_rows: number;
  inserted: number; updated: number; errors: number; skipped: number;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const TABS: { id: Mode; label: string; desc: string; required: string[]; hints: string[] }[] = [
  {
    id: "merchants",
    label: "가맹점 등록",
    desc: "가맹점 정보를 등록하거나 업데이트합니다.",
    required: ["조직코드"],
    hints: ["조직코드 ★", "교실명 ★(신규)", "주소", "계약일", "해지일자"],
  },
  {
    id: "orders",
    label: "주문 데이터",
    desc: "주문 행 데이터를 등록합니다. 헤더명으로 컬럼을 인식합니다.",
    required: ["가맹교실ID", "주문일", "수량"],
    hints: ["가맹교실ID ★", "주문일 ★", "수량 ★", "주문구분", "신규여부", "학년", "취소여부"],
  },
  {
    id: "branches",
    label: "지사 & 지역",
    desc: "지사를 등록하거나 지역을 추가합니다.",
    required: ["지사명"],
    hints: ["지사명 ★", "지역(대분류)", "중분류"],
  },
];

// ─── Styles ───────────────────────────────────────────────────────────────────

const S = {
  page: { padding: "24px 28px", background: "#f1f5f9", minHeight: "100vh" } as React.CSSProperties,
  card: { background: "#fff", borderRadius: 16, boxShadow: "0 4px 24px rgba(15,23,42,0.07)", overflow: "hidden" } as React.CSSProperties,
  cardHead: (color: string) => ({ padding: "14px 20px", background: color, fontWeight: 800, fontSize: 15, color: "#fff" } as React.CSSProperties),
  cardBody: { padding: 20 } as React.CSSProperties,
  th: { padding: "9px 12px", background: "#f8fafc", fontSize: 12, fontWeight: 700, color: "#475569", textAlign: "left" as const, borderBottom: "2px solid #e2e8f0", whiteSpace: "nowrap" as const },
  td: { padding: "8px 12px", fontSize: 12, color: "#0f172a", borderBottom: "1px solid #f1f5f9", whiteSpace: "nowrap" as const },
};

function Btn({ label, color, onClick, disabled, size = "md" }: { label: string; color: string; onClick?: () => void; disabled?: boolean; size?: "sm" | "md" }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: size === "sm" ? "7px 16px" : "11px 24px",
        borderRadius: 10, border: "none", fontWeight: 700,
        fontSize: size === "sm" ? 13 : 14, cursor: disabled ? "not-allowed" : "pointer",
        background: disabled ? "#cbd5e1" : color, color: "#fff",
      }}
    >
      {label}
    </button>
  );
}

function StatBadge({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", borderRadius: 10, background: color + "18", border: `1px solid ${color}30` }}>
      <span style={{ fontSize: 22, fontWeight: 800, color }}>{value.toLocaleString()}</span>
      <span style={{ fontSize: 13, color: "#475569" }}>{label}</span>
    </div>
  );
}

// ─── Diff Cell ────────────────────────────────────────────────────────────────
function DiffCell({ from, to }: { from: any; to: any }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {from !== undefined && from !== null && from !== "" && (
        <span style={{ fontSize: 11, color: "#dc2626", textDecoration: "line-through" }}>{String(from)}</span>
      )}
      <span style={{ fontSize: 12, color: "#15803d", fontWeight: 600 }}>{String(to ?? "")}</span>
    </div>
  );
}

// ─── Preview Tables ───────────────────────────────────────────────────────────

function NewTable({ rows, mode }: { rows: PreviewRow[]; mode: Mode }) {
  if (!rows.length) return <p style={{ color: "#94a3b8", fontSize: 13 }}>없음</p>;
  const keys = Object.keys(rows[0]?.after ?? {});
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 500 }}>
        <thead>
          <tr>
            <th style={S.th}>행</th>
            {mode !== "orders" && <th style={S.th}>코드/이름</th>}
            {keys.map(k => <th key={k} style={S.th}>{k}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.rowNum}>
              <td style={{ ...S.td, color: "#94a3b8" }}>{r.rowNum}</td>
              {mode !== "orders" && <td style={{ ...S.td, fontWeight: 600 }}>{r.key}</td>}
              {keys.map(k => <td key={k} style={S.td}>{String(r.after[k] ?? "")}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UpdateTable({ rows }: { rows: UpdateRow[] }) {
  if (!rows.length) return <p style={{ color: "#94a3b8", fontSize: 13 }}>없음</p>;
  const changeKeys = [...new Set(rows.flatMap(r => Object.keys(r.changes)))];
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 500 }}>
        <thead>
          <tr>
            <th style={S.th}>행</th>
            <th style={S.th}>코드/이름</th>
            {changeKeys.map(k => <th key={k} style={{ ...S.th, background: "#fef9c3" }}>{k}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.rowNum}>
              <td style={{ ...S.td, color: "#94a3b8" }}>{r.rowNum}</td>
              <td style={{ ...S.td, fontWeight: 600 }}>{r.key}</td>
              {changeKeys.map(k => (
                <td key={k} style={{ ...S.td, background: r.changes[k] ? "#fef9c330" : undefined }}>
                  {r.changes[k]
                    ? <DiffCell from={r.changes[k].from} to={r.changes[k].to} />
                    : <span style={{ color: "#94a3b8" }}>—</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ErrorTable({ rows }: { rows: ErrorRow[] }) {
  if (!rows.length) return <p style={{ color: "#94a3b8", fontSize: 13 }}>없음</p>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 400 }}>
        <thead>
          <tr>
            <th style={S.th}>행</th>
            <th style={S.th}>오류 사유</th>
            <th style={S.th}>데이터</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.rowNum}>
              <td style={{ ...S.td, color: "#94a3b8" }}>{r.rowNum}</td>
              <td style={{ ...S.td, color: "#dc2626", fontWeight: 600 }}>{r.reason}</td>
              <td style={{ ...S.td, color: "#64748b", maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis" }}>
                {Object.entries(r.data).slice(0, 4).map(([k, v]) => `${k}: ${v}`).join(" | ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── History Table ────────────────────────────────────────────────────────────
function HistoryTable({ rows }: { rows: HistoryRow[] }) {
  const modeLabel: Record<string, string> = { merchants: "가맹점", orders: "주문", branches: "지사" };
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {["업로드 일시", "파일명", "종류", "전체", "신규", "업데이트", "오류", "건너뜀"].map(h => (
              <th key={h} style={S.th}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={8} style={{ ...S.td, textAlign: "center", color: "#94a3b8", padding: 24 }}>업로드 이력 없음</td></tr>
          )}
          {rows.map(r => (
            <tr key={r.id}>
              <td style={{ ...S.td, color: "#64748b" }}>{new Date(r.uploaded_at).toLocaleString("ko-KR")}</td>
              <td style={{ ...S.td, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>{r.filename}</td>
              <td style={S.td}>{modeLabel[r.mode] ?? r.mode}</td>
              <td style={{ ...S.td, textAlign: "right" }}>{r.total_rows.toLocaleString()}</td>
              <td style={{ ...S.td, textAlign: "right", color: "#15803d", fontWeight: 600 }}>{r.inserted.toLocaleString()}</td>
              <td style={{ ...S.td, textAlign: "right", color: "#2563eb" }}>{r.updated.toLocaleString()}</td>
              <td style={{ ...S.td, textAlign: "right", color: r.errors > 0 ? "#dc2626" : "#94a3b8" }}>{r.errors.toLocaleString()}</td>
              <td style={{ ...S.td, textAlign: "right", color: "#94a3b8" }}>{r.skipped.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function UploadPage() {
  const { status } = useSession();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<Mode>("merchants");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [step, setStep] = useState<Step>("idle");
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [confirmResult, setConfirmResult] = useState<ConfirmResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);

  useEffect(() => { if (status === "unauthenticated") router.push("/auth/signin"); }, [status, router]);
  useEffect(() => { fetchHistory(); }, []);

  async function fetchHistory() {
    try {
      const r = await fetch("/api/upload/history");
      if (r.ok) setHistory((await r.json()).history ?? []);
    } catch {}
  }

  function reset() {
    setFile(null); setStep("idle"); setPreview(null);
    setConfirmResult(null); setErrorMsg(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function changeMode(m: Mode) { setMode(m); reset(); }

  function onFile(f: File) {
    if (!f.name.match(/\.(xlsx|xls)$/i)) { setErrorMsg("Excel 파일(.xlsx/.xls)만 허용됩니다."); return; }
    setFile(f); setStep("idle"); setPreview(null); setConfirmResult(null); setErrorMsg(null);
  }

  async function handlePreview() {
    if (!file) return;
    setStep("previewing"); setErrorMsg(null);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("mode", mode);
    try {
      const res = await fetch("/api/upload/preview", { method: "POST", body: fd });
      const body = await res.json();
      if (!res.ok) { setErrorMsg(body.message ?? "오류 발생"); setStep("idle"); return; }
      setPreview(body);
      setStep("preview");
    } catch (e) {
      setErrorMsg("네트워크 오류"); setStep("idle");
    }
  }

  async function handleConfirm() {
    if (!file) return;
    setStep("confirming"); setErrorMsg(null);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("mode", mode);
    try {
      const res = await fetch("/api/upload/confirm", { method: "POST", body: fd });
      const body = await res.json();
      if (!res.ok) { setErrorMsg(body.message ?? "오류 발생"); setStep("preview"); return; }
      setConfirmResult(body);
      setStep("done");
      fetchHistory();
    } catch {
      setErrorMsg("네트워크 오류"); setStep("preview");
    }
  }

  const tab = TABS.find(t => t.id === mode)!;

  if (status === "loading") return <div style={{ padding: 40 }}>Loading...</div>;

  return (
    <div style={S.page}>
      <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", flexDirection: "column", gap: 20 }}>

        {/* Header */}
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#0f172a" }}>데이터 등록</h2>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "#64748b" }}>
            파일 분석 후 미리보기에서 변경사항을 확인하고 반영합니다.
          </p>
        </div>

        {/* Mode tabs + File zone */}
        <div style={S.card}>
          {/* Tabs */}
          <div style={{ display: "flex", borderBottom: "1px solid #e2e8f0" }}>
            {TABS.map(t => (
              <button key={t.id} onClick={() => changeMode(t.id)} style={{
                padding: "13px 20px", border: "none", cursor: "pointer",
                fontWeight: mode === t.id ? 700 : 500, fontSize: 14,
                background: "transparent",
                color: mode === t.id ? "#2563eb" : "#64748b",
                borderBottom: mode === t.id ? "2px solid #2563eb" : "2px solid transparent",
              }}>
                {t.label}
              </button>
            ))}
          </div>

          <div style={S.cardBody}>
            <p style={{ margin: "0 0 12px", fontSize: 13, color: "#475569" }}>{tab.desc}</p>

            {/* Column hints */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
              {tab.hints.map(h => (
                <span key={h} style={{
                  fontSize: 12, padding: "4px 10px", borderRadius: 6,
                  background: h.includes("★") ? "#eff6ff" : "#f8fafc",
                  color: h.includes("★") ? "#2563eb" : "#64748b",
                  border: h.includes("★") ? "1px solid #bfdbfe" : "1px solid #e2e8f0",
                  fontWeight: h.includes("★") ? 700 : 400,
                }}>
                  {h}
                </span>
              ))}
            </div>

            {/* Drop zone */}
            <div
              onClick={() => inputRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
              style={{
                border: `2px dashed ${dragging ? "#2563eb" : "#cbd5e1"}`,
                borderRadius: 12, padding: "32px 24px", textAlign: "center",
                cursor: "pointer", background: dragging ? "#eff6ff" : "#f8fafc",
                transition: "all 0.2s",
              }}
            >
              <input ref={inputRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }}
                onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
              {file ? (
                <>
                  <div style={{ color: "#2563eb", fontWeight: 700, fontSize: 15 }}>{file.name}</div>
                  <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>다른 파일 선택 시 클릭</div>
                </>
              ) : (
                <>
                  <div style={{ color: "#64748b", fontSize: 14 }}>엑셀 파일을 드래그하거나 클릭하여 선택</div>
                  <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 4 }}>.xlsx / .xls</div>
                </>
              )}
            </div>

            {errorMsg && (
              <div style={{ marginTop: 12, padding: "10px 14px", borderRadius: 8, background: "#fef2f2", border: "1px solid #fecaca", color: "#dc2626", fontSize: 13 }}>
                {errorMsg}
              </div>
            )}

            {/* Action buttons */}
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              {(step === "idle" || step === "previewing" || step === "preview") && (
                <Btn label={step === "previewing" ? "분석 중..." : "파일 분석"} color="#0f172a"
                  disabled={!file || step === "previewing"} onClick={handlePreview} />
              )}
              {(step === "preview" || step === "confirming") && preview && (
                <Btn
                  label={step === "confirming" ? "반영 중..." : `확인 및 반영 (신규 ${preview.stats.new} / 업데이트 ${preview.stats.update})`}
                  color="#2563eb"
                  disabled={step === "confirming" || (preview.stats.new === 0 && preview.stats.update === 0)}
                  onClick={handleConfirm}
                />
              )}
              {(step === "preview" || step === "done") && (
                <Btn label="초기화" color="#64748b" size="sm" onClick={reset} />
              )}
            </div>
          </div>
        </div>

        {/* Preview */}
        {step === "preview" && preview && (
          <>
            {/* Stats */}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <StatBadge label="전체 행" value={preview.total_rows} color="#64748b" />
              <StatBadge label="신규 등록" value={preview.stats.new} color="#15803d" />
              <StatBadge label="업데이트" value={preview.stats.update} color="#2563eb" />
              <StatBadge label="오류" value={preview.stats.error} color="#dc2626" />
              <StatBadge label="변경없음" value={preview.stats.skip} color="#94a3b8" />
            </div>

            {/* New rows */}
            {preview.stats.new > 0 && (
              <div style={S.card}>
                <div style={S.cardHead("#15803d")}>
                  신규 등록 대상 ({preview.stats.new.toLocaleString()}건
                  {preview.stats.new > 200 ? " — 상위 200행 표시" : ""})
                </div>
                <div style={S.cardBody}><NewTable rows={preview.new_rows} mode={mode} /></div>
              </div>
            )}

            {/* Update rows */}
            {preview.stats.update > 0 && (
              <div style={S.card}>
                <div style={S.cardHead("#2563eb")}>
                  업데이트 대상 ({preview.stats.update.toLocaleString()}건
                  {preview.stats.update > 200 ? " — 상위 200행 표시" : ""})
                </div>
                <div style={S.cardBody}><UpdateTable rows={preview.update_rows} /></div>
              </div>
            )}

            {/* Error rows */}
            {preview.stats.error > 0 && (
              <div style={S.card}>
                <div style={S.cardHead("#dc2626")}>
                  오류 ({preview.stats.error.toLocaleString()}건
                  {preview.stats.error > 200 ? " — 상위 200행 표시" : ""})
                </div>
                <div style={S.cardBody}><ErrorTable rows={preview.error_rows} /></div>
              </div>
            )}
          </>
        )}

        {/* Done */}
        {step === "done" && confirmResult && (
          <div style={{ ...S.card, border: "1px solid #bbf7d0" }}>
            <div style={S.cardHead("#15803d")}>반영 완료</div>
            <div style={{ ...S.cardBody, display: "flex", gap: 16, flexWrap: "wrap" }}>
              <StatBadge label="전체" value={confirmResult.total_rows} color="#64748b" />
              <StatBadge label="신규 등록" value={confirmResult.inserted} color="#15803d" />
              <StatBadge label="업데이트" value={confirmResult.updated} color="#2563eb" />
              <StatBadge label="오류" value={confirmResult.errors} color="#dc2626" />
              <StatBadge label="건너뜀" value={confirmResult.skipped} color="#94a3b8" />
            </div>
          </div>
        )}

        {/* Upload history */}
        <div style={S.card}>
          <div style={S.cardHead("#334155")}>업로드 이력 (최근 50건)</div>
          <div style={S.cardBody}>
            <HistoryTable rows={history} />
          </div>
        </div>
      </div>
    </div>
  );
}
