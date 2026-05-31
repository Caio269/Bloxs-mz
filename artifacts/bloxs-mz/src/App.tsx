import { useState, useEffect, useCallback, FormEvent } from "react";
import { onAuthStateChanged, signOut, User as FirebaseUser } from "firebase/auth";
import { ref, get, set, update, runTransaction, query as rtdbQuery, orderByChild, equalTo } from "firebase/database";
import { auth, rtdb, isMockMode } from "./firebase";
import Login from "./components/Login";
import AdminDashboard from "./components/AdminDashboard";

// ── Admin password (altere aqui quando quiser mudar) ──────────────────────────
const ADMIN_PASSWORD = "Bloxs@Admin2025";

// ── Mock data (usado quando Firebase não está configurado) ─────────────────────
const MOCK_USER: User = {
  id: "BLX9F3K2A",
  name: "João Demo",
  email: "demo@bloxsmz.com",
  password: "",
  phone: "84 123 4567",
  balance: 5850.00,
  retention: 180,
  retentionMax: 500,
  plans: {
    estagiario: { owned: true, lastCollect: null, startDate: new Date(Date.now() - 86400000 * 5).toISOString() },
    ferro: { owned: true,  lastCollect: null },
    cox:   { owned: true,  lastCollect: new Date().toDateString() },
    sc:    { owned: false, lastCollect: null },
  },
  transactions: [
    { id: "T001", type: "credit", amount: 54.00,  description: "Lucro diário — ferro (90%)",  date: new Date(Date.now() - 86400000).toISOString() },
    { id: "T002", type: "credit", amount: 54.00,  description: "Lucro diário — cox (90%)",    date: new Date(Date.now() - 86400000 * 2).toISOString() },
    { id: "T003", type: "debit",  amount: 600.00, description: "Compra do plano ferro",        date: new Date(Date.now() - 86400000 * 5).toISOString() },
    { id: "T004", type: "debit",  amount: 1800.00,description: "Compra do plano cox",          date: new Date(Date.now() - 86400000 * 7).toISOString() },
    { id: "T005", type: "credit", amount: 50.00,  description: "Bónus de referência — Maria",  date: new Date(Date.now() - 86400000 * 3).toISOString() },
  ],
  withdrawals: [
    { id: "W001", amount: 500, fee: 50, net: 450, method: "M-Pesa", phone: "84 123 4567", status: "processado", date: new Date(Date.now() - 86400000 * 4).toISOString() },
    { id: "W002", amount: 200, fee: 20, net: 180, method: "e-Mola", phone: "84 123 4567", status: "pendente",   date: new Date(Date.now() - 3600000).toISOString() },
  ],
  deposits: [
    { id: "D001", amount: 1800, method: "M-Pesa", txId: "MPE20250512093412", status: "confirmado", date: new Date(Date.now() - 86400000 * 7).toISOString() },
    { id: "D002", amount: 600,  method: "e-Mola", txId: "EMO20250515141230", status: "pendente",   date: new Date(Date.now() - 3600000 * 2).toISOString() },
  ],
  teamMembers: [
    { name: "Maria Cossa",   joinDate: new Date(Date.now() - 86400000 * 3).toISOString(), plan: "Família Ferro 2x" },
    { name: "Carlos Nhance", joinDate: new Date(Date.now() - 86400000 * 6).toISOString(), plan: "Família Cox 2x" },
  ],
};

// ── Types ─────────────────────────────────────────────────────────────────────
interface User {
  id: string;
  name: string;
  email: string;
  password: string;
  phone: string;
  balance: number;
  retention: number;
  retentionMax: number;
  plans: Record<string, PlanState>;
  transactions: Transaction[];
  withdrawals: Withdrawal[];
  deposits: Deposit[];
  teamMembers: TeamMember[];
}

interface PlanState {
  owned: boolean;
  lastCollect: string | null;
  startDate?: string | null;
}

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

interface TeamMember {
  name: string;
  joinDate: string;
  plan: string;
}

const PLANS = [
  { id: "estagiario", name: "Estagiário Bloxs", cost: 0, daily: 10, maxEarnings: 300, duration: 30, color: "from-amber-800 to-orange-900", badge: "Grátis" },
  { id: "ferro", name: "Família Ferro 2x", cost: 600, daily: 20, maxEarnings: null, duration: null, color: "from-slate-700 to-slate-800", badge: "Básico" },
  { id: "cox", name: "Família Cox 2x", cost: 1800, daily: 60, maxEarnings: null, duration: null, color: "from-blue-900 to-indigo-900", badge: "Popular" },
  { id: "sc", name: "Família S.C 2x", cost: 9000, daily: 300, maxEarnings: null, duration: null, color: "from-purple-900 to-violet-900", badge: "Premium" },
];

// ── Storage helpers ───────────────────────────────────────────────────────────
const STORAGE_KEY = "bloxs_mz_users";
const SESSION_KEY = "bloxs_mz_session";

function loadUsers(): Record<string, User> {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch { return {}; }
}

function saveUsers(users: Record<string, User>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(users));
}

function loadSession(): string | null {
  return localStorage.getItem(SESSION_KEY);
}

function saveSession(email: string | null) {
  if (email) localStorage.setItem(SESSION_KEY, email);
  else localStorage.removeItem(SESSION_KEY);
}

function genId(): string {
  return "BLX" + Math.random().toString(36).substring(2, 8).toUpperCase();
}

function todayStr(): string {
  return new Date().toDateString();
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function Toast({ msg }: { msg: string }) {
  return (
    <div className="toast-container">
      <div className="toast">{msg}</div>
    </div>
  );
}

// ── WhatsApp button ───────────────────────────────────────────────────────────
function WhatsAppBtn() {
  return (
    <button
      className="whatsapp-btn"
      onClick={() => window.open("https://wa.me/258859219017", "_blank")}
      aria-label="Suporte WhatsApp"
    >
      <svg width="28" height="28" viewBox="0 0 24 24" fill="white">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
      </svg>
    </button>
  );
}

// ── Bottom Nav ────────────────────────────────────────────────────────────────
type Tab = "familias" | "financas" | "equipa" | "suporte" | "sobre";

const NAV_ITEMS: { id: Tab; label: string; icon: string }[] = [
  { id: "familias", label: "Famílias", icon: "👨‍👩‍👧" },
  { id: "financas", label: "Finanças", icon: "💰" },
  { id: "equipa", label: "Equipa", icon: "👥" },
  { id: "suporte", label: "Suporte", icon: "🎧" },
  { id: "sobre", label: "Sobre", icon: "ℹ️" },
];

function BottomNav({ active, onChange, onLogout }: { active: Tab; onChange: (t: Tab) => void; onLogout: () => void }) {
  return (
    <nav className="bottom-nav">
      {NAV_ITEMS.map(item => (
        <button key={item.id} className={`nav-item ${active === item.id ? "active" : ""}`} onClick={() => onChange(item.id)}>
          <span style={{ fontSize: 18 }}>{item.icon}</span>
          <span className="label">{item.label}</span>
        </button>
      ))}
      <button className="nav-item" onClick={onLogout} style={{ color: "#ef4444" }}>
        <span style={{ fontSize: 18 }}>🚪</span>
        <span className="label">Sair</span>
      </button>
    </nav>
  );
}

// ── Login / Register Screen ───────────────────────────────────────────────────
function AuthScreen({ onLogin }: { onLogin: (u: User) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }

  function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const users = loadUsers();
    const user = users[email];
    if (!user || user.password !== password) {
      setError("Email ou senha incorretos.");
      return;
    }
    saveSession(email);
    onLogin(user);
  }

  function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!name || !email || !password || !phone) {
      setError("Preencha todos os campos.");
      return;
    }
    const users = loadUsers();
    if (users[email]) {
      setError("Este email já está registado.");
      return;
    }
    const newUser: User = {
      id: genId(),
      name,
      email,
      password,
      phone,
      balance: 0,
      retention: 0,
      retentionMax: 500,
      plans: {
        estagiario: { owned: true, lastCollect: null, startDate: new Date().toISOString() },
        ferro: { owned: false, lastCollect: null },
        cox: { owned: false, lastCollect: null },
        sc: { owned: false, lastCollect: null },
      },
      transactions: [],
      withdrawals: [],
      deposits: [],
      teamMembers: [],
    };
    users[email] = newUser;
    saveUsers(users);
    saveSession(email);
    showToast("Conta criada com sucesso!");
    setTimeout(() => onLogin(newUser), 1200);
  }

  return (
    <div className="app-shell fade-in" style={{ justifyContent: "center" }}>
      {toast && <Toast msg={toast} />}
      <div className="scrollable" style={{ flex: 1, padding: "32px 24px" }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <div style={{
            width: 72, height: 72, borderRadius: 20,
            background: "linear-gradient(135deg, #a3e635, #84cc16)",
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 16px", boxShadow: "0 8px 32px rgba(163,230,53,0.3)"
          }}>
            <span style={{ fontSize: 36 }}>💎</span>
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.5px" }}>
            Bloxs <span className="lime">mz</span>
          </h1>
          <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 13, marginTop: 6 }}>
            Plataforma de Gestão Financeira
          </p>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", background: "rgba(255,255,255,0.05)", borderRadius: 12, padding: 4, marginBottom: 28 }}>
          {["login", "register"].map(m => (
            <button key={m} onClick={() => { setMode(m as "login" | "register"); setError(""); }}
              style={{
                flex: 1, padding: "10px", borderRadius: 10, border: "none", cursor: "pointer",
                fontWeight: 600, fontSize: 14, transition: "all 0.2s",
                background: mode === m ? "#a3e635" : "transparent",
                color: mode === m ? "#0b0f19" : "rgba(255,255,255,0.5)"
              }}>
              {m === "login" ? "Entrar" : "Registar"}
            </button>
          ))}
        </div>

        <form onSubmit={mode === "login" ? handleLogin : handleRegister}>
          {mode === "register" && (
            <>
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 6, display: "block" }}>Nome completo</label>
                <input className="bloxs-input" type="text" placeholder="João Silva" value={name} onChange={e => setName(e.target.value)} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 6, display: "block" }}>Telefone</label>
                <input className="bloxs-input" type="tel" placeholder="84 000 0000" value={phone} onChange={e => setPhone(e.target.value)} />
              </div>
            </>
          )}
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 6, display: "block" }}>Email</label>
            <input className="bloxs-input" type="email" placeholder="exemplo@email.com" value={email} onChange={e => setEmail(e.target.value)} />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 6, display: "block" }}>Senha</label>
            <input className="bloxs-input" type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} />
          </div>
          {error && (
            <p style={{ color: "#f87171", fontSize: 13, marginBottom: 14, textAlign: "center" }}>{error}</p>
          )}
          <button className="btn-primary" type="submit">
            {mode === "login" ? "Entrar na Conta" : "Criar Conta Grátis"}
          </button>
        </form>

        <p style={{ textAlign: "center", color: "rgba(255,255,255,0.25)", fontSize: 12, marginTop: 24 }}>
          Bloxs mz © 2025 · Moçambique
        </p>
      </div>
    </div>
  );
}

// ── Dashboard Header ──────────────────────────────────────────────────────────
function DashboardHeader({ user }: { user: User }) {
  return (
    <div className="top-header">
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          background: "linear-gradient(135deg, #a3e635, #84cc16)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 16, fontWeight: 800, color: "#0b0f19"
        }}>B</div>
        <div>
          <p style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", lineHeight: 1 }}>Bem-vindo</p>
          <p style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.4 }}>{user.name.split(" ")[0]}</p>
        </div>
      </div>
      <div style={{ textAlign: "right" }}>
        <p style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>ID do Utilizador</p>
        <span className="badge">{user.id}</span>
      </div>
    </div>
  );
}

// ── Balance Card ──────────────────────────────────────────────────────────────
function BalanceCard({ balance }: { balance: number }) {
  const [visible, setVisible] = useState(true);
  return (
    <div className="glass-card" style={{ padding: "20px", margin: "16px 16px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", marginBottom: 6 }}>Saldo Disponível</p>
          <p style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-1px" }}>
            {visible ? (
              <><span className="lime">{balance.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span><span style={{ fontSize: 16, color: "rgba(255,255,255,0.5)", marginLeft: 6 }}>MT</span></>
            ) : (
              <span style={{ letterSpacing: 4 }}>••••••</span>
            )}
          </p>
        </div>
        <button onClick={() => setVisible(!visible)} style={{ background: "rgba(255,255,255,0.06)", border: "none", borderRadius: 8, padding: "6px 10px", cursor: "pointer", color: "rgba(255,255,255,0.5)", fontSize: 18 }}>
          {visible ? "👁" : "🙈"}
        </button>
      </div>
      <div className="divider" />
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span className="pulse-dot" />
        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>Conta activa · Moçambique</span>
      </div>
    </div>
  );
}

// ── Fund Cards ────────────────────────────────────────────────────────────────
function FundCards() {
  return (
    <div style={{ display: "flex", gap: 12, margin: "12px 16px 0" }}>
      <div className="fund-card fund-card-green">
        <p style={{ fontSize: 10, color: "rgba(163,230,53,0.7)", marginBottom: 4, fontWeight: 600 }}>FUNDO ACTIVO</p>
        <p style={{ fontSize: 18, fontWeight: 800, color: "#a3e635" }}>2x</p>
        <p style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginTop: 4 }}>Duplica capital</p>
        <div style={{ marginTop: 10, fontSize: 22 }}>📈</div>
      </div>
      <div className="fund-card fund-card-yellow">
        <p style={{ fontSize: 10, color: "rgba(250,204,21,0.7)", marginBottom: 4, fontWeight: 600 }}>FUNDO RIQUEZA</p>
        <p style={{ fontSize: 18, fontWeight: 800, color: "#facc15" }}>3x</p>
        <p style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginTop: 4 }}>Triplica capital</p>
        <div style={{ marginTop: 10, fontSize: 22 }}>🏆</div>
      </div>
    </div>
  );
}

// ── Retention Bar ─────────────────────────────────────────────────────────────
function RetentionBar({ retention, max }: { retention: number; max: number }) {
  const pct = Math.min((retention / max) * 100, 100);
  return (
    <div className="glass-card" style={{ margin: "12px 16px 0", padding: "16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
        <p style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.7)" }}>🔒 Retenção de Levantamento</p>
        <span className="badge badge-yellow">{pct.toFixed(0)}%</span>
      </div>
      <div className="retention-bar">
        <div className="retention-fill" style={{ width: `${pct}%` }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>{retention.toFixed(2)} MT acumulado</span>
        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>Máx: {max} MT</span>
      </div>
    </div>
  );
}

// ── Families Tab ──────────────────────────────────────────────────────────────
function FamiliasTab({ user, onUpdate }: { user: User; onUpdate: (u: User) => void }) {
  const [toast, setToast] = useState("");

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }

  function buyPlan(planId: string, cost: number) {
    if (cost > 0 && user.balance < cost) {
      showToast("Saldo insuficiente para adquirir este plano.");
      return;
    }
    const users = loadUsers();
    const updated = { ...user };
    if (cost > 0) updated.balance -= cost;
    updated.plans = { ...updated.plans, [planId]: { owned: true, lastCollect: null, startDate: new Date().toISOString() } };
    if (cost > 0) {
      updated.transactions = [
        { id: genId(), type: "debit", amount: cost, description: `Compra do plano ${planId}`, date: new Date().toISOString() },
        ...updated.transactions,
      ];
    }
    users[user.email] = updated;
    saveUsers(users);
    onUpdate(updated);
    showToast(cost === 0 ? "✅ Plano Estagiário activado! Ciclo de 30 dias iniciado." : "Plano adquirido com sucesso!");
  }

  function collectProfit(planId: string, daily: number) {
    const plan = user.plans[planId];
    if (!plan.owned) return;
    if (plan.lastCollect === todayStr()) {
      showToast("Já recolheu o lucro hoje. Volte amanhã!");
      return;
    }

    if (planId === "estagiario") {
      const startDate = plan.startDate ? new Date(plan.startDate) : null;
      if (startDate) {
        const daysPassed = Math.floor((Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24));
        if (daysPassed >= 30) {
          showToast("O ciclo de 30 dias do Plano Estagiário está concluído. Pode efectuar o levantamento.");
          return;
        }
      }
      const totalEarned = user.transactions
        .filter(t => t.type === "credit" && t.description.includes("estagiario"))
        .reduce((s, t) => s + t.amount / 0.9, 0);
      if (totalEarned >= 300) {
        showToast("Atingiu o teto de 300 MT do Plano Estagiário.");
        return;
      }
    }

    const toBalance = daily * 0.9;
    const toRetention = daily * 0.1;
    const users = loadUsers();
    const updated = { ...user };
    updated.balance += toBalance;
    updated.retention = Math.min(updated.retention + toRetention, updated.retentionMax);
    updated.plans = { ...updated.plans, [planId]: { owned: true, lastCollect: todayStr() } };
    updated.transactions = [
      { id: genId(), type: "credit", amount: toBalance, description: `Lucro diário — ${planId} (90%)`, date: new Date().toISOString() },
      ...updated.transactions,
    ];
    users[user.email] = updated;
    saveUsers(users);
    onUpdate(updated);
    showToast(`+${toBalance.toFixed(2)} MT ao saldo! +${toRetention.toFixed(2)} MT retidos.`);
  }

  return (
    <div className="scrollable fade-in" style={{ flex: 1, padding: "16px" }}>
      {toast && <Toast msg={toast} />}
      <BalanceCard balance={user.balance} />
      <FundCards />
      <RetentionBar retention={user.retention} max={user.retentionMax} />

      <p style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.5)", marginTop: 20, marginBottom: 12, letterSpacing: "0.5px", textTransform: "uppercase" }}>
        Planos de Investimento
      </p>

      {PLANS.map(plan => {
        const planState = user.plans[plan.id] ?? { owned: false, lastCollect: null, startDate: null };
        const canCollect = planState.owned && planState.lastCollect !== todayStr();
        const collected = planState.owned && planState.lastCollect === todayStr();

        if (plan.id === "estagiario") {
          const startDate = planState.startDate ? new Date(planState.startDate) : null;
          const daysPassed = startDate ? Math.floor((Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24)) : 0;
          const daysRemaining = Math.max(0, 30 - daysPassed);
          const cycleComplete = daysPassed >= 30;
          const progressPct = Math.min((daysPassed / 30) * 100, 100);
          const totalEarned = user.transactions
            .filter(t => t.type === "credit" && t.description.includes("estagiario"))
            .reduce((s, t) => s + t.amount, 0);
          return (
            <div key={plan.id} className="plan-card" style={{ marginBottom: 14, borderColor: "rgba(251,146,60,0.25)", background: "linear-gradient(135deg, rgba(120,53,15,0.35) 0%, rgba(11,15,25,0.9) 100%)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <div>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 20, background: "rgba(251,146,60,0.15)", color: "#fb923c", border: "1px solid rgba(251,146,60,0.3)" }}>
                    🎓 Grátis
                  </span>
                  <p style={{ fontSize: 17, fontWeight: 800, marginTop: 8 }}>{plan.name}</p>
                </div>
                <div style={{ textAlign: "right" }}>
                  <p style={{ fontSize: 22, fontWeight: 800, color: "#fb923c" }}>10 MT</p>
                  <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>por dia</p>
                </div>
              </div>

              <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
                <div style={{ flex: 1, background: "rgba(251,146,60,0.08)", borderRadius: 10, padding: "10px 12px" }}>
                  <p style={{ fontSize: 10, color: "rgba(251,146,60,0.7)", marginBottom: 2 }}>DIAS RESTANTES</p>
                  <p style={{ fontSize: 18, fontWeight: 800, color: "#fb923c" }}>{daysRemaining}</p>
                </div>
                <div style={{ flex: 1, background: "rgba(163,230,53,0.06)", borderRadius: 10, padding: "10px 12px" }}>
                  <p style={{ fontSize: 10, color: "rgba(163,230,53,0.6)", marginBottom: 2 }}>GANHO ATÉ AGORA</p>
                  <p style={{ fontSize: 18, fontWeight: 800, color: "#a3e635" }}>{totalEarned.toFixed(2)} MT</p>
                </div>
              </div>

              {planState.owned && startDate && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>Progresso do ciclo</span>
                    <span style={{ fontSize: 11, color: "#fb923c", fontWeight: 700 }}>{daysPassed}/30 dias</span>
                  </div>
                  <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.07)" }}>
                    <div style={{ height: "100%", borderRadius: 3, width: `${progressPct}%`, background: cycleComplete ? "#a3e635" : "linear-gradient(90deg,#fb923c,#f97316)", transition: "width 0.4s" }} />
                  </div>
                  <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 4 }}>
                    {cycleComplete
                      ? "✅ Ciclo completo — levantamento disponível!"
                      : `Teto de 300 MT · Levantamento disponível em ${daysRemaining} dia${daysRemaining !== 1 ? "s" : ""}`}
                  </p>
                </div>
              )}

              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 14 }}>
                💡 90% vai ao saldo · 10% retido · Ciclo de 30 dias
              </div>

              {!planState.owned ? (
                <button className="btn-primary" style={{ background: "linear-gradient(135deg,#fb923c,#f97316)", boxShadow: "0 4px 16px rgba(251,146,60,0.3)" }} onClick={() => buyPlan(plan.id, plan.cost)}>
                  🎓 Activar Plano Estagiário — Grátis
                </button>
              ) : cycleComplete ? (
                <div style={{ background: "rgba(163,230,53,0.08)", border: "1px solid rgba(163,230,53,0.2)", borderRadius: 12, padding: "14px 16px", textAlign: "center" }}>
                  <p style={{ color: "#a3e635", fontSize: 14, fontWeight: 700 }}>🎉 Ciclo de 30 dias concluído!</p>
                  <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, marginTop: 4 }}>Pode efectuar o levantamento do seu saldo.</p>
                </div>
              ) : collected ? (
                <div style={{ background: "rgba(251,146,60,0.06)", borderRadius: 12, padding: "12px 16px", textAlign: "center" }}>
                  <p style={{ color: "#fb923c", fontSize: 13, fontWeight: 600 }}>✅ Lucro recolhido hoje</p>
                  <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 11, marginTop: 4 }}>Próxima recolha: amanhã</p>
                </div>
              ) : (
                <button style={{ width: "100%", padding: "14px", borderRadius: 14, border: "none", cursor: "pointer", fontWeight: 700, fontSize: 14, background: "linear-gradient(135deg,#fb923c,#f97316)", color: "#fff", boxShadow: "0 4px 16px rgba(251,146,60,0.3)" }} onClick={() => collectProfit(plan.id, plan.daily)}>
                  💰 Recolher Lucro Diário — 10 MT
                </button>
              )}
            </div>
          );
        }

        return (
          <div key={plan.id} className="plan-card" style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
              <div>
                <span className={`badge ${plan.id === "sc" ? "badge-yellow" : ""}`}>{plan.badge}</span>
                <p style={{ fontSize: 17, fontWeight: 800, marginTop: 8 }}>{plan.name}</p>
              </div>
              <div style={{ textAlign: "right" }}>
                <p style={{ fontSize: 22, fontWeight: 800, color: "#a3e635" }}>{plan.cost.toLocaleString()} MT</p>
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>investimento</p>
              </div>
            </div>

            <div style={{ display: "flex", gap: 16, marginBottom: 14 }}>
              <div style={{ flex: 1, background: "rgba(163,230,53,0.08)", borderRadius: 10, padding: "10px 12px" }}>
                <p style={{ fontSize: 10, color: "rgba(163,230,53,0.6)", marginBottom: 2 }}>RENDA DIÁRIA</p>
                <p style={{ fontSize: 18, fontWeight: 800, color: "#a3e635" }}>{plan.daily} MT</p>
              </div>
              <div style={{ flex: 1, background: "rgba(250,204,21,0.08)", borderRadius: 10, padding: "10px 12px" }}>
                <p style={{ fontSize: 10, color: "rgba(250,204,21,0.6)", marginBottom: 2 }}>MENSAL EST.</p>
                <p style={{ fontSize: 18, fontWeight: 800, color: "#facc15" }}>{(plan.daily * 30).toLocaleString()} MT</p>
              </div>
            </div>

            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 14 }}>
              💡 90% vai ao saldo · 10% retido por levantamento
            </div>

            {!planState.owned ? (
              <button className="btn-primary" onClick={() => buyPlan(plan.id, plan.cost)}>
                Adquirir Plano — {plan.cost.toLocaleString()} MT
              </button>
            ) : collected ? (
              <div style={{ background: "rgba(163,230,53,0.06)", borderRadius: 12, padding: "12px 16px", textAlign: "center" }}>
                <p style={{ color: "#a3e635", fontSize: 13, fontWeight: 600 }}>✅ Lucro recolhido hoje</p>
                <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 11, marginTop: 4 }}>Próxima recolha: amanhã</p>
              </div>
            ) : (
              <button className="btn-yellow" onClick={() => collectProfit(plan.id, plan.daily)}>
                💰 Recolher Lucro Diário — {plan.daily} MT
              </button>
            )}
          </div>
        );
      })}
      <div style={{ height: 20 }} />
    </div>
  );
}

// ── Wallet number copy helper ─────────────────────────────────────────────────
const WALLETS = {
  "M-Pesa": "859219017",
  "e-Mola": "876542463",
} as const;

function WalletCard({
  method, number, selected, onSelect,
}: {
  method: "M-Pesa" | "e-Mola";
  number: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const isGreen = method === "M-Pesa";

  function copy(e: React.MouseEvent) {
    e.stopPropagation();
    navigator.clipboard?.writeText(number).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      onClick={onSelect}
      style={{
        flex: 1, textAlign: "left", border: "none", cursor: "pointer",
        background: selected
          ? (isGreen ? "rgba(163,230,53,0.12)" : "rgba(250,204,21,0.12)")
          : "rgba(255,255,255,0.04)",
        borderRadius: 16,
        outline: selected
          ? `2px solid ${isGreen ? "#a3e635" : "#facc15"}`
          : "2px solid rgba(255,255,255,0.06)",
        padding: "14px 14px 12px",
        transition: "all 0.2s",
      }}
    >
      {/* Logo row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{
          background: isGreen ? "rgba(163,230,53,0.15)" : "rgba(250,204,21,0.15)",
          borderRadius: 8, padding: "4px 10px",
          fontSize: 11, fontWeight: 800,
          color: isGreen ? "#a3e635" : "#facc15",
          letterSpacing: "0.5px",
        }}>
          {method}
        </div>
        {selected && (
          <span style={{ fontSize: 14, color: isGreen ? "#a3e635" : "#facc15" }}>✔</span>
        )}
      </div>

      {/* Number */}
      <p style={{ fontSize: 18, fontWeight: 800, letterSpacing: "1px", color: "white", marginBottom: 2 }}>
        {number}
      </p>
      <p style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginBottom: 10 }}>
        Número de carteira
      </p>

      {/* Copy button */}
      <button
        onClick={copy}
        style={{
          width: "100%", padding: "7px", borderRadius: 8, border: "none", cursor: "pointer",
          background: copied
            ? (isGreen ? "rgba(163,230,53,0.2)" : "rgba(250,204,21,0.2)")
            : "rgba(255,255,255,0.06)",
          color: copied ? (isGreen ? "#a3e635" : "#facc15") : "rgba(255,255,255,0.55)",
          fontSize: 11, fontWeight: 600, transition: "all 0.2s",
        }}
      >
        {copied ? "✅ Copiado!" : "📋 Copiar número"}
      </button>
    </button>
  );
}

// ── Finanças Tab ──────────────────────────────────────────────────────────────
function FinancasTab({ user, onUpdate }: { user: User; onUpdate: (u: User) => void }) {
  const [section, setSection] = useState<"deposit" | "withdraw" | "history">("deposit");
  const [toast, setToast] = useState("");

  // Deposit state
  const [depMethod, setDepMethod] = useState<"M-Pesa" | "e-Mola">("M-Pesa");
  const [depAmount, setDepAmount] = useState("");
  const [depTxId, setDepTxId] = useState("");

  // Withdraw state
  const [wAmount, setWAmount] = useState("");
  const [wMethod, setWMethod] = useState<"M-Pesa" | "e-Mola">("M-Pesa");
  const [wPhone, setWPhone] = useState(user.phone || "");
  const [withdrawBlockMsg, setWithdrawBlockMsg] = useState("");

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  }

  async function handleDeposit(e: React.FormEvent) {
    e.preventDefault();
    const amt = parseFloat(depAmount);
    if (isNaN(amt) || amt <= 0) { showToast("Insira um valor válido."); return; }
    if (amt < 100) { showToast("Depósito mínimo: 100 MT."); return; }
    if (!depTxId.trim()) { showToast("Insira o código de confirmação da transação."); return; }

    const deposit: Deposit = {
      id: genId(), amount: amt, method: depMethod,
      txId: depTxId.trim(), status: "pendente", date: new Date().toISOString(),
    };

    const users = loadUsers();
    const updated = { ...user };
    updated.deposits = [deposit, ...(updated.deposits ?? [])];
    users[user.email] = updated;
    saveUsers(users);
    onUpdate(updated);

    // Persiste o depósito no Firebase RTDB (usa o ID do depósito como chave)
    if (!isMockMode) {
      try {
        // Descobre o UID do utilizador no Firebase pelo email armazenado
        const snap = await get(ref(rtdb, "usuarios"));
        if (snap.exists()) {
          const data = snap.val() as Record<string, Record<string, unknown>>;
          const uid = Object.keys(data).find(k => (data[k].email as string) === user.email);
          if (uid) {
            await set(ref(rtdb, `usuarios/${uid}/depositos/${deposit.id}`), deposit);
          }
        }
      } catch (err) {
        console.error("Erro ao guardar depósito no Firebase:", err);
      }
    }

    // Abre WhatsApp com mensagem pré-preenchida para o número do administrador
    const dataHora = new Date().toLocaleString("pt-MZ", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
    const msg = [
      `💰 *NOVO DEPÓSITO — Bloxs mz*`,
      ``,
      `👤 *Utilizador:* ${user.name}`,
      `📧 *Email:* ${user.email}`,
      `🆔 *ID Conta:* ${user.id}`,
      ``,
      `💳 *Método:* ${depMethod}`,
      `💵 *Valor:* ${amt.toLocaleString("pt-MZ")} MT`,
      `🔑 *ID Transação:* ${depTxId.trim()}`,
      ``,
      `📅 *Data/Hora:* ${dataHora}`,
      ``,
      `_Por favor confirme e actualize o saldo._`,
    ].join("\n");

    window.open(
      `https://wa.me/258859219017?text=${encodeURIComponent(msg)}`,
      "_blank"
    );

    setDepAmount("");
    setDepTxId("");
    showToast("✅ Depósito enviado! A redirigir para WhatsApp…");
  }

  async function handleWithdraw(e: React.FormEvent) {
    e.preventDefault();
    setWithdrawBlockMsg("");

    const estagiarioPlan = user.plans["estagiario"];
    if (estagiarioPlan?.owned && estagiarioPlan.startDate) {
      const startDate = new Date(estagiarioPlan.startDate);
      const daysPassed = Math.floor((Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      if (daysPassed < 30) {
        setWithdrawBlockMsg("Plano Estagiário: O levantamento do saldo só estará disponível após a conclusão do ciclo de teste de 30 dias.");
        return;
      }
    }

    const amt = parseFloat(wAmount);
    if (isNaN(amt) || amt <= 0) { showToast("Insira um valor válido."); return; }
    if (amt > user.balance) { showToast("Saldo insuficiente."); return; }
    if (amt < 50) { showToast("Levantamento mínimo: 50 MT."); return; }
    if (!wPhone.trim()) { showToast("Insira o número de telemóvel."); return; }

    const fee = amt * 0.10;
    const net = amt - fee;
    const now = new Date().toISOString();
    const withdrawal: Withdrawal = {
      id: genId(), amount: amt, fee, net,
      method: wMethod, phone: wPhone.trim(),
      status: "pendente", date: now,
    };
    const txId = genId();

    const users = loadUsers();
    const updated = { ...user };
    updated.balance -= amt;
    updated.withdrawals = [withdrawal, ...updated.withdrawals];
    updated.transactions = [
      { id: txId, type: "debit", amount: amt, description: `Levantamento via ${wMethod}`, date: now },
      ...updated.transactions,
    ];
    users[user.email] = updated;
    saveUsers(users);
    onUpdate(updated);

    // ── Persiste no Firebase RTDB ─────────────────────────────────────────────
    if (!isMockMode) {
      try {
        const snap = await get(ref(rtdb, "usuarios"));
        if (snap.exists()) {
          const data = snap.val() as Record<string, Record<string, unknown>>;
          const uid = Object.keys(data).find(k => (data[k].email as string) === user.email);
          if (uid) {
            await Promise.all([
              set(ref(rtdb, `usuarios/${uid}/levantamentos/${withdrawal.id}`), withdrawal),
              set(ref(rtdb, `usuarios/${uid}/transacoes/${txId}`), {
                id: txId, type: "debit", amount: amt,
                description: `Levantamento via ${wMethod}`, date: now,
              }),
              runTransaction(ref(rtdb, `usuarios/${uid}/saldo`), (cur) =>
                Math.max(0, Number(cur || 0) - amt)
              ),
            ]);
          }
        }
      } catch (err) {
        console.error("Erro ao guardar levantamento no Firebase:", err);
      }
    }

    // ── Notificação WhatsApp para o administrador ─────────────────────────────
    const dataHora = new Date().toLocaleString("pt-MZ", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
    const msg = [
      `💰 *NOVO LEVANTAMENTO — Bloxs mz*`,
      ``,
      `👤 *Utilizador:* ${user.name}`,
      `📧 *Email:* ${user.email}`,
      `🆔 *ID Conta:* ${user.id}`,
      ``,
      `💳 *Método:* ${wMethod}`,
      `💵 *Valor:* ${amt.toLocaleString("pt-MZ")} MT`,
      `🔑 *Número de Telefone:* ${wPhone.trim()}`,
      ``,
      `📅 *Data/Hora:* ${dataHora}`,
      ``,
      `_Por favor confirme e actualize o saldo._`,
    ].join("\n");
    window.open(`https://wa.me/258859219017?text=${encodeURIComponent(msg)}`, "_blank");

    setWAmount("");
    showToast(`✅ Pedido enviado! Receberá ${net.toFixed(2)} MT via ${wMethod}.`);
  }

  const SECTIONS = [
    { id: "deposit"  as const, label: "Depositar", icon: "⬇️" },
    { id: "withdraw" as const, label: "Levantar",  icon: "⬆️" },
    { id: "history"  as const, label: "Histórico", icon: "📋" },
  ];

  return (
    <div className="scrollable fade-in" style={{ flex: 1 }}>
      {toast && <Toast msg={toast} />}

      {/* Balance card */}
      <div className="glass-card" style={{ margin: "16px 16px 0", padding: "18px 20px" }}>
        <p style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", marginBottom: 4 }}>Saldo Disponível</p>
        <p style={{ fontSize: 30, fontWeight: 800, lineHeight: 1 }}>
          <span className="lime">{user.balance.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          <span style={{ fontSize: 14, color: "rgba(255,255,255,0.4)", marginLeft: 6 }}>MT</span>
        </p>
      </div>

      {/* 3-tab toggle */}
      <div style={{ display: "flex", margin: "14px 16px 0", background: "rgba(255,255,255,0.04)", borderRadius: 14, padding: 4, gap: 2 }}>
        {SECTIONS.map(s => (
          <button key={s.id} onClick={() => setSection(s.id)}
            style={{
              flex: 1, padding: "9px 4px", borderRadius: 11, border: "none", cursor: "pointer",
              fontWeight: 700, fontSize: 11, transition: "all 0.2s", lineHeight: 1.3,
              background: section === s.id ? "#a3e635" : "transparent",
              color: section === s.id ? "#0b0f19" : "rgba(255,255,255,0.4)",
              boxShadow: section === s.id ? "0 2px 8px rgba(163,230,53,0.25)" : "none",
            }}>
            <span style={{ display: "block", fontSize: 14, marginBottom: 2 }}>{s.icon}</span>
            {s.label}
          </button>
        ))}
      </div>

      {/* ── DEPOSITAR ── */}
      {section === "deposit" && (
        <div style={{ padding: "16px" }}>
          {/* Instructions banner */}
          <div style={{
            background: "linear-gradient(135deg, rgba(163,230,53,0.07), rgba(163,230,53,0.03))",
            border: "1px solid rgba(163,230,53,0.2)", borderRadius: 14, padding: "14px 16px", marginBottom: 18,
          }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: "#a3e635", marginBottom: 6 }}>
              📲 Como efectuar o depósito
            </p>
            <ol style={{ paddingLeft: 16, margin: 0 }}>
              {[
                "Escolhe o método de pagamento abaixo",
                "Envia o valor desejado para o número indicado",
                "Copia o código de confirmação da transação",
                "Preenche o formulário e clica em Confirmar",
              ].map((step, i) => (
                <li key={i} style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", marginBottom: 4, lineHeight: 1.5 }}>
                  {step}
                </li>
              ))}
            </ol>
          </div>

          {/* Wallet cards */}
          <p style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.45)", marginBottom: 10, letterSpacing: "0.3px" }}>
            SELECCIONA O MÉTODO
          </p>
          <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
            {(["M-Pesa", "e-Mola"] as const).map(m => (
              <WalletCard
                key={m} method={m} number={WALLETS[m]}
                selected={depMethod === m} onSelect={() => setDepMethod(m)}
              />
            ))}
          </div>

          {/* Highlighted selected wallet */}
          <div style={{
            background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)",
            borderRadius: 12, padding: "12px 16px", marginBottom: 20,
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <div>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>Enviar para</p>
              <p style={{ fontSize: 17, fontWeight: 800, letterSpacing: "1px" }}>
                {WALLETS[depMethod]}
              </p>
            </div>
            <span style={{
              fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 20,
              background: depMethod === "M-Pesa" ? "rgba(163,230,53,0.15)" : "rgba(250,204,21,0.15)",
              color: depMethod === "M-Pesa" ? "#a3e635" : "#facc15",
              border: `1px solid ${depMethod === "M-Pesa" ? "rgba(163,230,53,0.3)" : "rgba(250,204,21,0.3)"}`,
            }}>
              {depMethod}
            </span>
          </div>

          {/* Form */}
          <form onSubmit={handleDeposit}>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 6, display: "block", fontWeight: 600 }}>
                Valor a depositar (MT)
              </label>
              <input
                className="bloxs-input"
                type="number" min="100" step="1"
                placeholder="Ex: 600"
                value={depAmount}
                onChange={e => setDepAmount(e.target.value)}
              />
              <p style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", marginTop: 5 }}>Depósito mínimo: 100 MT</p>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 6, display: "block", fontWeight: 600 }}>
                Código de confirmação (ID da transação)
              </label>
              <input
                className="bloxs-input"
                type="text"
                placeholder="Ex: MPE20250519143022"
                value={depTxId}
                onChange={e => setDepTxId(e.target.value)}
                style={{ letterSpacing: "0.5px" }}
              />
              <p style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", marginTop: 5 }}>
                Encontra este código na mensagem SMS de confirmação do {depMethod}
              </p>
            </div>

            <button className="btn-primary" type="submit">
              ✅ Confirmar Depósito
            </button>
          </form>
        </div>
      )}

      {/* ── LEVANTAR ── */}
      {section === "withdraw" && (
        <div>
          {withdrawBlockMsg && (
            <div style={{
              margin: "12px 16px 0", padding: "16px",
              background: "rgba(239,68,68,0.12)",
              border: "1.5px solid rgba(239,68,68,0.4)",
              borderRadius: 14,
            }}>
              <p style={{ fontSize: 13, color: "#f87171", fontWeight: 800, marginBottom: 6 }}>🔒 Levantamento Bloqueado</p>
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.75)", lineHeight: 1.5 }}>{withdrawBlockMsg}</p>
            </div>
          )}

          <div style={{ margin: "12px 16px 0", padding: "12px 16px", background: "rgba(250,204,21,0.07)", border: "1px solid rgba(250,204,21,0.18)", borderRadius: 12 }}>
            <p style={{ fontSize: 12, color: "#facc15", fontWeight: 600 }}>⚠️ Taxa de Levantamento</p>
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginTop: 4 }}>
              Taxa fixa de <strong style={{ color: "#facc15" }}>10%</strong> cobrada sobre o valor solicitado.
            </p>
          </div>

          <form onSubmit={handleWithdraw} style={{ padding: "16px" }}>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 6, display: "block", fontWeight: 600 }}>Valor a levantar (MT)</label>
              <input className="bloxs-input" type="number" min="50" step="1" placeholder="Ex: 500" value={wAmount}
                onChange={e => setWAmount(e.target.value)} />
            </div>

            {wAmount && !isNaN(parseFloat(wAmount)) && parseFloat(wAmount) > 0 && (
              <div style={{ background: "rgba(163,230,53,0.05)", border: "1px solid rgba(163,230,53,0.12)", borderRadius: 12, padding: "12px 16px", marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>Valor solicitado</span>
                  <span style={{ fontSize: 12 }}>{parseFloat(wAmount).toFixed(2)} MT</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontSize: 12, color: "#f87171" }}>Taxa (10%)</span>
                  <span style={{ fontSize: 12, color: "#f87171" }}>−{(parseFloat(wAmount) * 0.1).toFixed(2)} MT</span>
                </div>
                <div className="divider" />
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#a3e635" }}>Receberá</span>
                  <span style={{ fontSize: 13, fontWeight: 800, color: "#a3e635" }}>{(parseFloat(wAmount) * 0.9).toFixed(2)} MT</span>
                </div>
              </div>
            )}

            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 6, display: "block", fontWeight: 600 }}>Método</label>
              <select className="bloxs-input" value={wMethod} onChange={e => setWMethod(e.target.value as "M-Pesa" | "e-Mola")}>
                <option value="M-Pesa">M-Pesa</option>
                <option value="e-Mola">e-Mola</option>
              </select>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 6, display: "block", fontWeight: 600 }}>Número {wMethod}</label>
              <input className="bloxs-input" type="tel" placeholder="84 000 0000" value={wPhone} onChange={e => setWPhone(e.target.value)} />
            </div>

            <button className="btn-primary" type="submit">Solicitar Levantamento</button>
          </form>
        </div>
      )}

      {/* ── HISTÓRICO ── */}
      {section === "history" && (
        <div style={{ padding: "16px" }}>
          {/* Deposits history */}
          <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.35)", letterSpacing: "0.5px", textTransform: "uppercase", marginBottom: 10 }}>
            Depósitos
          </p>
          {(user.deposits ?? []).length === 0 ? (
            <div style={{ textAlign: "center", padding: "20px 0 24px", color: "rgba(255,255,255,0.25)", fontSize: 13 }}>
              Sem depósitos ainda
            </div>
          ) : (
            (user.deposits ?? []).map(d => (
              <div key={d.id} className="glass-card" style={{ padding: "13px 16px", marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>{d.method}</span>
                    <span style={{ fontSize: 10, background: "rgba(163,230,53,0.1)", color: "#a3e635", padding: "2px 7px", borderRadius: 20, border: "1px solid rgba(163,230,53,0.2)" }}>
                      ⬇️ Depósito
                    </span>
                  </div>
                  <span style={{ color: d.status === "confirmado" ? "#a3e635" : "#facc15", fontSize: 12, fontWeight: 600 }}>
                    {d.status === "confirmado" ? "✅ Confirmado" : "⏳ Pendente"}
                  </span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
                  <div>
                    <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>
                      ID: {d.txId}
                    </p>
                    <p style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", marginTop: 2 }}>
                      {new Date(d.date).toLocaleDateString("pt-MZ", { day: "2-digit", month: "short", year: "numeric" })}
                    </p>
                  </div>
                  <span style={{ fontSize: 15, fontWeight: 800, color: "#a3e635" }}>+{d.amount.toLocaleString()} MT</span>
                </div>
              </div>
            ))
          )}

          <div className="divider" style={{ margin: "16px 0" }} />

          {/* Withdrawals history */}
          <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.35)", letterSpacing: "0.5px", textTransform: "uppercase", marginBottom: 10 }}>
            Levantamentos
          </p>
          {user.withdrawals.length === 0 ? (
            <div style={{ textAlign: "center", padding: "20px 0 24px", color: "rgba(255,255,255,0.25)", fontSize: 13 }}>
              Sem levantamentos ainda
            </div>
          ) : (
            user.withdrawals.map(w => (
              <div key={w.id} className="glass-card" style={{ padding: "13px 16px", marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>{w.method}</span>
                    <span style={{ fontSize: 10, background: "rgba(250,204,21,0.1)", color: "#facc15", padding: "2px 7px", borderRadius: 20, border: "1px solid rgba(250,204,21,0.2)" }}>
                      ⬆️ Levant.
                    </span>
                  </div>
                  <span style={{ color: w.status === "processado" ? "#a3e635" : "#facc15", fontSize: 12, fontWeight: 600 }}>
                    {w.status === "processado" ? "✅ Processado" : "⏳ Pendente"}
                  </span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
                  <div>
                    <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>{w.phone}</p>
                    <p style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", marginTop: 2 }}>
                      Taxa: {w.fee.toFixed(2)} MT · {new Date(w.date).toLocaleDateString("pt-MZ", { day: "2-digit", month: "short" })}
                    </p>
                  </div>
                  <span style={{ fontSize: 15, fontWeight: 800, color: "#f87171" }}>−{w.amount.toLocaleString()} MT</span>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      <div style={{ height: 24 }} />
    </div>
  );
}

// ── Equipa Tab ────────────────────────────────────────────────────────────────
// ID do administrador — único utilizador que pode adicionar membros manualmente
const ADMIN_ID = "6MKKBZDZI";

function EquipaTab({ user, onUpdate }: { user: User; onUpdate: (u: User) => void }) {
  const [refId, setRefId]       = useState("");
  const [toast, setToast]       = useState("");
  const [adding, setAdding]     = useState(false);
  const [idError, setIdError]   = useState("");

  const isAdmin = user.id === ADMIN_ID;

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  }

  async function addMember(e: React.FormEvent) {
    e.preventDefault();
    const inputId = refId.trim().toUpperCase();
    if (!inputId) return;

    setIdError("");
    setAdding(true);

    try {
      if (inputId === user.id) {
        setIdError("Não podes adicionar o teu próprio ID.");
        return;
      }

      // Consulta o Firebase para verificar se o ID existe
      const q = rtdbQuery(ref(rtdb, "usuarios"), orderByChild("id"), equalTo(inputId));
      const snap = await get(q);

      if (!snap.exists()) {
        setIdError("ID inválido! Este utilizador não existe no sistema.");
        return;
      }

      const allMatches = snap.val() as Record<string, { nome?: string; equipa?: Record<string, { uid?: string }> }>;
      const memberUid = Object.keys(allMatches)[0];
      const memberData = Object.values(allMatches)[0];
      const memberName: string = memberData.nome ?? inputId;

      // Verifica se já está na equipa (por uid ou nome)
      const equipaExistente = memberData.equipa ?? {};
      const jaExisteNome = user.teamMembers.some(m => m.name === memberName);
      const jaExisteUid = Object.values(equipaExistente).some(m => m.uid === memberUid);
      if (jaExisteNome || jaExisteUid) {
        setIdError("Este utilizador já faz parte da tua equipa.");
        return;
      }

      const joinDate = new Date().toISOString();
      const planName = PLANS[Math.floor(Math.random() * PLANS.length)].name;
      const newMember: TeamMember = { name: memberName, joinDate, plan: planName };
      const txId = `ref_admin_${memberUid.slice(0, 8)}_${Date.now()}`;
      const membroId = `mem_${memberUid.slice(0, 8)}`;

      if (!isMockMode) {
        // Descobre o UID do admin no Firebase pelo email
        const adminQ = rtdbQuery(ref(rtdb, "usuarios"), orderByChild("id"), equalTo(user.id));
        const adminSnap = await get(adminQ);
        if (adminSnap.exists()) {
          const adminUid = Object.keys(adminSnap.val())[0];

          await runTransaction(ref(rtdb, `usuarios/${adminUid}/saldo`), (s) => Number(s || 0) + 50);

          await set(ref(rtdb, `usuarios/${adminUid}/equipa/${membroId}`), {
            uid: memberUid,
            name: memberName,
            joinDate,
            plan: planName,
          });

          await set(ref(rtdb, `usuarios/${adminUid}/transacoes/${txId}`), {
            id: txId,
            type: "credit",
            amount: 50,
            description: `Bónus de referência — ${memberName} (ID: ${inputId})`,
            date: joinDate,
          });
        }
      }

      // Actualiza localStorage como cache
      const updated = { ...user };
      updated.teamMembers = [newMember, ...updated.teamMembers];
      updated.balance += 50;
      updated.transactions = [
        { id: txId, type: "credit", amount: 50,
          description: `Bónus de referência — ${memberName} (ID: ${inputId})`,
          date: joinDate },
        ...updated.transactions,
      ];
      const users = loadUsers();
      users[user.email] = updated;
      saveUsers(users);
      onUpdate(updated);
      setRefId("");
      showToast(`✅ +50 MT creditados! ${memberName} adicionado à equipa.`);
    } catch {
      setIdError("Erro ao verificar o ID. Verifique a ligação e tente novamente.");
    } finally {
      setAdding(false);
    }
  }

  // O hash (#ref=ID) sobrevive a redirects do Replit e nunca é enviado ao servidor.
  const link = `${window.location.origin}${import.meta.env.BASE_URL}#ref=${user.id}`;

  return (
    <div className="scrollable fade-in" style={{ flex: 1, padding: "16px" }}>
      {toast && <Toast msg={toast} />}

      {/* Cartão do link de referência */}
      <div className="glass-card" style={{ padding: "20px", marginBottom: 16, textAlign: "center" }}>
        <p style={{ fontSize: 24, marginBottom: 8 }}>👥</p>
        <p style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Programa de Referências</p>
        <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginBottom: 16 }}>
          Ganhe 50 MT por cada membro que convidar
        </p>
        <div style={{
          background: "rgba(163,230,53,0.06)", border: "1px solid rgba(163,230,53,0.2)",
          borderRadius: 10, padding: "10px 14px", marginBottom: 16,
        }}>
          <p style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 4 }}>SEU LINK DE REFERÊNCIA</p>
          <p style={{ fontSize: 12, color: "#a3e635", wordBreak: "break-all" }}>{link}</p>
        </div>
        <button className="btn-outline" onClick={() => { navigator.clipboard?.writeText(link); showToast("Link copiado!"); }}>
          📋 Copiar Link
        </button>
      </div>

      {/* Secção de adicionar membro — APENAS VISÍVEL PARA O ADMIN */}
      {isAdmin && (
        <div className="glass-card" style={{
          padding: "16px", marginBottom: 20,
          border: "1px solid rgba(163,230,53,0.2)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <span style={{ fontSize: 14 }}>🔐</span>
            <p style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.8)" }}>
              Adicionar Membro por ID
            </p>
          </div>
          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginBottom: 12, lineHeight: 1.5 }}>
            Introduza o ID único do utilizador (ex: 6MKKBZDZI). O sistema irá verificar se existe antes de creditar o bónus.
          </p>
          <form onSubmit={addMember}>
            <div style={{ display: "flex", gap: 10, marginBottom: idError ? 10 : 0 }}>
              <input
                className="bloxs-input"
                style={{ flex: 1, textTransform: "uppercase", letterSpacing: "1px", fontWeight: 700 }}
                placeholder="ID DO UTILIZADOR"
                value={refId}
                onChange={e => { setRefId(e.target.value); setIdError(""); }}
                disabled={adding}
                maxLength={12}
              />
              <button
                type="submit"
                disabled={adding || !refId.trim()}
                style={{
                  width: "auto", padding: "0 18px", borderRadius: 12, border: "none",
                  background: adding || !refId.trim()
                    ? "rgba(163,230,53,0.3)"
                    : "linear-gradient(135deg, #a3e635, #84cc16)",
                  color: "#0b0f19", fontWeight: 800, fontSize: 16, cursor: adding ? "not-allowed" : "pointer",
                  transition: "all 0.2s",
                }}
              >
                {adding ? "…" : "+"}
              </button>
            </div>
            {idError && (
              <div style={{
                background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)",
                borderRadius: 10, padding: "10px 14px", display: "flex", gap: 8, alignItems: "flex-start",
              }}>
                <span style={{ fontSize: 14, flexShrink: 0 }}>⚠️</span>
                <p style={{ color: "#fca5a5", fontSize: 12, lineHeight: 1.5 }}>{idError}</p>
              </div>
            )}
          </form>
        </div>
      )}

      {/* Lista da equipa */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <p style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
          Minha Equipa
        </p>
        <span className="badge">{user.teamMembers.length} membros</span>
      </div>

      {user.teamMembers.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 0", color: "rgba(255,255,255,0.3)" }}>
          <p style={{ fontSize: 40, marginBottom: 12 }}>🌱</p>
          <p style={{ fontSize: 14 }}>Ainda sem membros na equipa</p>
          <p style={{ fontSize: 12, marginTop: 6, color: "rgba(255,255,255,0.2)" }}>
            Partilha o teu link de referência para convidar amigos
          </p>
        </div>
      ) : (
        user.teamMembers.map((m, i) => (
          <div key={i} className="glass-card" style={{ padding: "14px 16px", marginBottom: 10, display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 38, height: 38, borderRadius: 10, flexShrink: 0,
              background: "linear-gradient(135deg, #a3e635, #84cc16)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontWeight: 800, color: "#0b0f19", fontSize: 14,
            }}>
              {m.name[0]?.toUpperCase() ?? "?"}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontWeight: 700, fontSize: 14 }}>{m.name}</p>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{m.plan}</p>
            </div>
            <span style={{ fontSize: 11, color: "#a3e635", fontWeight: 600, flexShrink: 0 }}>+50 MT</span>
          </div>
        ))
      )}
      <div style={{ height: 20 }} />
    </div>
  );
}

// ── Suporte Tab ───────────────────────────────────────────────────────────────
function SuporteTab() {
  return (
    <div className="scrollable fade-in" style={{ flex: 1, padding: "16px" }}>
      <div className="glass-card" style={{ padding: "24px", textAlign: "center", marginBottom: 16 }}>
        <p style={{ fontSize: 40, marginBottom: 12 }}>🎧</p>
        <p style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>Centro de Suporte</p>
        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", lineHeight: 1.6 }}>
          A nossa equipa está disponível 24/7 para ajudar com qualquer questão sobre a plataforma.
        </p>
      </div>

      {[
        { icon: "💬", title: "WhatsApp", desc: "+258 85 921 9017", action: () => window.open("https://wa.me/258859219017", "_blank") },
        { icon: "📧", title: "Email", desc: "suporte@bloxsmz.com", action: () => window.open("mailto:suporte@bloxsmz.com") },
        { icon: "📱", title: "Telegram", desc: "@bloxsmz_suporte", action: () => window.open("https://t.me/bloxsmz_suporte", "_blank") },
      ].map((item, i) => (
        <button key={i} onClick={item.action}
          style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 14, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(163,230,53,0.1)", borderRadius: 14, padding: "16px", marginBottom: 10, cursor: "pointer", color: "white" }}>
          <span style={{ fontSize: 28 }}>{item.icon}</span>
          <div>
            <p style={{ fontWeight: 700, fontSize: 14 }}>{item.title}</p>
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.45)" }}>{item.desc}</p>
          </div>
          <span style={{ marginLeft: "auto", color: "#a3e635" }}>›</span>
        </button>
      ))}

      <div className="glass-card" style={{ padding: "20px", marginTop: 8 }}>
        <p style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>❓ Perguntas Frequentes</p>
        {[
          "Como funciona o Recolher Lucro Diário?",
          "Quando o meu levantamento é processado?",
          "O que é a Retenção de Levantamento?",
          "Como convidar membros para a minha equipa?",
        ].map((q, i) => (
          <div key={i} style={{ padding: "12px 0", borderBottom: i < 3 ? "1px solid rgba(255,255,255,0.06)" : "none" }}>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.65)" }}>{q}</p>
          </div>
        ))}
      </div>
      <div style={{ height: 20 }} />
    </div>
  );
}

// ── Sobre Tab ─────────────────────────────────────────────────────────────────
function SobreTab({ onAdminAccess }: { onAdminAccess: () => void }) {
  return (
    <div className="scrollable fade-in" style={{ flex: 1, padding: "16px" }}>
      <div style={{ textAlign: "center", padding: "24px 0" }}>
        <div style={{
          width: 80, height: 80, borderRadius: 24, background: "linear-gradient(135deg, #a3e635, #84cc16)",
          display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px",
          boxShadow: "0 8px 32px rgba(163,230,53,0.3)", fontSize: 36
        }}>💎</div>
        <h1 style={{ fontSize: 26, fontWeight: 800 }}>Bloxs <span className="lime">mz</span></h1>
        <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 13, marginTop: 6 }}>Versão 1.0.0</p>
      </div>

      <div className="glass-card" style={{ padding: "20px", marginBottom: 14 }}>
        <p style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>Sobre a Plataforma</p>
        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", lineHeight: 1.7 }}>
          A Bloxs mz é uma plataforma de gestão financeira e investimentos focada no mercado moçambicano.
          Oferecemos planos de investimento acessíveis com retornos diários, integração com M-Pesa e e-Mola,
          e um programa de referências que beneficia toda a comunidade.
        </p>
      </div>

      <div className="glass-card" style={{ padding: "20px", marginBottom: 14 }}>
        <p style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Estatísticas</p>
        {[
          { label: "Utilizadores Activos", value: "12.400+" },
          { label: "Total Pago", value: "45M MT" },
          { label: "Países", value: "1 (Moçambique)" },
          { label: "Disponível desde", value: "2024" },
        ].map((s, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: i < 3 ? "1px solid rgba(255,255,255,0.06)" : "none" }}>
            <span style={{ fontSize: 13, color: "rgba(255,255,255,0.45)" }}>{s.label}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#a3e635" }}>{s.value}</span>
          </div>
        ))}
      </div>

      <div className="glass-card" style={{ padding: "20px", marginBottom: 14 }}>
        <p style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>Métodos de Pagamento</p>
        <div style={{ display: "flex", gap: 10 }}>
          {["📱 M-Pesa", "💳 e-Mola"].map((m, i) => (
            <div key={i} style={{ flex: 1, background: "rgba(163,230,53,0.06)", border: "1px solid rgba(163,230,53,0.15)", borderRadius: 10, padding: "10px", textAlign: "center", fontSize: 13, fontWeight: 600 }}>{m}</div>
          ))}
        </div>
      </div>

      <p style={{ textAlign: "center", color: "rgba(255,255,255,0.2)", fontSize: 12, marginTop: 24, marginBottom: 16 }}>
        © 2025 Bloxs mz · Todos os direitos reservados
      </p>

      {/* Acesso admin — discreto no fundo */}
      <button
        onClick={onAdminAccess}
        style={{
          display: "block", margin: "0 auto 24px", background: "transparent",
          border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10,
          padding: "8px 20px", cursor: "pointer",
          color: "rgba(255,255,255,0.18)", fontSize: 11, fontWeight: 600,
          letterSpacing: "0.5px",
        }}
      >
        🔐 Área Restrita
      </button>
    </div>
  );
}

// ── Admin Panel ───────────────────────────────────────────────────────────────
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

function AdminPanel({ onClose }: { onClose: () => void }) {
  const [authed, setAuthed] = useState(false);
  const [pwd, setPwd] = useState("");
  const [pwdError, setPwdError] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [toast, setToast] = useState("");
  const [adminTab, setAdminTab] = useState<"depositos" | "levantamentos">("depositos");
  const [pendingList, setPendingList] = useState<PendingDeposit[]>([]);
  const [withdrawalList, setWithdrawalList] = useState<PendingWithdrawal[]>([]);
  const [allUsersCount, setAllUsersCount] = useState(0);
  const [totalDepositsCount, setTotalDepositsCount] = useState(0);
  const [activeFilter, setActiveFilter] = useState<"pending" | "all">("pending");
  const [withdrawalFilter, setWithdrawalFilter] = useState<"pending" | "all">("pending");
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [processingWithdrawalId, setProcessingWithdrawalId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  }

  async function loadPending() {
    setLoading(true);
    try {
      const list: PendingDeposit[] = [];
      let usersCount = 0;
      let depositsCount = 0;

      if (!isMockMode) {
        // Lê todos os utilizadores do Firebase RTDB
        const snap = await get(ref(rtdb, "usuarios"));
        if (snap.exists()) {
          const data = snap.val() as Record<string, Record<string, unknown>>;
          usersCount = Object.keys(data).length;
          Object.entries(data).forEach(([uid, raw]) => {
            const nome = (raw.nome as string) ?? "Utilizador";
            const email = (raw.email as string) ?? uid;
            const id = (raw.id as string) ?? uid.slice(0, 9).toUpperCase();
            // Itera os depositos preservando a chave real do Firebase
            const depositosRaw = raw.depositos as Record<string, Deposit> | null;
            if (depositosRaw) {
              Object.entries(depositosRaw).forEach(([fbKey, d]) => {
                depositsCount++;
                const matchFilter =
                  activeFilter === "pending" ? d.status === "pendente" : true;
                if (matchFilter) {
                  list.push({
                    userEmail: email, userName: nome, userId: id,
                    userUid: uid, deposit: d, depositFirebaseKey: fbKey,
                  });
                }
              });
            }
          });
        }
      } else {
        // Modo mock — lê apenas do localStorage
        const users = loadUsers();
        usersCount = Object.keys(users).length;
        Object.values(users).forEach(u => {
          (u.deposits ?? []).forEach(d => {
            depositsCount++;
            const matchFilter =
              activeFilter === "pending" ? d.status === "pendente" : true;
            if (matchFilter) {
              list.push({
                userEmail: u.email, userName: u.name, userId: u.id,
                userUid: "", deposit: d, depositFirebaseKey: d.id,
              });
            }
          });
        });
      }

      list.sort((a, b) => new Date(b.deposit.date).getTime() - new Date(a.deposit.date).getTime());
      setPendingList(list);
      setAllUsersCount(usersCount);
      setTotalDepositsCount(depositsCount);
    } catch (err) {
      console.error("Erro ao carregar depósitos:", err);
      showToast("Erro ao carregar dados. Verifique a ligação.");
    } finally {
      setLoading(false);
    }
  }

  async function loadWithdrawals() {
    setLoading(true);
    try {
      const wlist: PendingWithdrawal[] = [];
      if (!isMockMode) {
        const snap = await get(ref(rtdb, "usuarios"));
        if (snap.exists()) {
          const data = snap.val() as Record<string, Record<string, unknown>>;
          Object.entries(data).forEach(([uid, raw]) => {
            const nome  = (raw.nome as string)  ?? "Utilizador";
            const email = (raw.email as string) ?? uid;
            const id    = (raw.id as string)    ?? uid.slice(0, 9).toUpperCase();
            const lvRaw = raw.levantamentos as Record<string, Withdrawal> | null;
            if (lvRaw) {
              Object.entries(lvRaw).forEach(([fbKey, w]) => {
                const match = withdrawalFilter === "pending" ? w.status === "pendente" : true;
                if (match) {
                  wlist.push({ userEmail: email, userName: nome, userId: id, userUid: uid, withdrawal: w, withdrawalFirebaseKey: fbKey });
                }
              });
            }
          });
        }
      }
      wlist.sort((a, b) => new Date(b.withdrawal.date).getTime() - new Date(a.withdrawal.date).getTime());
      setWithdrawalList(wlist);
    } catch (err) {
      console.error("Erro ao carregar levantamentos:", err);
      showToast("Erro ao carregar levantamentos.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (authed) loadPending(); }, [authed, activeFilter]);
  useEffect(() => { if (authed) loadWithdrawals(); }, [authed, withdrawalFilter]);

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

  async function approveDeposit(item: PendingDeposit) {
    if (processingId) return; // evita duplo clique
    setProcessingId(item.deposit.id);

    const approvedAt = new Date().toISOString();
    const amount = Number(item.deposit.amount || 0);
    const txId = `dep_${item.deposit.id}_${Date.now()}`;
    const newTx: Transaction = {
      id: txId,
      type: "credit",
      amount,
      description: `Depósito aprovado via ${item.deposit.method}`,
      date: approvedAt,
    };

    try {
      if (!isMockMode && item.userUid) {
        // 1. Verifica o status actual directamente pelo caminho exacto (usando a chave real do Firebase)
        const depSnap = await get(ref(rtdb, `usuarios/${item.userUid}/depositos/${item.depositFirebaseKey}`));
        if (!depSnap.exists()) {
          showToast("⚠️ Depósito não encontrado no Firebase.");
          setProcessingId(null);
          return;
        }
        const depData = depSnap.val() as Deposit;
        if (depData.status === "confirmado") {
          showToast("Este depósito já foi aprovado anteriormente.");
          setProcessingId(null);
          return;
        }

        // 2. Escreve em paralelo: status do depósito + transacção (granular, sem ler o objeto inteiro)
        await Promise.all([
          update(ref(rtdb, `usuarios/${item.userUid}/depositos/${item.depositFirebaseKey}`), {
            status: "confirmado",
            approvedAt,
          }),
          set(ref(rtdb, `usuarios/${item.userUid}/transacoes/${txId}`), newTx),
        ]);

        // 3. Actualiza o saldo atomicamente
        await runTransaction(ref(rtdb, `usuarios/${item.userUid}/saldo`), (current) =>
          Number(current || 0) + amount
        );
      }

      // 4. Actualiza o localStorage como cache
      const users = loadUsers();
      const u = users[item.userEmail];
      if (u) {
        u.balance = Number(u.balance || 0) + amount;
        u.deposits = (u.deposits ?? []).map(d =>
          d.id === item.deposit.id ? { ...d, status: "confirmado" as const, approvedAt } : d
        );
        u.transactions = [newTx, ...(u.transactions ?? [])];
        users[item.userEmail] = u;
        saveUsers(users);
      }

      // 5. Update optimista: remove da lista de pendentes / muda status na lista "todos"
      setPendingList(prev =>
        activeFilter === "pending"
          ? prev.filter(p => p.deposit.id !== item.deposit.id)
          : prev.map(p =>
              p.deposit.id === item.deposit.id
                ? { ...p, deposit: { ...p.deposit, status: "confirmado" as const, approvedAt } }
                : p
            )
      );

      showToast(`✅ ${amount.toLocaleString("pt-MZ")} MT aprovados e creditados!`);
    } catch (err) {
      console.error("Erro ao aprovar depósito:", err);
      showToast("❌ Erro ao aprovar. Verifique a ligação e tente novamente.");
    } finally {
      setProcessingId(null);
    }
  }

  async function rejectDeposit(item: PendingDeposit) {
    if (processingId) return; // evita duplo clique
    setProcessingId(item.deposit.id);

    try {
      if (!isMockMode && item.userUid) {
        // Verifica status actual antes de rejeitar
        const depSnap = await get(ref(rtdb, `usuarios/${item.userUid}/depositos/${item.depositFirebaseKey}`));
        if (depSnap.exists()) {
          const depData = depSnap.val() as Deposit;
          if (depData.status !== "pendente") {
            showToast("Este depósito já foi processado.");
            setProcessingId(null);
            return;
          }
          // Actualiza só o campo status (granular)
          await update(ref(rtdb, `usuarios/${item.userUid}/depositos/${item.depositFirebaseKey}`), {
            status: "rejeitado",
            rejectedAt: new Date().toISOString(),
          });
        }
      }

      // Actualiza localStorage
      const users = loadUsers();
      const u = users[item.userEmail];
      if (u) {
        u.deposits = (u.deposits ?? []).map(d =>
          d.id === item.deposit.id ? { ...d, status: "rejeitado" as const } : d
        );
        users[item.userEmail] = u;
        saveUsers(users);
      }

      // Update optimista da lista
      setPendingList(prev =>
        activeFilter === "pending"
          ? prev.filter(p => p.deposit.id !== item.deposit.id)
          : prev.map(p =>
              p.deposit.id === item.deposit.id
                ? { ...p, deposit: { ...p.deposit, status: "rejeitado" as const } }
                : p
            )
      );

      showToast("❌ Depósito rejeitado e arquivado.");
    } catch (err) {
      console.error("Erro ao rejeitar depósito:", err);
      showToast("❌ Erro ao rejeitar. Verifique a ligação e tente novamente.");
    } finally {
      setProcessingId(null);
    }
  }

  async function approveWithdrawal(item: PendingWithdrawal) {
    if (processingWithdrawalId) return;
    setProcessingWithdrawalId(item.withdrawal.id);
    try {
      if (!isMockMode && item.userUid) {
        const snap = await get(ref(rtdb, `usuarios/${item.userUid}/levantamentos/${item.withdrawalFirebaseKey}`));
        if (!snap.exists()) { showToast("⚠️ Levantamento não encontrado."); return; }
        const w = snap.val() as Withdrawal;
        if (w.status !== "pendente") { showToast("Este levantamento já foi processado."); return; }
        await update(ref(rtdb, `usuarios/${item.userUid}/levantamentos/${item.withdrawalFirebaseKey}`), {
          status: "processado", processedAt: new Date().toISOString(),
        });
      }
      setWithdrawalList(prev =>
        withdrawalFilter === "pending"
          ? prev.filter(p => p.withdrawal.id !== item.withdrawal.id)
          : prev.map(p => p.withdrawal.id === item.withdrawal.id
              ? { ...p, withdrawal: { ...p.withdrawal, status: "processado" as const } } : p)
      );
      showToast(`✅ Levantamento de ${item.withdrawal.net.toFixed(2)} MT marcado como processado!`);
    } catch (err) {
      console.error("Erro ao aprovar levantamento:", err);
      showToast("❌ Erro ao processar. Tente novamente.");
    } finally {
      setProcessingWithdrawalId(null);
    }
  }

  async function rejectWithdrawal(item: PendingWithdrawal) {
    if (processingWithdrawalId) return;
    setProcessingWithdrawalId(item.withdrawal.id);
    try {
      if (!isMockMode && item.userUid) {
        const snap = await get(ref(rtdb, `usuarios/${item.userUid}/levantamentos/${item.withdrawalFirebaseKey}`));
        if (!snap.exists()) { showToast("⚠️ Levantamento não encontrado."); return; }
        const w = snap.val() as Withdrawal;
        if (w.status !== "pendente") { showToast("Este levantamento já foi processado."); return; }
        // Rejeita e devolve o valor ao saldo do utilizador
        await Promise.all([
          update(ref(rtdb, `usuarios/${item.userUid}/levantamentos/${item.withdrawalFirebaseKey}`), {
            status: "rejeitado", rejectedAt: new Date().toISOString(),
          }),
          runTransaction(ref(rtdb, `usuarios/${item.userUid}/saldo`), (cur) =>
            Number(cur || 0) + item.withdrawal.amount
          ),
        ]);
      }
      setWithdrawalList(prev =>
        withdrawalFilter === "pending"
          ? prev.filter(p => p.withdrawal.id !== item.withdrawal.id)
          : prev.map(p => p.withdrawal.id === item.withdrawal.id
              ? { ...p, withdrawal: { ...p.withdrawal, status: "rejeitado" as const } } : p)
      );
      showToast(`↩️ Levantamento rejeitado. ${item.withdrawal.amount.toLocaleString("pt-MZ")} MT devolvidos ao utilizador.`);
    } catch (err) {
      console.error("Erro ao rejeitar levantamento:", err);
      showToast("❌ Erro ao rejeitar. Tente novamente.");
    } finally {
      setProcessingWithdrawalId(null);
    }
  }

  const totalPending = pendingList.filter(p => p.deposit.status === "pendente").length;
  const totalAmount  = pendingList.filter(p => p.deposit.status === "pendente").reduce((s, p) => s + p.deposit.amount, 0);
  const totalWithdrawalsPending = withdrawalList.filter(w => w.withdrawal.status === "pendente").length;

  function statusBadge(status: Deposit["status"]) {
    if (status === "pendente")   return { bg: "rgba(250,204,21,0.15)",  color: "#facc15", border: "rgba(250,204,21,0.3)",  label: "⏳ Pendente" };
    if (status === "rejeitado")  return { bg: "rgba(239,68,68,0.12)",   color: "#f87171", border: "rgba(239,68,68,0.3)",   label: "❌ Rejeitado" };
    return                              { bg: "rgba(163,230,53,0.12)",  color: "#a3e635", border: "rgba(163,230,53,0.25)", label: "✅ Confirmado" };
  }

  function wBadge(status: Withdrawal["status"]) {
    if (status === "pendente")   return { bg: "rgba(250,204,21,0.15)", color: "#facc15", border: "rgba(250,204,21,0.3)",  label: "⏳ Pendente" };
    if (status === "rejeitado")  return { bg: "rgba(239,68,68,0.12)",  color: "#f87171", border: "rgba(239,68,68,0.3)",   label: "❌ Rejeitado" };
    return                              { bg: "rgba(163,230,53,0.12)", color: "#a3e635", border: "rgba(163,230,53,0.25)", label: "✅ Processado" };
  }

  // ── Password gate ──
  if (!authed) {
    return (
      <div className="app-shell" style={{ background: "#0b0f19" }}>
        {toast && <Toast msg={toast} />}
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
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginBottom: 32, textAlign: "center", lineHeight: 1.5 }}>
            Acesso restrito ao administrador.<br />Introduza a senha para continuar.
          </p>

          <form onSubmit={handleLogin} style={{ width: "100%" }}>
            <div style={{ marginBottom: 16, position: "relative" }}>
              <input
                className="bloxs-input"
                type={showPwd ? "text" : "password"}
                placeholder="Senha de administrador"
                value={pwd}
                onChange={e => setPwd(e.target.value)}
                autoFocus
                style={{ paddingRight: 48 }}
              />
              <button type="button" onClick={() => setShowPwd(p => !p)}
                style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.4)", fontSize: 18 }}>
                {showPwd ? "🙈" : "👁"}
              </button>
            </div>
            {pwdError && (
              <p style={{ color: "#f87171", fontSize: 13, marginBottom: 14, textAlign: "center" }}>{pwdError}</p>
            )}
            <button className="btn-primary" type="submit">Entrar no Painel</button>
          </form>
        </div>
      </div>
    );
  }

  // ── Admin dashboard ──
  return (
    <div className="app-shell" style={{ background: "#0b0f19" }}>
      {toast && <Toast msg={toast} />}

      {/* Header */}
      <div className="top-header">
        <button onClick={onClose} style={{ background: "rgba(255,255,255,0.07)", border: "none", borderRadius: 10, padding: "8px 14px", cursor: "pointer", color: "rgba(255,255,255,0.7)", fontSize: 13, fontWeight: 600 }}>
          ← Sair
        </button>
        <span style={{ fontWeight: 800, fontSize: 15 }}>🔐 Admin</span>
        <button onClick={() => { loadPending(); loadWithdrawals(); }} style={{ background: "rgba(163,230,53,0.1)", border: "1px solid rgba(163,230,53,0.2)", borderRadius: 10, padding: "7px 12px", cursor: "pointer", color: "#a3e635", fontSize: 12, fontWeight: 600 }}>
          ↻ Refresh
        </button>
      </div>

      <div className="scrollable" style={{ flex: 1 }}>
        {/* Summary cards */}
        <div style={{ display: "flex", gap: 10, margin: "16px 16px 0" }}>
          <div className="glass-card" style={{ flex: 1, padding: "12px 14px", textAlign: "center" }}>
            <p style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 3 }}>DEP. PENDENTES</p>
            <p style={{ fontSize: 24, fontWeight: 900, color: "#facc15", lineHeight: 1 }}>{totalPending}</p>
          </div>
          <div className="glass-card" style={{ flex: 1, padding: "12px 14px", textAlign: "center" }}>
            <p style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 3 }}>LEV. PENDENTES</p>
            <p style={{ fontSize: 24, fontWeight: 900, color: "#fb923c", lineHeight: 1 }}>{totalWithdrawalsPending}</p>
          </div>
          <div className="glass-card" style={{ flex: 1, padding: "12px 14px", textAlign: "center" }}>
            <p style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 3 }}>UTILIZADORES</p>
            <p style={{ fontSize: 24, fontWeight: 900, color: "#a3e635", lineHeight: 1 }}>{loading ? "…" : allUsersCount}</p>
          </div>
        </div>

        {/* Main tab switcher: Depósitos / Levantamentos */}
        <div style={{ display: "flex", margin: "12px 16px 0", background: "rgba(255,255,255,0.04)", borderRadius: 14, padding: 4, gap: 4 }}>
          {([
            ["depositos",    "💰 Depósitos",     totalPending],
            ["levantamentos","💸 Levantamentos",  totalWithdrawalsPending],
          ] as const).map(([id, label, count]) => (
            <button key={id} onClick={() => setAdminTab(id)}
              style={{
                flex: 1, padding: "10px 4px", borderRadius: 11, border: "none", cursor: "pointer",
                fontWeight: 700, fontSize: 13, transition: "all 0.2s", position: "relative",
                background: adminTab === id ? "linear-gradient(135deg, #a3e635, #84cc16)" : "transparent",
                color: adminTab === id ? "#0b0f19" : "rgba(255,255,255,0.45)",
              }}>
              {label}
              {count > 0 && (
                <span style={{
                  position: "absolute", top: 4, right: 8,
                  background: adminTab === id ? "#0b0f19" : "#facc15",
                  color: adminTab === id ? "#a3e635" : "#0b0f19",
                  borderRadius: 20, fontSize: 9, fontWeight: 900, padding: "1px 5px", lineHeight: 1.4,
                }}>{count}</span>
              )}
            </button>
          ))}
        </div>

        {/* ── TAB: DEPÓSITOS ── */}
        {adminTab === "depositos" && (
          <>
            {/* Filter toggle */}
            <div style={{ display: "flex", margin: "10px 16px 0", background: "rgba(255,255,255,0.04)", borderRadius: 12, padding: 4 }}>
              {([["pending", "⏳ Pendentes"], ["all", "📋 Todos"]] as const).map(([id, label]) => (
                <button key={id} onClick={() => setActiveFilter(id)}
                  style={{
                    flex: 1, padding: "8px", borderRadius: 10, border: "none", cursor: "pointer",
                    fontWeight: 700, fontSize: 12, transition: "all 0.2s",
                    background: activeFilter === id ? "#facc15" : "transparent",
                    color: activeFilter === id ? "#0b0f19" : "rgba(255,255,255,0.4)",
                  }}>
                  {label}
                </button>
              ))}
            </div>

            {/* Deposit list */}
            <div style={{ padding: "14px 16px" }}>
              {loading ? (
                <div style={{ textAlign: "center", padding: "40px 0", color: "rgba(255,255,255,0.3)" }}>A carregar…</div>
              ) : pendingList.length === 0 ? (
                <div style={{ textAlign: "center", padding: "48px 0", color: "rgba(255,255,255,0.3)" }}>
                  <p style={{ fontSize: 40, marginBottom: 12 }}>✅</p>
                  <p style={{ fontSize: 15, fontWeight: 600 }}>
                    {activeFilter === "pending" ? "Nenhum depósito pendente!" : "Sem depósitos registados."}
                  </p>
                </div>
              ) : (
                pendingList.map(item => {
                  const isPending = item.deposit.status === "pendente";
                  const isProcessing = processingId === item.deposit.id;
                  const badge = statusBadge(item.deposit.status);
                  const borderColor = isPending ? "rgba(250,204,21,0.25)" : item.deposit.status === "rejeitado" ? "rgba(239,68,68,0.2)" : "rgba(163,230,53,0.15)";
                  return (
                    <div key={item.deposit.id} className="glass-card" style={{ padding: "16px", marginBottom: 12, border: `1px solid ${borderColor}`, opacity: isProcessing ? 0.6 : 1, transition: "opacity 0.3s" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20, background: badge.bg, color: badge.color, border: `1px solid ${badge.border}` }}>
                          {badge.label}
                        </span>
                        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>
                          {new Date(item.deposit.date).toLocaleDateString("pt-MZ", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                        <div style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0, background: "linear-gradient(135deg, #a3e635, #84cc16)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, color: "#0b0f19", fontSize: 14 }}>
                          {item.userName[0]?.toUpperCase() ?? "?"}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontWeight: 700, fontSize: 14, marginBottom: 1 }}>{item.userName}</p>
                          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.userEmail}</p>
                        </div>
                        <span className="badge" style={{ flexShrink: 0 }}>{item.userId}</span>
                      </div>
                      <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: "12px 14px", marginBottom: 14 }}>
                        {[
                          ["Método", item.deposit.method, item.deposit.method === "M-Pesa" ? "#a3e635" : "#facc15"],
                          ["Valor", `${item.deposit.amount.toLocaleString("pt-MZ")} MT`, "#a3e635"],
                          ["ID Transação", item.deposit.txId, "rgba(255,255,255,0.75)"],
                        ].map(([k, v, c]) => (
                          <div key={k as string} style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>{k}</span>
                            <span style={{ fontSize: 12, fontWeight: 700, color: c as string }}>{v}</span>
                          </div>
                        ))}
                      </div>
                      {isPending ? (
                        <div style={{ display: "flex", gap: 8 }}>
                          <button onClick={() => approveDeposit(item)} disabled={isProcessing}
                            style={{ flex: 2, padding: "12px", borderRadius: 12, border: "none", background: isProcessing ? "rgba(163,230,53,0.3)" : "linear-gradient(135deg, #a3e635, #84cc16)", color: "#0b0f19", fontWeight: 800, fontSize: 13, cursor: isProcessing ? "not-allowed" : "pointer" }}>
                            {isProcessing ? "A processar…" : "✅ Aprovar Depósito"}
                          </button>
                          <button onClick={() => rejectDeposit(item)} disabled={isProcessing}
                            style={{ flex: 1, padding: "12px", borderRadius: 12, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.08)", color: "#f87171", fontWeight: 700, fontSize: 13, cursor: isProcessing ? "not-allowed" : "pointer" }}>
                            ❌ Rejeitar
                          </button>
                        </div>
                      ) : (
                        <div style={{ textAlign: "center", padding: "6px", borderRadius: 10, background: item.deposit.status === "rejeitado" ? "rgba(239,68,68,0.06)" : "rgba(163,230,53,0.05)" }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: item.deposit.status === "rejeitado" ? "#f87171" : "#a3e635" }}>
                            {item.deposit.status === "rejeitado" ? "❌ Rejeitado e arquivado" : "✅ Aprovado — saldo actualizado"}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}

        {/* ── TAB: LEVANTAMENTOS ── */}
        {adminTab === "levantamentos" && (
          <>
            {/* Filter toggle */}
            <div style={{ display: "flex", margin: "10px 16px 0", background: "rgba(255,255,255,0.04)", borderRadius: 12, padding: 4 }}>
              {([["pending", "⏳ Pendentes"], ["all", "📋 Todos"]] as const).map(([id, label]) => (
                <button key={id} onClick={() => setWithdrawalFilter(id)}
                  style={{ flex: 1, padding: "8px", borderRadius: 10, border: "none", cursor: "pointer", fontWeight: 700, fontSize: 12, transition: "all 0.2s", background: withdrawalFilter === id ? "#fb923c" : "transparent", color: withdrawalFilter === id ? "#0b0f19" : "rgba(255,255,255,0.4)" }}>
                  {label}
                </button>
              ))}
            </div>

            {/* Withdrawal list */}
            <div style={{ padding: "14px 16px" }}>
              {loading ? (
                <div style={{ textAlign: "center", padding: "40px 0", color: "rgba(255,255,255,0.3)" }}>A carregar…</div>
              ) : withdrawalList.length === 0 ? (
                <div style={{ textAlign: "center", padding: "48px 0", color: "rgba(255,255,255,0.3)" }}>
                  <p style={{ fontSize: 40, marginBottom: 12 }}>💸</p>
                  <p style={{ fontSize: 15, fontWeight: 600 }}>
                    {withdrawalFilter === "pending" ? "Nenhum levantamento pendente!" : "Sem levantamentos registados."}
                  </p>
                </div>
              ) : (
                withdrawalList.map(item => {
                  const isPending = item.withdrawal.status === "pendente";
                  const isProcessing = processingWithdrawalId === item.withdrawal.id;
                  const badge = wBadge(item.withdrawal.status);
                  const borderColor = isPending ? "rgba(251,146,60,0.3)" : item.withdrawal.status === "rejeitado" ? "rgba(239,68,68,0.2)" : "rgba(163,230,53,0.15)";
                  return (
                    <div key={item.withdrawal.id} className="glass-card" style={{ padding: "16px", marginBottom: 12, border: `1px solid ${borderColor}`, opacity: isProcessing ? 0.6 : 1, transition: "opacity 0.3s" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20, background: badge.bg, color: badge.color, border: `1px solid ${badge.border}` }}>
                          {badge.label}
                        </span>
                        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>
                          {new Date(item.withdrawal.date).toLocaleDateString("pt-MZ", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                        <div style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0, background: "linear-gradient(135deg, #fb923c, #ea580c)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, color: "#fff", fontSize: 14 }}>
                          {item.userName[0]?.toUpperCase() ?? "?"}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontWeight: 700, fontSize: 14, marginBottom: 1 }}>{item.userName}</p>
                          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.userEmail}</p>
                        </div>
                        <span className="badge" style={{ flexShrink: 0 }}>{item.userId}</span>
                      </div>
                      <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: "12px 14px", marginBottom: 14 }}>
                        {[
                          ["Método",       item.withdrawal.method, item.withdrawal.method === "M-Pesa" ? "#a3e635" : "#facc15"],
                          ["Nº Telemóvel", item.withdrawal.phone,  "rgba(255,255,255,0.75)"],
                          ["Valor solicitado", `${item.withdrawal.amount.toLocaleString("pt-MZ")} MT`, "#fb923c"],
                          ["Taxa (10%)",    `−${item.withdrawal.fee.toFixed(2)} MT`,  "#f87171"],
                          ["Utilizador recebe", `${item.withdrawal.net.toFixed(2)} MT`, "#a3e635"],
                        ].map(([k, v, c]) => (
                          <div key={k as string} style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>{k}</span>
                            <span style={{ fontSize: 12, fontWeight: 700, color: c as string }}>{v}</span>
                          </div>
                        ))}
                      </div>
                      {isPending ? (
                        <div style={{ display: "flex", gap: 8 }}>
                          <button onClick={() => approveWithdrawal(item)} disabled={isProcessing}
                            style={{ flex: 2, padding: "12px", borderRadius: 12, border: "none", background: isProcessing ? "rgba(251,146,60,0.3)" : "linear-gradient(135deg, #fb923c, #ea580c)", color: "#fff", fontWeight: 800, fontSize: 13, cursor: isProcessing ? "not-allowed" : "pointer" }}>
                            {isProcessing ? "A processar…" : "✅ Confirmar Envio"}
                          </button>
                          <button onClick={() => rejectWithdrawal(item)} disabled={isProcessing}
                            style={{ flex: 1, padding: "12px", borderRadius: 12, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.08)", color: "#f87171", fontWeight: 700, fontSize: 13, cursor: isProcessing ? "not-allowed" : "pointer" }}>
                            ↩️ Devolver
                          </button>
                        </div>
                      ) : (
                        <div style={{ textAlign: "center", padding: "6px", borderRadius: 10, background: item.withdrawal.status === "rejeitado" ? "rgba(239,68,68,0.06)" : "rgba(163,230,53,0.05)" }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: item.withdrawal.status === "rejeitado" ? "#f87171" : "#a3e635" }}>
                            {item.withdrawal.status === "rejeitado" ? "↩️ Rejeitado — saldo devolvido" : "✅ Processado — enviado ao utilizador"}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}

        <div style={{ height: 24 }} />
      </div>
    </div>
  );
}

// ── Splash Screen ─────────────────────────────────────────────────────────────
function SplashScreen() {
  return (
    <div style={{ display: "flex", height: "100dvh", alignItems: "center", justifyContent: "center", background: "#0b0f19", flexDirection: "column", gap: 16 }}>
      <div style={{ width: 64, height: 64, borderRadius: 18, background: "linear-gradient(135deg, #a3e635, #84cc16)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 8px 32px rgba(163,230,53,0.3)" }}>
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
          <path d="M12 2L2 7l10 5 10-5-10-5z" fill="#0b0f19" />
          <path d="M2 17l10 5 10-5" stroke="#0b0f19" strokeWidth="2" strokeLinecap="round" />
          <path d="M2 12l10 5 10-5" stroke="#0b0f19" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>
      <p style={{ color: "#a3e635", fontWeight: 800, fontSize: 18, letterSpacing: "-0.5px" }}>
        Bloxs <span style={{ color: "white" }}>mz</span>
      </p>
      <div style={{ width: 28, height: 28, border: "3px solid rgba(163,230,53,0.2)", borderTopColor: "#a3e635", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("familias");
  const [authLoading, setAuthLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);

  useEffect(() => {
    if (isMockMode) {
      // Mostra o splash por 1,5s e depois apresenta o ecrã de login demo
      const t = setTimeout(() => setAuthLoading(false), 1500);
      return () => clearTimeout(t);
    }

    // Modo real: ouve o estado do Firebase Auth
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      setFirebaseUser(fbUser);
      if (fbUser) {
        setDataLoading(true);

        // Utilizador mínimo construído apenas com dados do Firebase Auth —
        // usado como fallback seguro se o Firestore falhar ou ainda não tiver o documento
        const fallbackUser: User = {
          id: fbUser.uid.slice(0, 9).toUpperCase(),
          name: fbUser.displayName ?? "Utilizador",
          email: fbUser.email ?? "",
          password: "", phone: "",
          balance: 0, retention: 0, retentionMax: 500,
          plans: {
            ferro: { owned: false, lastCollect: null },
            cox:   { owned: false, lastCollect: null },
            sc:    { owned: false, lastCollect: null },
          },
          transactions: [], withdrawals: [], deposits: [], teamMembers: [],
        };

        try {
          // Pequena espera para garantir que o set() do registo já terminou
          // antes de tentarmos ler o nó (evita race condition)
          await new Promise(r => setTimeout(r, 800));

          const snap = await get(ref(rtdb, `usuarios/${fbUser.uid}`));
          if (snap.exists()) {
            const data = snap.val();
            const merged: User = {
              id: data.id ?? fbUser.uid.slice(0, 9).toUpperCase(),
              name: data.nome ?? fbUser.displayName ?? "Utilizador",
              email: fbUser.email ?? "",
              password: "",
              phone: data.telefone ?? "",
              balance: data.saldo ?? 0,
              retention: data.retencao ?? 0,
              retentionMax: data.retencaoMax ?? 500,
              plans: {
                ferro: { owned: data.planos?.ferro?.ativo ?? false, lastCollect: data.planos?.ferro?.ultimaColeta ?? null },
                cox:   { owned: data.planos?.cox?.ativo   ?? false, lastCollect: data.planos?.cox?.ultimaColeta   ?? null },
                sc:    { owned: data.planos?.sc?.ativo    ?? false, lastCollect: data.planos?.sc?.ultimaColeta    ?? null },
              },
              transactions: data.transacoes ? Object.values(data.transacoes) : [],
              withdrawals:  data.levantamentos ? Object.values(data.levantamentos) : [],
              deposits:     data.depositos ? Object.values(data.depositos) : [],
              teamMembers:  data.equipa ? Object.values(data.equipa) : [],
            };
            setUser(merged);
            const users = loadUsers();
            users[fbUser.email!] = merged;
            saveUsers(users);
          } else {
            // Nó ainda não existe (race condition no registo)
            // usa cache local se disponível, senão o fallback com dados do Auth
            const users = loadUsers();
            const cached = fbUser.email ? users[fbUser.email] : null;
            setUser(cached ?? fallbackUser);
          }
        } catch {
          // RTDB falhou (sem internet, regras) — nunca voltar ao login
          const users = loadUsers();
          const cached = fbUser.email ? users[fbUser.email] : null;
          setUser(cached ?? fallbackUser);
        } finally {
          setDataLoading(false);
        }
      } else {
        setUser(null);
      }
      setAuthLoading(false);
    });
    return unsub;
  }, []);

  // Persiste as alterações: localStorage sempre, RTDB quando disponível
  const handleUpdate = useCallback((updated: User) => {
    setUser({ ...updated });
    const users = loadUsers();
    users[updated.email] = updated;
    saveUsers(users);
    if (!isMockMode && firebaseUser) {
      update(ref(rtdb, `usuarios/${firebaseUser.uid}`), {
        saldo: updated.balance,
        retencao: updated.retention,
        planos: {
          ferro: { ativo: updated.plans.ferro.owned, ultimaColeta: updated.plans.ferro.lastCollect },
          cox:   { ativo: updated.plans.cox.owned,   ultimaColeta: updated.plans.cox.lastCollect },
          sc:    { ativo: updated.plans.sc.owned,    ultimaColeta: updated.plans.sc.lastCollect },
        },
        transacoes:    updated.transactions,
        levantamentos: updated.withdrawals,
        depositos:     updated.deposits,
        equipa:        updated.teamMembers,
        ultimoAcesso:  new Date().toISOString(),
      }).catch(() => {});
    }
  }, [firebaseUser]);

  async function handleLogout() {
    if (!isMockMode) await signOut(auth);
    saveSession(null);
    setUser(null);
    setFirebaseUser(null);
    setActiveTab("familias");
  }

  // ── Splash ──
  if (authLoading || dataLoading) return <SplashScreen />;

  // ── Login ──
  if (!user) {
    return (
      <Login
        isMockMode={isMockMode}
        onMockLogin={() => setUser({ ...MOCK_USER })}
      />
    );
  }

  // ── Admin panel (overlay completo) ──
  if (showAdmin) {
    return <AdminDashboard onClose={() => setShowAdmin(false)} />;
  }

  // ── Dashboard ──
  return (
    <div className="app-shell">
      <DashboardHeader user={user} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>
        {activeTab === "familias" && <FamiliasTab user={user} onUpdate={handleUpdate} />}
        {activeTab === "financas" && <FinancasTab user={user} onUpdate={handleUpdate} />}
        {activeTab === "equipa"   && <EquipaTab   user={user} onUpdate={handleUpdate} />}
        {activeTab === "suporte"  && <SuporteTab />}
        {activeTab === "sobre"    && <SobreTab onAdminAccess={() => setShowAdmin(true)} />}
        <WhatsAppBtn />
      </div>
      <BottomNav active={activeTab} onChange={setActiveTab} onLogout={handleLogout} />
    </div>
  );
}
