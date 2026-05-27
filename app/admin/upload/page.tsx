"use client";

import { useSession } from "next-auth/react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";

type Mode = "branches" | "merchants" | "orders";

interface ImportResult {
  ok: boolean;
  rowCount?: number;
  inserted?: number;
  created?: number;
  updated?: number;
  mapped?: number;
  skipped?: number;
  cancelled?: number;
  excluded?: number;
  results?: string[];
  message?: string;
}

const TABS: { id: Mode; label: string; desc: string; colHints: string[] }[] = [
  {
    id: "branches",
    label: "지사 & 지역 배정",
    desc: "지사명과 지역 정보를 등록합니다. 조직을 자동 생성하거나 기존 지사에 지역을 추가합니다.",
    colHints: ["지사명 / 지사 / name", "지역 / 대분류 / region", "중분류 (선택)"],
  },
  {
    id: "merchants",
    label: "가맹점 등록",
    desc: "가맹점 정보를 등록합니다. 주소를 파싱해 지사를 자동 매핑합니다.",
    colHints: ["가맹점명 / 교실명 / name", "주소 / address", "코드 / 조직코드 / code", "회원수 (선택)", "계약일 (선택)"],
  },
  {
    id: "orders",
    label: "주문 데이터",
    desc: "주문 원장 엑셀을 지정된 열 위치 기준으로 읽습니다. 개인정보 컬럼은 저장하지 않습니다.",
    colHints: [
      "B열 주문일",
      "F열 주문유형",
      "G열 신규여부",
      "J열 조직코드",
      "M열 학년",
      "O열 수량",
      "R열 취소여부",
    ],
  },
];

const S: Record<string, React.CSSProperties> = {
  page: { padding: 24, background: "#f8fafc", minHeight: "100vh" },
  card: { maxWidth: 1000, margin: "0 auto", background: "#fff", padding: 28, borderRadius: 20, boxShadow: "0 20px 60px rgba(15,23,42,0.08)" },
  h2: { margin: "0 0 20px", color: "#0f172a", fontSize: 20, fontWeight: 700 },
  tabs: { display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" },
  desc: { fontSize: 14, color: "#475569", marginBottom: 14 },
  hintRow: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 },
  hint: { fontSize: 12, color: "#64748b", background: "#f1f5f9", borderRadius: 6, padding: "4px 10px" },
  notice: { fontSize: 13, color: "#166534", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10, padding: "10px 12px", marginBottom: 18 },
  dropZone: {
    border: "2px dashed #cbd5e1",
    borderRadius: 14,
    padding: "36px 24px",
    textAlign: "center",
    cursor: "pointer",
    background: "#f8fafc",
    transition: "border-color 0.2s, background 0.2s",
  },
  dropZoneActive: { border: "2px dashed #2563eb", background: "#eff6ff" },
  dropLabel: { color: "#64748b", fontSize: 14 },
  dropSub: { color: "#94a3b8", fontSize: 12, marginTop: 4 },
  previewSection: { marginTop: 24 },
  previewHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  previewTitle: { fontWeight: 700, color: "#0f172a", fontSize: 15 },
  previewMeta: { fontSize: 12, color: "#64748b" },
  tableWrap: { overflowX: "auto", borderRadius: 10, border: "1px solid #e2e8f0" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { padding: "9px 12px", background: "#f8fafc", color: "#475569", fontWeight: 700, textAlign: "left", borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" },
  td: { padding: "8px 12px", color: "#0f172a", borderBottom: "1px solid #f1f5f9", whiteSpace: "nowrap", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" },
  btnRow: { display: "flex", gap: 10, marginTop: 20, alignItems: "center" },
  resultBox: { marginTop: 20, padding: 16, borderRadius: 12, border: "1px solid", fontSize: 13 },
  logList: { maxHeight: 280, overflowY: "auto", marginTop: 10, borderRadius: 8, border: "1px solid #e2e8f0" },
  logItem: { padding: "5px 10px", borderBottom: "1px solid #f1f5f9", fontSize: 12 },
};

function tabBtn(active: boolean): React.CSSProperties {
  return {
    padding: "9px 18px",
    borderRadius: 10,
    border: "none",
    cursor: "pointer",
    fontWeight: 600,
    fontSize: 14,
    background: active ? "#2563eb" : "#f1f5f9",
    color: active ? "#fff" : "#64748b",
  };
}

function btn(color: string, disabled = false): React.CSSProperties {
  return {
    padding: "11px 24px",
    borderRadius: 12,
    border: "none",
    background: disabled ? "#cbd5e1" : color,
    color: "#fff",
    cursor: disabled ? "not-allowed" : "pointer",
    fontWeight: 700,
    fontSize: 14,
  };
}

function parseWorkbookPreview(file: File, mode: Mode) {
  return file.arrayBuffer().then((buffer) => {
    const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (mode === "orders") {
      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
      const headers = ["B 주문일", "F 주문유형", "G 신규여부", "J 조직코드", "M 학년", "O 수량", "R 취소여부"];
      const previewRows = rows
        .filter((row) => row.some((cell) => String(cell ?? "").trim() !== ""))
        .slice(0, 8)
        .map((row) => ({
          "B 주문일": row[1],
          "F 주문유형": row[5],
          "G 신규여부": row[6],
          "J 조직코드": row[9],
          "M 학년": row[12],
          "O 수량": row[14],
          "R 취소여부": row[17],
        }));
      return { totalRows: rows.length, headers, previewRows };
    }

    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
    return {
      totalRows: rows.length,
      headers: rows.length ? Object.keys(rows[0]) : [],
      previewRows: rows.slice(0, 8),
    };
  });
}

export default function UploadPage() {
  const { status } = useSession();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<Mode>("branches");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [headers, setHeaders] = useState<string[]>([]);
  const [previewRows, setPreviewRows] = useState<Record<string, unknown>[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/auth/signin");
  }, [status, router]);

  function resetFile() {
    setFile(null);
    setHeaders([]);
    setPreviewRows([]);
    setTotalRows(0);
    setResult(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function changeTab(nextMode: Mode) {
    setMode(nextMode);
    resetFile();
  }

  async function parseFile(nextFile: File) {
    setResult(null);
    setFile(nextFile);
    const preview = await parseWorkbookPreview(nextFile, mode);
    setTotalRows(preview.totalRows);
    setHeaders(preview.headers);
    setPreviewRows(preview.previewRows);
  }

  function onFileInput(event: React.ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0];
    if (nextFile) parseFile(nextFile);
  }

  function onDrop(event: React.DragEvent) {
    event.preventDefault();
    setDragging(false);
    const nextFile = event.dataTransfer.files?.[0];
    if (nextFile && (nextFile.name.endsWith(".xlsx") || nextFile.name.endsWith(".xls"))) {
      parseFile(nextFile);
    }
  }

  async function register() {
    if (!file) return;
    setLoading(true);
    setResult(null);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("mode", mode);

    try {
      const response = await fetch("/api/import", { method: "POST", body: formData });
      const body: ImportResult = await response.json();
      setResult({ ...body, ok: response.ok && body.ok !== false });
    } catch {
      setResult({ ok: false, message: "네트워크 오류가 발생했습니다." });
    } finally {
      setLoading(false);
    }
  }

  if (status === "loading") return <div style={{ padding: 40 }}>Loading...</div>;

  const tab = TABS.find((item) => item.id === mode)!;
  const hasPreview = previewRows.length > 0;
  const success = result?.ok === true;

  return (
    <div style={S.page}>
      <div style={S.card}>
        <h2 style={S.h2}>데이터 등록</h2>

        <div style={S.tabs}>
          {TABS.map((item) => (
            <button key={item.id} type="button" style={tabBtn(mode === item.id)} onClick={() => changeTab(item.id)}>
              {item.label}
            </button>
          ))}
        </div>

        <p style={S.desc}>{tab.desc}</p>
        {mode === "orders" && (
          <div style={S.notice}>
            주문 데이터는 개인정보 보호를 위해 가맹교실명, 원장명, 학생명, 교재명, 원본 전체 row를 저장하지 않습니다.
            저장 항목은 조직코드, 주문일, 주문유형, 학년, 수량, 취소여부, 계산용 기본매출뿐입니다.
          </div>
        )}

        <div style={S.hintRow}>
          {tab.colHints.map((hint) => <span key={hint} style={S.hint}>{hint}</span>)}
        </div>

        <div
          style={{ ...S.dropZone, ...(dragging ? S.dropZoneActive : {}) }}
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <input ref={inputRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={onFileInput} />
          {file ? (
            <>
              <div style={{ color: "#2563eb", fontWeight: 700, fontSize: 15 }}>{file.name}</div>
              <div style={S.dropSub}>총 {totalRows.toLocaleString()}행 인식됨 · 다른 파일을 클릭해 교체</div>
            </>
          ) : (
            <>
              <div style={S.dropLabel}>엑셀 파일을 드래그하거나 클릭해서 선택</div>
              <div style={S.dropSub}>.xlsx / .xls 형식 지원</div>
            </>
          )}
        </div>

        {hasPreview && (
          <div style={S.previewSection}>
            <div style={S.previewHeader}>
              <span style={S.previewTitle}>미리보기</span>
              <span style={S.previewMeta}>상위 {previewRows.length}행 표시 / 전체 {totalRows.toLocaleString()}행</span>
            </div>
            <div style={S.tableWrap}>
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={{ ...S.th, color: "#94a3b8", width: 36, textAlign: "center" }}>#</th>
                    {headers.map((header) => <th key={header} style={S.th}>{header}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, index) => (
                    <tr key={index}>
                      <td style={{ ...S.td, color: "#94a3b8", textAlign: "center" }}>{index + 1}</td>
                      {headers.map((header) => (
                        <td key={header} style={S.td} title={String(row[header] ?? "")}>
                          {String(row[header] ?? "")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {!result && (
              <div style={S.btnRow}>
                <button type="button" style={btn("#2563eb", loading)} disabled={loading} onClick={register}>
                  {loading ? "등록 중..." : `등록 (${totalRows.toLocaleString()}행)`}
                </button>
                <button type="button" style={btn("#64748b")} onClick={resetFile}>취소</button>
              </div>
            )}
          </div>
        )}

        {result && (
          <div style={{
            ...S.resultBox,
            background: success ? "#f0fdf4" : "#fef2f2",
            borderColor: success ? "#bbf7d0" : "#fecaca",
            color: success ? "#14532d" : "#7f1d1d",
          }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>
              {success ? "등록 완료" : "오류"}: {result.message ?? ""}
            </div>

            {success && (
              <div style={{ display: "flex", gap: 20, flexWrap: "wrap", fontSize: 13, marginBottom: result.results?.length ? 10 : 0 }}>
                {result.rowCount !== undefined && <span>파일 행수 <strong>{result.rowCount}</strong></span>}
                {result.created !== undefined && <span>생성 <strong style={{ color: "#16a34a" }}>{result.created}</strong></span>}
                {result.updated !== undefined && <span>업데이트 <strong style={{ color: "#2563eb" }}>{result.updated}</strong></span>}
                {result.mapped !== undefined && <span>가맹점 매핑 <strong style={{ color: "#7c3aed" }}>{result.mapped}</strong></span>}
                {result.inserted !== undefined && <span>삽입 <strong style={{ color: "#0891b2" }}>{result.inserted}</strong></span>}
                {result.cancelled !== undefined && <span>취소건 <strong style={{ color: "#dc2626" }}>{result.cancelled}</strong></span>}
                {result.excluded !== undefined && <span>초도/영업교재 <strong style={{ color: "#b45309" }}>{result.excluded}</strong></span>}
                {result.skipped !== undefined && <span>건너뜀 <strong style={{ color: "#94a3b8" }}>{result.skipped}</strong></span>}
              </div>
            )}

            {result.results && result.results.length > 0 && (
              <div style={S.logList}>
                {result.results.map((log, index) => {
                  const isWarn = log.startsWith("[지사미매칭]") || log.startsWith("[주소파싱실패]") || log.startsWith("[건너뜀]");
                  const isGood = log.startsWith("[생성]") || log.startsWith("[가맹점등록]") || log.startsWith("[주문]") || log.startsWith("[지역추가]");
                  return (
                    <div key={index} style={{ ...S.logItem, color: isWarn ? "#b45309" : isGood ? "#15803d" : "#334155" }}>
                      {log}
                    </div>
                  );
                })}
              </div>
            )}

            <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
              <button type="button" style={btn("#2563eb")} onClick={resetFile}>새 파일 등록</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
