"use client";

import { FormEvent, useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type PayrollRow = {
  id: number;
  name: string;
  base: number;
  allowance: number;
  deduction: number;
};

type OrgNode = {
  id: number;
  name: string;
  children: OrgNode[];
};

const MONTHS = ["11월", "12월", "1월", "2월", "3월", "4월"];
const TEAM_DATA = [
  { name: "영업", values: [120, 135, 150, 145, 160, 170] },
  { name: "기술", values: [90, 100, 105, 115, 120, 130] },
  { name: "지원", values: [70, 80, 75, 85, 90, 95] },
];

export default function Home() {
  const [authenticated, setAuthenticated] = useState(false);
  const [accessKey, setAccessKey] = useState("");
  const [showError, setShowError] = useState(false);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [payrollRows, setPayrollRows] = useState<PayrollRow[]>([
    { id: 1, name: "김수학", base: 3000000, allowance: 300000, deduction: 150000 },
    { id: 2, name: "박철수", base: 2800000, allowance: 250000, deduction: 120000 },
  ]);
  const [showSummary, setShowSummary] = useState(false);
  const [orgTree, setOrgTree] = useState<OrgNode[]>([
    { id: 1, name: "사업단 A", children: [{ id: 11, name: "지사 A1", children: [] }, { id: 12, name: "지사 A2", children: [] }] },
    { id: 2, name: "사업단 B", children: [{ id: 21, name: "지사 B1", children: [] }] },
  ]);
  const [newOrgName, setNewOrgName] = useState("");
  const [newBranchUnitId, setNewBranchUnitId] = useState<number>(1);

  const chartData = useMemo(() => {
    const result = MONTHS.map((m, index) => {
      const row: any = { name: m };
      let total = 0;
      TEAM_DATA.forEach((team) => {
        row[team.name] = team.values[index];
        total += team.values[index];
      });
      row.total = total;
      return row;
    });
    return result;
  }, []);

  const payrollSummary = useMemo(() => {
    const total = payrollRows.length;
    const totalAllowance = payrollRows.reduce((a, r) => a + r.allowance, 0);
    const totalDeduction = payrollRows.reduce((a, r) => a + r.deduction, 0);
    const totalNet = payrollRows.reduce((a, r) => a + (r.base + r.allowance - r.deduction), 0);
    return { total, totalAllowance, totalDeduction, totalNet };
  }, [payrollRows]);

  const onAccessSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (accessKey.trim() === "4968602009") {
      setAuthenticated(true);
      setShowError(false);
    } else {
      setShowError(true);
    }
  };

  const updatePayrollField = (id: number, field: keyof PayrollRow, value: number) => {
    setPayrollRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, [field]: value } : row)),
    );
  };

  const removeRow = (id: number) => {
    setPayrollRows((prev) => prev.filter((row) => row.id !== id));
  };

  const addOrgUnit = () => {
    if (newOrgName.trim().length === 0) return;
    setOrgTree((prev) => [...prev, { id: Date.now(), name: newOrgName.trim(), children: [] }]);
    setNewOrgName("");
  };

  const addBranch = () => {
    if (newOrgName.trim().length === 0) return;
    setOrgTree((prev) =>
      prev.map((unit) =>
        unit.id === newBranchUnitId
          ? { ...unit, children: [...unit.children, { id: Date.now(), name: newOrgName.trim(), children: [] }] }
          : unit,
      ),
    );
    setNewOrgName("");
  };

  const removeOrgNode = (id: number) => {
    setOrgTree((prev) => prev.filter((node) => node.id !== id).map((node) => ({ ...node, children: node.children.filter((ch) => ch.id !== id) })));
  };

  if (!authenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-white via-slate-50 to-slate-100 px-4 py-14 font-pretendard text-gray-900">
        <div className="mx-auto w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 shadow-lg">
          <h1 className="mb-4 text-center text-2xl font-bold text-[#EF4444]">KYOWON ERP 보안 인증</h1>
          <form onSubmit={onAccessSubmit} className="space-y-4">
            <input
              value={accessKey}
              onChange={(e) => setAccessKey(e.target.value)}
              placeholder="Access Key 입력"
              className="w-full rounded-xl border border-gray-300 px-4 py-3 text-lg outline-none focus:border-[#EF4444] focus:ring-2 focus:ring-[#EF4444]/30"
            />
            <button className="w-full rounded-xl bg-[#EF4444] px-4 py-3 font-semibold text-white hover:bg-red-600">접속</button>
          </form>
          {showError && (
            <div className="mt-4 rounded-lg bg-red-100 p-3 text-sm text-red-700 shadow-inner">비밀번호 오류: 올바른 Access Key를 입력해주세요.</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 font-pretendard text-slate-800">
      <header className="sticky top-0 z-20 border-b border-gray-200 bg-white shadow-sm">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-4 text-sm">
          <button
            onClick={() => setActiveTab("dashboard")}
            className="text-xl font-extrabold tracking-tight text-[#EF4444] hover:text-red-600"
          >
            KYOWON ERP
          </button>
          <nav className="flex items-center gap-6">
            <div className="group relative">
              <button className="rounded-lg px-3 py-2 font-semibold text-slate-700 transition hover:bg-slate-100 hover:text-[#EF4444]">
                수학의 달인
              </button>
              <div className="invisible absolute left-0 top-full mt-2 w-40 rounded-md border border-gray-200 bg-white p-1 shadow-lg transition-opacity duration-150 group-hover:visible group-hover:opacity-100">
                <button className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100">통계관리</button>
                <button className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100">성과수수료</button>
              </div>
            </div>
            <button
              onClick={() => setActiveTab("dashboard")}
              className={`rounded-lg px-3 py-2 ${activeTab === "dashboard" ? "bg-[#EF4444] text-white" : "text-slate-600 hover:bg-slate-100"}`}
            >
              홈
            </button>
            <button
              onClick={() => setActiveTab("payroll")}
              className={`rounded-lg px-3 py-2 ${activeTab === "payroll" ? "bg-[#EF4444] text-white" : "text-slate-600 hover:bg-slate-100"}`}
            >
              급여 관리
            </button>
            <button
              onClick={() => setActiveTab("org")}
              className={`rounded-lg px-3 py-2 ${activeTab === "org" ? "bg-[#EF4444] text-white" : "text-slate-600 hover:bg-slate-100"}`}
            >
              조직 관리
            </button>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 py-6">
        {activeTab === "dashboard" && (
          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-2xl font-bold text-[#EF4444]">홈 대시보드</h2>
            <div className="h-[420px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                  <XAxis dataKey="name" stroke="#6B7280" />
                  <YAxis stroke="#6B7280" />
                  <Tooltip />
                  <Legend />
                  {TEAM_DATA.map((team) => (
                    <Bar key={team.name} dataKey={team.name} fill="#EF4444" radius={[4, 4, 0, 0]} />
                  ))}
                  <Line type="monotone" dataKey="total" stroke="#1D4ED8" strokeWidth={3} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </section>
        )}

        {activeTab === "payroll" && (
          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-2xl font-bold text-[#EF4444]">급여 관리</h2>
            <div className="overflow-auto">
              <table className="min-w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-slate-50 text-left">
                    <th className="px-3 py-2">-</th>
                    <th className="px-3 py-2">이름</th>
                    <th className="px-3 py-2">기본급</th>
                    <th className="px-3 py-2">수당</th>
                    <th className="px-3 py-2">공제</th>
                    <th className="px-3 py-2">실지급액</th>
                  </tr>
                </thead>
                <tbody>
                  {payrollRows.map((row) => {
                    const net = row.base + row.allowance - row.deduction;
                    return (
                      <tr key={row.id} className="border-b border-gray-100 hover:bg-slate-50">
                        <td className="px-3 py-2">
                          <button
                            onClick={() => removeRow(row.id)}
                            className="rounded-full bg-red-100 px-2 py-1 text-xs font-bold text-red-600 hover:bg-red-200"
                          >
                            -
                          </button>
                        </td>
                        <td className="px-3 py-2">{row.name}</td>
                        <td className="px-3 py-2">{row.base.toLocaleString()}원</td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            value={row.allowance}
                            onChange={(e) => updatePayrollField(row.id, "allowance", Number(e.target.value))}
                            className="w-24 rounded-md border border-gray-300 px-2 py-1"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            value={row.deduction}
                            onChange={(e) => updatePayrollField(row.id, "deduction", Number(e.target.value))}
                            className="w-24 rounded-md border border-gray-300 px-2 py-1"
                          />
                        </td>
                        <td className="px-3 py-2 font-semibold text-[#EF4444]">{net.toLocaleString()}원</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex items-center justify-between">
              <button
                onClick={() => setPayrollRows((prev) => [...prev, { id: Date.now(), name: `신규${prev.length + 1}`, base: 2500000, allowance: 0, deduction: 0 }])}
                className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200"
              >
                행 추가
              </button>
              <button
                onClick={() => setShowSummary(true)}
                className="rounded-lg bg-[#EF4444] px-5 py-2 text-sm font-semibold text-white hover:bg-red-600"
              >
                일괄 발송
              </button>
            </div>
          </section>
        )}

        {activeTab === "org" && (
          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-2xl font-bold text-[#EF4444]">조직 관리</h2>
            <div className="flex flex-col gap-3 md:flex-row md:items-end">
              <div className="flex-auto">
                <label className="mb-1 block text-sm font-medium text-slate-600">사업단/지사 이름</label>
                <input
                  value={newOrgName}
                  onChange={(e) => setNewOrgName(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 focus:border-[#EF4444] focus:ring-[#EF4444]/30"
                  placeholder="추가할 이름 입력"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-600">지사 추가 대상 사업단</label>
                <select
                  value={newBranchUnitId}
                  onChange={(e) => setNewBranchUnitId(Number(e.target.value))}
                  className="rounded-md border border-gray-300 px-3 py-2"
                >
                  {orgTree.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={addOrgUnit}
                  className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200"
                >
                  사업단 추가
                </button>
                <button
                  onClick={addBranch}
                  className="rounded-lg bg-[#EF4444] px-4 py-2 text-sm font-semibold text-white hover:bg-red-600"
                >
                  지사 추가
                </button>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              {orgTree.map((unit) => (
                <div key={unit.id} className="rounded-xl border border-gray-200 bg-slate-50 p-3">
                  <div className="flex items-center justify-between">
                    <strong>{unit.name}</strong>
                    <button
                      onClick={() => removeOrgNode(unit.id)}
                      className="rounded px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-100"
                    >
                      삭제
                    </button>
                  </div>
                  <ul className="mt-2 space-y-1 pl-4">
                    {unit.children.map((branch) => (
                      <li key={branch.id} className="flex items-center justify-between rounded-md bg-white p-2 shadow-sm">
                        <span>{branch.name}</span>
                        <button
                          onClick={() => removeOrgNode(branch.id)}
                          className="rounded px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-100"
                        >
                          삭제
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      {showSummary && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl border border-red-200 bg-white p-6 shadow-xl">
            <h3 className="mb-3 text-xl font-bold text-[#EF4444]">일괄 발송 요약</h3>
            <p className="text-sm text-slate-600">총 발송 인원: {payrollSummary.total}명</p>
            <p className="text-sm text-slate-600">총 수당: {payrollSummary.totalAllowance.toLocaleString()}원</p>
            <p className="text-sm text-slate-600">총 공제: {payrollSummary.totalDeduction.toLocaleString()}원</p>
            <p className="mb-4 text-sm font-semibold text-slate-800">총 실지급: {payrollSummary.totalNet.toLocaleString()}원</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowSummary(false)}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                취소
              </button>
              <button
                onClick={() => {
                  setShowSummary(false);
                  alert("일괄 발송이 완료되었습니다. (시뮬레이션)");
                }}
                className="rounded-lg bg-[#EF4444] px-4 py-2 text-sm font-semibold text-white hover:bg-red-600"
              >
                최종 발송
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
