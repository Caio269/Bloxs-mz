import { useState, useEffect, FormEvent } from "react";
import {
  ref, get, set, update, runTransaction,
} from "firebase/database";
import { rtdb, isMockMode } from "../firebase";

// ── Password ──────────────────────────────────────────────────────────────────
const ADMIN_PASSWORD = "Bloxs@Admin2025";
const STORAGE_KEY = "bloxs_mz_users";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Transaction {
  id: string;
  type: "credit" | "debit";
  amount: number;
  description: string;
  date: string;
}

interface Withdrawal {
  id: string;
  amount: number;
  fee: number;
  net: number;
  method: "M-Pesa" | "e-Mola";
  phone: string;
  status: "pendente" | "processado" | "rejeitado";
  date: string;
}

interface Deposit {
  id: string;
  amount: number;
  method: "M-Pesa" | "e-Mola";
  txId: string;
  status: "pendente" | "confirmado" | "rejeitado";
  date: string;
  approvedAt?: string;
}

interface ClientRecord {
  uid: string;
  id: string;
  name: string;
  email: string;
  phone: string;
  balance: number;
  transactions: Transaction[];
  deposits: Deposit[];
  withdrawals: Withdrawal[];
  planos: Record<string, { ativo: boolean; ultimaColeta: string | null }>;
}

interface PendingDeposit {
  userEmail: string;
  userName: string;
  userId: string;
  userUid: string;
  deposit: Deposit;
  depositFirebaseKey: string;
}

interface PendingWithdrawal {
  userEmail: string;
  userName: string;
  userId: string;
  userUid: string;
  withdrawal: Withdrawal;
  withdrawalFirebaseKey: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function loadLocalUsers(): Record<string, { email: string; name: string; id: string; balance: number; deposits: Deposit[]; transactions: Transaction[]; withdrawals: Withdrawal[] }> {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch { return {}; }
}

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("pt-MZ", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}

function fmtMT(n: number) {
  return n.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " MT";
}

// ── Sub-components ────────────────────────────────────────────────────────────
function Toast({ msg }: { msg: string }) {
  return (
    <div className="toast-container">
      <div className="toast">{msg}</div>
    </div>
  );
}

function FilterBtn({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      padding: "6px 14px", borderRadius: 20, border: "none", cursor: "pointer",
      fontSize: 12, fontWeight: 600, transition: "all 0.15s",
      background: active ? "#a3e635" : "rgba(255,255,255,0.07)",
      color: active ? "#0b0f19" : "rgba(255,255,255,0.5)",
    }}>{label}</button>
  );
}

function StatusBadge({ status, type }: { status: string; type: "deposit" | "withdrawal" }) {
  const map: Record<string, { bg: string; color: string; border: string; label: string }> = {
    pendente:   { bg: "rgba(250,204,21,0.15)",  color: "#facc15", border: "rgba(250,204,21,0.3)",  label: "⏳ Pendente" },
    rejeitado:  { bg: "rgba(239,68,68,0.12)",   color: "#f87171", border: "rgba(239,68,68,0.3)",   label: "❌ Rejeitado" },
    confirmado: { bg: "rgba(163,230,53,0.12)",  color: "#a3e635", border: "rgba(163,230,53,0.25)", label: "✅ Confirmado" },
    processado: { bg: "rgba(163,230,53,0.12)",  color: "#a3e635", border: "rgba(163,230,53,0.25)", label: "✅ Processado" },
  };
  const s = map[status] ?? map["pendente"];
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20,
      background: s.bg, color: s.color, border: `1px solid ${s.border}`,
    }}>{s.label}</span>
  );
}

// ── CLIENT DETAIL VIEW ────────────────────────────────────────────────────────
function ClientDetail({ client, onBack }: { client: ClientRecord; onBack: () => void }) {
  const [txFilter, setTxFilter] = useState<"all" | "credit" | "debit">("all");

  const filtered = client.transactions
    .filter(t => txFilter === "all" || t.type === txFilter)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const totalCredits = client.transactions.filter(t => t.type === "credit").reduce((s, t) => s + t.amount, 0);
  const totalDebits = client.transactions.filter(t => t.type === "debit").reduce((s, t) => s + t.amount, 0);

  const planoAtivo = Object.entries(client.planos ?? {}).filter(([, v]) => v.ativo).map(([k]) => k.toUpperCase()).join(", ") || "Nenhum";

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Back header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "16px 16px 12px", borderBottom: "1px solid rgba(163,230,53,0.1)",
        flexShrink: 0,
      }}>
        <button onClick={onBack} style={{
          background: "rgba(255,255,255,0.07)", border: "none", borderRadius: 10,
          padding: "8px 14px", cursor: "pointer", color: "rgba(255,255,255,0.7)",
          fontSize: 13, fontWeight: 600,
        }}>← Voltar</button>
        <div>
          <p style={{ fontSize: 15, fontWeight: 700 }}>{client.name}</p>
          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{client.email} · #{client.id}</p>
        </div>
      </div>

      <div className="scrollable" style={{ flex: 1, padding: "16px" }}>
        {/* Balance Card */}
        <div style={{
          background: "linear-gradient(135deg, rgba(163,230,53,0.12) 0%, rgba(11,15,25,0.9) 100%)",
          border: "1px solid rgba(163,230,53,0.25)", borderRadius: 20, padding: "20px 20px 16px", marginBottom: 14,
        }}>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", marginBottom: 6 }}>💰 Saldo Atual</p>
          <p style={{ fontSize: 36, fontWeight: 800, letterSpacing: "-1px", color: "#a3e635" }}>
            {fmtMT(client.balance)}
          </p>
          <div style={{ display: "flex", gap: 16, marginTop: 14 }}>
            <div style={{ flex: 1, background: "rgba(163,230,53,0.07)", borderRadius: 10, padding: "10px 12px" }}>
              <p style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 4 }}>Total Créditos</p>
              <p style={{ fontSize: 14, fontWeight: 700, color: "#a3e635" }}>+{fmtMT(totalCredits)}</p>
            </div>
            <div style={{ flex: 1, background: "rgba(239,68,68,0.07)", borderRadius: 10, padding: "10px 12px" }}>
              <p style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 4 }}>Total Débitos</p>
              <p style={{ fontSize: 14, fontWeight: 700, color: "#f87171" }}>-{fmtMT(totalDebits)}</p>
            </div>
          </div>
        </div>

        {/* Info row */}
        <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
          <div className="glass-card" style={{ flex: 1, padding: "12px", textAlign: "center" }}>
            <p style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 4 }}>Planos Ativos</p>
            <p style={{ fontSize: 13, fontWeight: 700, color: "#facc15" }}>{planoAtivo}</p>
          </div>
          <div className="glass-card" style={{ flex: 1, padding: "12px", textAlign: "center" }}>
            <p style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 4 }}>Depósitos</p>
            <p style={{ fontSize: 13, fontWeight: 700 }}>{client.deposits?.length ?? 0}</p>
          </div>
          <div className="glass-card" style={{ flex: 1, padding: "12px", textAlign: "center" }}>
            <p style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 4 }}>Levantamentos</p>
            <p style={{ fontSize: 13, fontWeight: 700 }}>{client.withdrawals?.length ?? 0}</p>
          </div>
        </div>

        {/* Transaction history */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <p style={{ fontSize: 14, fontWeight: 700 }}>📋 Histórico de Transações</p>
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>{filtered.length} reg.</span>
          </div>

          {/* Filter chips */}
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            {(["all", "credit", "debit"] as const).map(f => (
              <FilterBtn key={f} active={txFilter === f} label={f === "all" ? "Todas" : f === "credit" ? "Créditos" : "Débitos"} onClick={() => setTxFilter(f)} />
            ))}
          </div>

          {filtered.length === 0 ? (
            <div style={{ textAlign: "center", padding: "32px", color: "rgba(255,255,255,0.25)", fontSize: 13 }}>
              Nenhuma transação encontrada.
            </div>
          ) : (
            filtered.map(tx => (
              <div key={tx.id} className="glass-card" style={{ padding: "14px 16px", marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ flex: 1, marginRight: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 16 }}>{tx.type === "credit" ? "📥" : "📤"}</span>
                      <p style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.85)" }}>{tx.description}</p>
                    </div>
                    <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>{fmtDate(tx.date)}</p>
                    <p style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", marginTop: 2 }}>ID: {tx.id}</p>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <p style={{
                      fontSize: 16, fontWeight: 800,
                      color: tx.type === "credit" ? "#a3e635" : "#f87171",
                    }}>
                      {tx.type === "credit" ? "+" : "-"}{fmtMT(tx.amount)}
                    </p>
                    <span style={{
                      fontSize: 10, fontWeight: 600,
                      padding: "2px 8px", borderRadius: 12,
                      background: tx.type === "credit" ? "rgba(163,230,53,0.1)" : "rgba(239,68,68,0.1)",
                      color: tx.type === "credit" ? "#a3e635" : "#f87171",
                      border: `1px solid ${tx.type === "credit" ? "rgba(163,230,53,0.2)" : "rgba(239,68,68,0.2)"}`,
                    }}>{tx.type === "credit" ? "crédito" : "débito"}</span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Deposits section */}
        {(client.deposits?.length ?? 0) > 0 && (
          <div style={{ marginBottom: 8 }}>
            <p style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>💳 Depósitos</p>
            {[...client.deposits].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map(d => (
              <div key={d.id} className="glass-card" style={{ padding: "12px 16px", marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <p style={{ fontSize: 13, fontWeight: 700 }}>{fmtMT(d.amount)} via {d.method}</p>
                    <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>{fmtDate(d.date)}</p>
                    <p style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", marginTop: 2 }}>TxID: {d.txId}</p>
                  </div>
                  <StatusBadge status={d.status} type="deposit" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Withdrawals section */}
        {(client.withdrawals?.length ?? 0) > 0 && (
          <div style={{ marginBottom: 24 }}>
            <p style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>🏧 Levantamentos</p>
            {[...client.withdrawals].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map(w => (
              <div key={w.id} className="glass-card" style={{ padding: "12px 16px", marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <p style={{ fontSize: 13, fontWeight: 700 }}>{fmtMT(w.net)} líquido via {w.method}</p>
                    <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>{fmtDate(w.date)} · {w.phone}</p>
                    <p style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", marginTop: 2 }}>Bruto: {fmtMT(w.amount)} · Taxa: {fmtMT(w.fee)}</p>
                  </div>
                  <StatusBadge status={w.status} type="withdrawal" />
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ height: 24 }} />
      </div>
    </div>
  );
}

// ── CLIENTS TAB ───────────────────────────────────────────────────────────────
function ClientesTab() {
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ClientRecord | null>(null);

  useEffect(() => { loadClients(); }, []);

  async function loadClients() {
    setLoading(true);
    try {
      const list: ClientRecord[] = [];

      if (!isMockMode) {
        const snap = await get(ref(rtdb, "usuarios"));
        if (snap.exists()) {
          const data = snap.val() as Record<string, Record<string, unknown>>;
          Object.entries(data).forEach(([uid, raw]) => {
            const txObj = raw.transacoes as Record<string, Transaction> | null;
            const depObj = raw.depositos as Record<string, Deposit> | null;
            const lvObj = raw.levantamentos as Record<string, Withdrawal> | null;
            const plObj = raw.planos as Record<string, { ativo: boolean; ultimaColeta: string | null }> | null;
            list.push({
              uid,
              id: (raw.id as string) ?? uid.slice(0, 9).toUpperCase(),
              name: (raw.nome as string) ?? "Utilizador",
              email: (raw.email as string) ?? uid,
              phone: (raw.telefone as string) ?? "",
              balance: Number(raw.saldo ?? 0),
              transactions: txObj ? Object.values(txObj) : [],
              deposits: depObj ? Object.values(depObj) : [],
              withdrawals: lvObj ? Object.values(lvObj) : [],
              planos: plObj ?? {},
            });
          });
        }
      } else {
        const users = loadLocalUsers();
        Object.values(users).forEach(u => {
          list.push({
            uid: u.email,
            id: u.id,
            name: u.name,
            email: u.email,
            phone: "",
            balance: u.balance,
            transactions: u.transactions ?? [],
            deposits: u.deposits ?? [],
            withdrawals: u.withdrawals ?? [],
            planos: {},
          });
        });
      }

      list.sort((a, b) => a.name.localeCompare(b.name));
      setClients(list);
    } catch (err) {
      console.error("Erro ao carregar clientes:", err);
    } finally {
      setLoading(false);
    }
  }

  if (selected) {
    return <ClientDetail client={selected} onBack={() => setSelected(null)} />;
  }

  const filtered = clients.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.email.toLowerCase().includes(search.toLowerCase()) ||
    c.id.toLowerCase().includes(search.toLowerCase())
  );

  const totalBalance = clients.reduce((s, c) => s + c.balance, 0);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "12px 16px 0", flexShrink: 0 }}>
        {/* Summary */}
        <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
          <div className="glass-card" style={{ flex: 1, padding: "12px", textAlign: "center" }}>
            <p style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 4 }}>Total Clientes</p>
            <p style={{ fontSize: 22, fontWeight: 800, color: "#a3e635" }}>{clients.length}</p>
          </div>
          <div className="glass-card" style={{ flex: 1, padding: "12px", textAlign: "center" }}>
            <p style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 4 }}>Saldo Total</p>
            <p style={{ fontSize: 14, fontWeight: 800, color: "#facc15" }}>{fmtMT(totalBalance)}</p>
          </div>
        </div>

        {/* Search */}
        <input
          className="bloxs-input"
          style={{ marginBottom: 12, fontSize: 13 }}
          placeholder="🔍  Pesquisar por nome, email ou ID..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>
            {filtered.length} cliente{filtered.length !== 1 ? "s" : ""}
          </p>
          <button onClick={loadClients} style={{
            background: "transparent", border: "1px solid rgba(163,230,53,0.2)",
            borderRadius: 8, padding: "4px 12px", cursor: "pointer",
            color: "#a3e635", fontSize: 11, fontWeight: 600,
          }}>↻ Actualizar</button>
        </div>
      </div>

      <div className="scrollable" style={{ flex: 1, padding: "0 16px 16px" }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: "40px", color: "rgba(255,255,255,0.3)", fontSize: 13 }}>
            A carregar clientes...
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px", color: "rgba(255,255,255,0.25)", fontSize: 13 }}>
            {search ? "Nenhum resultado para a pesquisa." : "Ainda não há clientes registados."}
          </div>
        ) : (
          filtered.map(client => {
            const hasPendingDeposit = client.deposits.some(d => d.status === "pendente");
            return (
              <button key={client.uid} onClick={() => setSelected(client)} style={{
                width: "100%", background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(163,230,53,0.1)", borderRadius: 14,
                padding: "14px 16px", marginBottom: 8, cursor: "pointer",
                display: "flex", alignItems: "center", gap: 14, textAlign: "left",
                transition: "all 0.15s",
              }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = "rgba(163,230,53,0.3)")}
                onMouseLeave={e => (e.currentTarget.style.borderColor = "rgba(163,230,53,0.1)")}
              >
                {/* Avatar */}
                <div style={{
                  width: 42, height: 42, borderRadius: 12, flexShrink: 0,
                  background: "linear-gradient(135deg, rgba(163,230,53,0.2), rgba(163,230,53,0.06))",
                  border: "1px solid rgba(163,230,53,0.2)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 18, fontWeight: 800, color: "#a3e635",
                }}>
                  {client.name.charAt(0).toUpperCase()}
                </div>
                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                    <p style={{ fontSize: 14, fontWeight: 700, color: "white", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {client.name}
                    </p>
                    {hasPendingDeposit && (
                      <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 10, background: "rgba(250,204,21,0.15)", color: "#facc15", border: "1px solid rgba(250,204,21,0.3)", flexShrink: 0 }}>
                        DEP. PENDENTE
                      </span>
                    )}
                  </div>
                  <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {client.email}
                  </p>
                  <p style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", marginTop: 2 }}>
                    #{client.id} · {client.transactions.length} transações
                  </p>
                </div>
                {/* Balance */}
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <p style={{ fontSize: 15, fontWeight: 800, color: "#a3e635" }}>{fmtMT(client.balance)}</p>
                  <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>→</p>
                </div>
              </button>
            );
          })
        )}
        <div style={{ height: 16 }} />
      </div>
    </div>
  );
}

// ── DEPOSITS TAB ──────────────────────────────────────────────────────────────
function DepositosTab() {
  const [pendingList, setPendingList] = useState<PendingDeposit[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<"pending" | "all">("pending");
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [toast, setToast] = useState("");

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(""), 3500); }

  useEffect(() => { loadDeposits(); }, [activeFilter]);

  async function loadDeposits() {
    setLoading(true);
    try {
      const list: PendingDeposit[] = [];
      if (!isMockMode) {
        const snap = await get(ref(rtdb, "usuarios"));
        if (snap.exists()) {
          const data = snap.val() as Record<string, Record<string, unknown>>;
          Object.entries(data).forEach(([uid, raw]) => {
            const nome = (raw.nome as string) ?? "Utilizador";
            const email = (raw.email as string) ?? uid;
            const id = (raw.id as string) ?? uid.slice(0, 9).toUpperCase();
            const depObj = raw.depositos as Record<string, Deposit> | null;
            if (depObj) {
              Object.entries(depObj).forEach(([fbKey, d]) => {
                const match = activeFilter === "pending" ? d.status === "pendente" : true;
                if (match) list.push({ userEmail: email, userName: nome, userId: id, userUid: uid, deposit: d, depositFirebaseKey: fbKey });
              });
            }
          });
        }
      } else {
        const users = loadLocalUsers();
        Object.values(users).forEach(u => {
          (u.deposits ?? []).forEach(d => {
            const match = activeFilter === "pending" ? d.status === "pendente" : true;
            if (match) list.push({ userEmail: u.email, userName: u.name, userId: u.id, userUid: "", deposit: d, depositFirebaseKey: d.id });
          });
        });
      }
      list.sort((a, b) => new Date(b.deposit.date).getTime() - new Date(a.deposit.date).getTime());
      setPendingList(list);
    } catch { showToast("Erro ao carregar depósitos."); }
    finally { setLoading(false); }
  }

  async function approveDeposit(item: PendingDeposit) {
    if (processingId) return;
    setProcessingId(item.deposit.id);
    const approvedAt = new Date().toISOString();
    const amount = Number(item.deposit.amount || 0);
    const txId = `dep_${item.deposit.id}_${Date.now()}`;
    const newTx: Transaction = { id: txId, type: "credit", amount, description: `Depósito aprovado via ${item.deposit.method}`, date: approvedAt };
    try {
      if (!isMockMode && item.userUid) {
        const depSnap = await get(ref(rtdb, `usuarios/${item.userUid}/depositos/${item.depositFirebaseKey}`));
        if (!depSnap.exists()) { showToast("⚠️ Depósito não encontrado."); return; }
        if ((depSnap.val() as Deposit).status === "confirmado") { showToast("Já foi aprovado."); return; }
        await Promise.all([
          update(ref(rtdb, `usuarios/${item.userUid}/depositos/${item.depositFirebaseKey}`), { status: "confirmado", approvedAt }),
          set(ref(rtdb, `usuarios/${item.userUid}/transacoes/${txId}`), newTx),
        ]);
        await runTransaction(ref(rtdb, `usuarios/${item.userUid}/saldo`), (cur) => Number(cur || 0) + amount);
      }
      setPendingList(prev =>
        activeFilter === "pending"
          ? prev.filter(p => p.deposit.id !== item.deposit.id)
          : prev.map(p => p.deposit.id === item.deposit.id ? { ...p, deposit: { ...p.deposit, status: "confirmado" as const, approvedAt } } : p)
      );
      showToast(`✅ ${fmtMT(amount)} aprovados e creditados!`);
    } catch { showToast("❌ Erro ao aprovar. Verifique a ligação."); }
    finally { setProcessingId(null); }
  }

  async function rejectDeposit(item: PendingDeposit) {
    if (processingId) return;
    setProcessingId(item.deposit.id);
    try {
      if (!isMockMode && item.userUid) {
        const depSnap = await get(ref(rtdb, `usuarios/${item.userUid}/depositos/${item.depositFirebaseKey}`));
        if (depSnap.exists() && (depSnap.val() as Deposit).status === "pendente") {
          await update(ref(rtdb, `usuarios/${item.userUid}/depositos/${item.depositFirebaseKey}`), { status: "rejeitado", rejectedAt: new Date().toISOString() });
        }
      }
      setPendingList(prev =>
        activeFilter === "pending"
          ? prev.filter(p => p.deposit.id !== item.deposit.id)
          : prev.map(p => p.deposit.id === item.deposit.id ? { ...p, deposit: { ...p.deposit, status: "rejeitado" as const } } : p)
      );
      showToast("❌ Depósito rejeitado.");
    } catch { showToast("❌ Erro ao rejeitar."); }
    finally { setProcessingId(null); }
  }

  const pendingCount = pendingList.filter(p => p.deposit.status === "pendente").length;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {toast && <Toast msg={toast} />}
      <div style={{ padding: "12px 16px 0", flexShrink: 0 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <FilterBtn active={activeFilter === "pending"} label={`Pendentes${pendingCount > 0 ? ` (${pendingCount})` : ""}`} onClick={() => setActiveFilter("pending")} />
          <FilterBtn active={activeFilter === "all"} label="Todos" onClick={() => setActiveFilter("all")} />
        </div>
      </div>
      <div className="scrollable" style={{ flex: 1, padding: "0 16px 16px" }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: "40px", color: "rgba(255,255,255,0.3)", fontSize: 13 }}>A carregar...</div>
        ) : pendingList.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px", color: "rgba(255,255,255,0.25)", fontSize: 13 }}>
            {activeFilter === "pending" ? "✅ Não há depósitos pendentes." : "Nenhum depósito encontrado."}
          </div>
        ) : (
          pendingList.map(item => (
            <div key={`${item.userUid}-${item.deposit.id}`} className="glass-card" style={{ padding: "16px", marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                <div>
                  <p style={{ fontSize: 14, fontWeight: 700 }}>{item.userName}</p>
                  <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{item.userEmail} · #{item.userId}</p>
                </div>
                <StatusBadge status={item.deposit.status} type="deposit" />
              </div>
              <div style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>💰 <b style={{ color: "#a3e635" }}>{fmtMT(item.deposit.amount)}</b></span>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>📱 {item.deposit.method}</span>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>🕒 {fmtDate(item.deposit.date)}</span>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>ID: {item.deposit.txId}</span>
              </div>
              {item.deposit.status === "pendente" && (
                <div style={{ display: "flex", gap: 10 }}>
                  <button onClick={() => approveDeposit(item)} disabled={!!processingId}
                    style={{ flex: 1, padding: "10px", borderRadius: 10, border: "none", cursor: processingId ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 13, background: "rgba(163,230,53,0.15)", color: "#a3e635" }}>
                    {processingId === item.deposit.id ? "A processar..." : "✅ Aprovar"}
                  </button>
                  <button onClick={() => rejectDeposit(item)} disabled={!!processingId}
                    style={{ flex: 1, padding: "10px", borderRadius: 10, border: "none", cursor: processingId ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 13, background: "rgba(239,68,68,0.12)", color: "#f87171" }}>
                    ❌ Rejeitar
                  </button>
                </div>
              )}
            </div>
          ))
        )}
        <div style={{ height: 16 }} />
      </div>
    </div>
  );
}

// ── WITHDRAWALS TAB ───────────────────────────────────────────────────────────
function LevantamentosTab() {
  const [list, setList] = useState<PendingWithdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [toast, setToast] = useState("");

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(""), 3500); }

  useEffect(() => { loadWithdrawals(); }, [filter]);

  async function loadWithdrawals() {
    setLoading(true);
    try {
      const wlist: PendingWithdrawal[] = [];
      if (!isMockMode) {
        const snap = await get(ref(rtdb, "usuarios"));
        if (snap.exists()) {
          const data = snap.val() as Record<string, Record<string, unknown>>;
          Object.entries(data).forEach(([uid, raw]) => {
            const nome = (raw.nome as string) ?? "Utilizador";
            const email = (raw.email as string) ?? uid;
            const id = (raw.id as string) ?? uid.slice(0, 9).toUpperCase();
            const lvObj = raw.levantamentos as Record<string, Withdrawal> | null;
            if (lvObj) {
              Object.entries(lvObj).forEach(([fbKey, w]) => {
                const match = filter === "pending" ? w.status === "pendente" : true;
                if (match) wlist.push({ userEmail: email, userName: nome, userId: id, userUid: uid, withdrawal: w, withdrawalFirebaseKey: fbKey });
              });
            }
          });
        }
      }
      wlist.sort((a, b) => new Date(b.withdrawal.date).getTime() - new Date(a.withdrawal.date).getTime());
      setList(wlist);
    } catch { showToast("Erro ao carregar levantamentos."); }
    finally { setLoading(false); }
  }

  async function approveWithdrawal(item: PendingWithdrawal) {
    if (processingId) return;
    setProcessingId(item.withdrawal.id);
    try {
      if (!isMockMode && item.userUid) {
        const snap = await get(ref(rtdb, `usuarios/${item.userUid}/levantamentos/${item.withdrawalFirebaseKey}`));
        if (!snap.exists() || (snap.val() as Withdrawal).status !== "pendente") { showToast("Já processado."); return; }
        await update(ref(rtdb, `usuarios/${item.userUid}/levantamentos/${item.withdrawalFirebaseKey}`), { status: "processado", processedAt: new Date().toISOString() });
      }
      setList(prev => filter === "pending" ? prev.filter(p => p.withdrawal.id !== item.withdrawal.id) : prev.map(p => p.withdrawal.id === item.withdrawal.id ? { ...p, withdrawal: { ...p.withdrawal, status: "processado" as const } } : p));
      showToast(`✅ ${fmtMT(item.withdrawal.net)} marcado como processado!`);
    } catch { showToast("❌ Erro ao processar."); }
    finally { setProcessingId(null); }
  }

  async function rejectWithdrawal(item: PendingWithdrawal) {
    if (processingId) return;
    setProcessingId(item.withdrawal.id);
    try {
      if (!isMockMode && item.userUid) {
        const snap = await get(ref(rtdb, `usuarios/${item.userUid}/levantamentos/${item.withdrawalFirebaseKey}`));
        if (!snap.exists() || (snap.val() as Withdrawal).status !== "pendente") { showToast("Já processado."); return; }
        await Promise.all([
          update(ref(rtdb, `usuarios/${item.userUid}/levantamentos/${item.withdrawalFirebaseKey}`), { status: "rejeitado", rejectedAt: new Date().toISOString() }),
          runTransaction(ref(rtdb, `usuarios/${item.userUid}/saldo`), (cur) => Number(cur || 0) + item.withdrawal.amount),
        ]);
      }
      setList(prev => filter === "pending" ? prev.filter(p => p.withdrawal.id !== item.withdrawal.id) : prev.map(p => p.withdrawal.id === item.withdrawal.id ? { ...p, withdrawal: { ...p.withdrawal, status: "rejeitado" as const } } : p));
      showToast(`↩️ Rejeitado. ${fmtMT(item.withdrawal.amount)} devolvidos.`);
    } catch { showToast("❌ Erro ao rejeitar."); }
    finally { setProcessingId(null); }
  }

  const pendingCount = list.filter(w => w.withdrawal.status === "pendente").length;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {toast && <Toast msg={toast} />}
      <div style={{ padding: "12px 16px 0", flexShrink: 0 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <FilterBtn active={filter === "pending"} label={`Pendentes${pendingCount > 0 ? ` (${pendingCount})` : ""}`} onClick={() => setFilter("pending")} />
          <FilterBtn active={filter === "all"} label="Todos" onClick={() => setFilter("all")} />
        </div>
      </div>
      <div className="scrollable" style={{ flex: 1, padding: "0 16px 16px" }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: "40px", color: "rgba(255,255,255,0.3)", fontSize: 13 }}>A carregar...</div>
        ) : list.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px", color: "rgba(255,255,255,0.25)", fontSize: 13 }}>
            {filter === "pending" ? "✅ Não há levantamentos pendentes." : "Nenhum levantamento encontrado."}
          </div>
        ) : (
          list.map(item => (
            <div key={`${item.userUid}-${item.withdrawal.id}`} className="glass-card" style={{ padding: "16px", marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                <div>
                  <p style={{ fontSize: 14, fontWeight: 700 }}>{item.userName}</p>
                  <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{item.userEmail} · #{item.userId}</p>
                </div>
                <StatusBadge status={item.withdrawal.status} type="withdrawal" />
              </div>
              <div style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>💸 Líquido: <b style={{ color: "#a3e635" }}>{fmtMT(item.withdrawal.net)}</b></span>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>📱 {item.withdrawal.method} · {item.withdrawal.phone}</span>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>🕒 {fmtDate(item.withdrawal.date)}</span>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>Taxa: {fmtMT(item.withdrawal.fee)}</span>
              </div>
              {item.withdrawal.status === "pendente" && (
                <div style={{ display: "flex", gap: 10 }}>
                  <button onClick={() => approveWithdrawal(item)} disabled={!!processingId}
                    style={{ flex: 1, padding: "10px", borderRadius: 10, border: "none", cursor: processingId ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 13, background: "rgba(163,230,53,0.15)", color: "#a3e635" }}>
                    {processingId === item.withdrawal.id ? "A processar..." : "✅ Processar"}
                  </button>
                  <button onClick={() => rejectWithdrawal(item)} disabled={!!processingId}
                    style={{ flex: 1, padding: "10px", borderRadius: 10, border: "none", cursor: processingId ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 13, background: "rgba(239,68,68,0.12)", color: "#f87171" }}>
                    ↩️ Rejeitar
                  </button>
                </div>
              )}
            </div>
          ))
        )}
        <div style={{ height: 16 }} />
      </div>
    </div>
  );
}

// ── MAIN COMPONENT ────────────────────────────────────────────────────────────
type AdminTab = "clientes" | "depositos" | "levantamentos";

export default function AdminDashboard({ onClose }: { onClose: () => void }) {
  const [authed, setAuthed] = useState(false);
  const [pwd, setPwd] = useState("");
  const [pwdError, setPwdError] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [tab, setTab] = useState<AdminTab>("clientes");

  function handleLogin(e: FormEvent) {
    e.preventDefault();
    if (pwd === ADMIN_PASSWORD) {
      setAuthed(true);
      setPwdError("");
    } else {
      setPwdError("Senha incorreta. Tente novamente.");
      setPwd("");
    }
  }

  // ── Password gate ──
  if (!authed) {
    return (
      <div className="app-shell" style={{ background: "#0b0f19" }}>
        <div className="top-header">
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.07)", border: "none", borderRadius: 10, padding: "8px 14px", cursor: "pointer", color: "rgba(255,255,255,0.7)", fontSize: 13, fontWeight: 600 }}>
            ← Voltar
          </button>
          <span style={{ fontWeight: 700, fontSize: 15 }}>Área Restrita</span>
          <span style={{ width: 70 }} />
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 24px" }}>
          <div style={{
            width: 72, height: 72, borderRadius: 20, marginBottom: 20,
            background: "linear-gradient(135deg, rgba(163,230,53,0.15), rgba(163,230,53,0.05))",
            border: "1px solid rgba(163,230,53,0.25)",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32,
          }}>🔐</div>
          <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>Painel de Administrador</h2>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginBottom: 32, textAlign: "center", lineHeight: 1.6 }}>
            Acesso restrito ao administrador.<br />Introduza a senha para continuar.
          </p>

          <form onSubmit={handleLogin} style={{ width: "100%", maxWidth: 320 }}>
            <div style={{ position: "relative", marginBottom: 16 }}>
              <input
                className="bloxs-input"
                type={showPwd ? "text" : "password"}
                placeholder="Senha de administrador"
                value={pwd}
                onChange={e => setPwd(e.target.value)}
                autoFocus
                style={{ paddingRight: 48 }}
              />
              <button type="button" onClick={() => setShowPwd(!showPwd)}
                style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.4)", fontSize: 18 }}>
                {showPwd ? "🙈" : "👁"}
              </button>
            </div>
            {pwdError && <p style={{ color: "#f87171", fontSize: 13, marginBottom: 12, textAlign: "center" }}>{pwdError}</p>}
            <button type="submit" className="btn-primary">Entrar no Painel</button>
          </form>
        </div>
      </div>
    );
  }

  // ── Authenticated ──
  const TABS: { id: AdminTab; label: string; icon: string }[] = [
    { id: "clientes",      label: "Clientes",      icon: "👥" },
    { id: "depositos",     label: "Depósitos",     icon: "💳" },
    { id: "levantamentos", label: "Levantamentos", icon: "🏧" },
  ];

  return (
    <div className="app-shell" style={{ background: "#0b0f19" }}>
      {/* Header */}
      <div className="top-header">
        <button onClick={onClose} style={{ background: "rgba(255,255,255,0.07)", border: "none", borderRadius: 10, padding: "8px 14px", cursor: "pointer", color: "rgba(255,255,255,0.7)", fontSize: 13, fontWeight: 600 }}>
          ← Voltar
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 14 }}>🛡️</span>
          <span style={{ fontWeight: 700, fontSize: 15 }}>Admin Dashboard</span>
        </div>
        <span style={{ fontSize: 11, color: "#a3e635", fontWeight: 600, background: "rgba(163,230,53,0.1)", padding: "4px 10px", borderRadius: 10, border: "1px solid rgba(163,230,53,0.2)" }}>
          ADMIN
        </span>
      </div>

      {/* Tab bar */}
      <div style={{
        display: "flex", borderBottom: "1px solid rgba(163,230,53,0.1)",
        background: "rgba(255,255,255,0.02)", flexShrink: 0,
      }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            flex: 1, padding: "12px 4px", border: "none", cursor: "pointer",
            background: "transparent", color: tab === t.id ? "#a3e635" : "rgba(255,255,255,0.35)",
            fontSize: 11, fontWeight: 700, display: "flex", flexDirection: "column",
            alignItems: "center", gap: 4, transition: "color 0.15s",
            borderBottom: tab === t.id ? "2px solid #a3e635" : "2px solid transparent",
          }}>
            <span style={{ fontSize: 18 }}>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {tab === "clientes"      && <ClientesTab />}
        {tab === "depositos"     && <DepositosTab />}
        {tab === "levantamentos" && <LevantamentosTab />}
      </div>
    </div>
  );
}
