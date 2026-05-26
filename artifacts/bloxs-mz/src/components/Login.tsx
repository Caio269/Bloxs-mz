import { useState, FormEvent } from "react";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  AuthError,
} from "firebase/auth";
import { ref, set, get, update, runTransaction, query as rtdbQuery, orderByChild, equalTo, push } from "firebase/database";
import { auth, rtdb } from "../firebase";

// ── Helpers ───────────────────────────────────────────────────────────────────
function mapFirebaseError(code: string): string {
  switch (code) {
    case "auth/email-already-in-use":
      return "Este email já está registado. Tente fazer login.";
    case "auth/invalid-email":
      return "Endereço de email inválido.";
    case "auth/weak-password":
      return "A palavra-passe deve ter pelo menos 6 caracteres.";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Email ou palavra-passe incorretos.";
    case "auth/too-many-requests":
      return "Muitas tentativas. Aguarde um momento e tente novamente.";
    case "auth/network-request-failed":
      return "Sem ligação à internet. Verifique a sua rede.";
    default:
      return "Ocorreu um erro. Tente novamente.";
  }
}

type Mode = "login" | "register";

interface Props {
  onSuccess?: () => void;
  isMockMode?: boolean;
  onMockLogin?: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function Login({ onSuccess, isMockMode = false, onMockLogin }: Props) {
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  function switchMode(m: Mode) {
    setMode(m);
    setError("");
    setSuccessMsg("");
    setName("");
    setEmail("");
    setPassword("");
  }

  // Modo demo: qualquer credencial entra directamente com dados simulados
  async function handleMockSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (mode === "register" && !name.trim()) {
      setError("Por favor insira o seu nome completo.");
      return;
    }
    if (!email.trim()) { setError("Por favor insira o seu email."); return; }
    setLoading(true);
    await new Promise(r => setTimeout(r, 1200));
    setLoading(false);
    onMockLogin?.();
  }

  async function handleRegister(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSuccessMsg("");

    if (!name.trim()) { setError("Por favor insira o seu nome completo."); return; }
    if (!email.trim()) { setError("Por favor insira o seu email."); return; }
    if (password.length < 6) { setError("A palavra-passe deve ter pelo menos 6 caracteres."); return; }

    setLoading(true);
    try {
      const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
      const firebaseUser = credential.user;

      await updateProfile(firebaseUser, { displayName: name.trim() });

      await set(ref(rtdb, `usuarios/${firebaseUser.uid}`), {
        uid: firebaseUser.uid,
        id: firebaseUser.uid.slice(0, 9).toUpperCase(),
        nome: name.trim(),
        email: email.trim().toLowerCase(),
        saldo: 0,
        retencao: 0,
        retencaoMax: 500,
        planos: {
          ferro: { ativo: false, ultimaColeta: null },
          cox:   { ativo: false, ultimaColeta: null },
          sc:    { ativo: false, ultimaColeta: null },
        },
        transacoes: [],
        levantamentos: [],
        depositos: [],
        equipa: [],
        criadoEm: new Date().toISOString(),
        ultimoAcesso: new Date().toISOString(),
      });

      // ── Bónus de referência ──────────────────────────────────────────────────
      // Se o novo utilizador veio de um link de convite, credita +50 MT ao padrinho
      const padrinhoID = localStorage.getItem("padrinhoID");
      if (padrinhoID) {
        try {
          // Procura o padrinho pelo ID no Realtime Database
          const q = rtdbQuery(ref(rtdb, "usuarios"), orderByChild("id"), equalTo(padrinhoID));
          const padrinhoSnap = await get(q);

          if (padrinhoSnap.exists()) {
            const padrinhoUid = Object.keys(padrinhoSnap.val())[0];
            const padrinhoData: any = Object.values(padrinhoSnap.val())[0];

            const temPlanoAtivo =
              padrinhoData?.planos?.ferro?.ativo ||
              padrinhoData?.planos?.cox?.ativo ||
              padrinhoData?.planos?.sc?.ativo;

            if (temPlanoAtivo) {
              await runTransaction(ref(rtdb, `usuarios/${padrinhoUid}/saldo`), (saldoAtual) => {
                return Number(saldoAtual || 0) + 50;
              });

              await push(ref(rtdb, `usuarios/${padrinhoUid}/equipa`), {
                name: name.trim(),
                joinDate: new Date().toISOString(),
                plan: "Novo membro",
              });

              await push(ref(rtdb, `usuarios/${padrinhoUid}/transacoes`), {
                id: `ref_${Date.now()}`,
                type: "credit",
                amount: 50,
                description: `Bónus de referência — ${name.trim()}`,
                date: new Date().toISOString(),
              });
            }

            localStorage.removeItem("padrinhoID");
          }
        } catch {
          // Falha silenciosa — o registo do utilizador já foi bem-sucedido
          // o bónus pode ser aplicado manualmente pelo admin se necessário
          localStorage.removeItem("padrinhoID");
        }
      }
      // ────────────────────────────────────────────────────────────────────────

      setSuccessMsg("Conta criada com sucesso! Bem-vindo ao Bloxs mz 🎉");
      onSuccess?.();
    } catch (err) {
      const e = err as AuthError;
      setError(mapFirebaseError(e.code));
    } finally {
      setLoading(false);
    }
  }

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSuccessMsg("");

    if (!email.trim() || !password) { setError("Preencha o email e a palavra-passe."); return; }

    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      onSuccess?.();
    } catch (err) {
      const e = err as AuthError;
      setError(mapFirebaseError(e.code));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app-shell" style={{ justifyContent: "center", background: "#0b0f19" }}>
      {/* Background glow */}
      <div style={{
        position: "absolute", top: -120, left: "50%", transform: "translateX(-50%)",
        width: 340, height: 340,
        background: "radial-gradient(circle, rgba(163,230,53,0.07) 0%, transparent 70%)",
        pointerEvents: "none",
      }} />

      <div className="scrollable" style={{ flex: 1, padding: "40px 24px 32px" }}>

        {/* ── Logo ── */}
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{
            width: 76, height: 76, borderRadius: 22,
            background: "linear-gradient(135deg, #a3e635 0%, #65a30d 100%)",
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 18px",
            boxShadow: "0 0 0 1px rgba(163,230,53,0.3), 0 12px 40px rgba(163,230,53,0.25)",
          }}>
            <svg width="38" height="38" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L2 7l10 5 10-5-10-5z" fill="#0b0f19" />
              <path d="M2 17l10 5 10-5" stroke="#0b0f19" strokeWidth="2" strokeLinecap="round" />
              <path d="M2 12l10 5 10-5" stroke="#0b0f19" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
          <h1 style={{ fontSize: 30, fontWeight: 900, letterSpacing: "-1px", lineHeight: 1 }}>
            Bloxs <span style={{ color: "#a3e635" }}>mz</span>
          </h1>
          <p style={{ color: "rgba(255,255,255,0.38)", fontSize: 13, marginTop: 8, fontWeight: 500 }}>
            Plataforma de Gestão Financeira
          </p>
        </div>

        {/* ── Mode toggle ── */}
        <div style={{
          display: "flex", background: "rgba(255,255,255,0.05)",
          borderRadius: 14, padding: 4, marginBottom: 28,
          border: "1px solid rgba(255,255,255,0.06)",
        }}>
          {(["login", "register"] as Mode[]).map(m => (
            <button
              key={m}
              onClick={() => switchMode(m)}
              style={{
                flex: 1, padding: "11px", borderRadius: 11,
                border: "none", cursor: "pointer",
                fontWeight: 700, fontSize: 14, transition: "all 0.2s",
                background: mode === m
                  ? "linear-gradient(135deg, #a3e635, #84cc16)"
                  : "transparent",
                color: mode === m ? "#0b0f19" : "rgba(255,255,255,0.45)",
                boxShadow: mode === m ? "0 4px 12px rgba(163,230,53,0.25)" : "none",
              }}
            >
              {m === "login" ? "Entrar" : "Criar Conta"}
            </button>
          ))}
        </div>

        {/* ── Banner modo demo ── */}
        {isMockMode && (
          <div style={{
            background: "linear-gradient(135deg, rgba(250,204,21,0.1), rgba(250,204,21,0.05))",
            border: "1px solid rgba(250,204,21,0.3)",
            borderRadius: 14, padding: "12px 16px", marginBottom: 20,
            display: "flex", alignItems: "flex-start", gap: 10,
          }}>
            <span style={{ fontSize: 18, flexShrink: 0 }}>🧪</span>
            <div>
              <p style={{ fontSize: 12, fontWeight: 700, color: "#facc15", marginBottom: 3 }}>
                Modo de Demonstração
              </p>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", lineHeight: 1.5 }}>
                Firebase ainda não configurado. Usa qualquer email para explorar o app com dados simulados.
              </p>
            </div>
          </div>
        )}

        {/* ── Form ── */}
        <form onSubmit={isMockMode ? handleMockSubmit : (mode === "login" ? handleLogin : handleRegister)}>

          {mode === "register" && (
            <Field label="Nome completo">
              <input
                className="bloxs-input"
                type="text"
                placeholder="João Silva"
                autoComplete="name"
                value={name}
                onChange={e => setName(e.target.value)}
                disabled={loading}
              />
            </Field>
          )}

          <Field label="Email">
            <input
              className="bloxs-input"
              type="email"
              placeholder="exemplo@email.com"
              autoComplete={mode === "login" ? "username" : "email"}
              value={email}
              onChange={e => setEmail(e.target.value)}
              disabled={loading}
            />
          </Field>

          <Field label="Palavra-passe" style={{ marginBottom: 8 }}>
            <div style={{ position: "relative" }}>
              <input
                className="bloxs-input"
                type={showPassword ? "text" : "password"}
                placeholder="••••••••"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                value={password}
                onChange={e => setPassword(e.target.value)}
                disabled={loading}
                style={{ paddingRight: 48 }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(p => !p)}
                style={{
                  position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)",
                  background: "none", border: "none", cursor: "pointer",
                  color: "rgba(255,255,255,0.4)", fontSize: 18, lineHeight: 1,
                }}
                tabIndex={-1}
              >
                {showPassword ? "🙈" : "👁"}
              </button>
            </div>
          </Field>

          {mode === "register" && (
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginBottom: 20, marginTop: 4, paddingLeft: 2 }}>
              Mínimo de 6 caracteres
            </p>
          )}

          {/* Error */}
          {error && (
            <div style={{
              background: "rgba(239,68,68,0.09)", border: "1px solid rgba(239,68,68,0.25)",
              borderRadius: 12, padding: "12px 14px", marginBottom: 16,
              display: "flex", alignItems: "flex-start", gap: 8,
            }}>
              <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>⚠️</span>
              <p style={{ color: "#fca5a5", fontSize: 13, lineHeight: 1.5 }}>{error}</p>
            </div>
          )}

          {/* Success */}
          {successMsg && (
            <div style={{
              background: "rgba(163,230,53,0.08)", border: "1px solid rgba(163,230,53,0.25)",
              borderRadius: 12, padding: "12px 14px", marginBottom: 16,
              display: "flex", alignItems: "center", gap: 8,
            }}>
              <span style={{ fontSize: 16 }}>✅</span>
              <p style={{ color: "#a3e635", fontSize: 13, lineHeight: 1.5 }}>{successMsg}</p>
            </div>
          )}

          {/* Submit */}
          <button
            className="btn-primary"
            type="submit"
            disabled={loading}
            style={{ marginTop: mode === "login" ? 20 : 0, position: "relative" }}
          >
            {loading ? (
              <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                <Spinner /> {mode === "login" ? "A entrar…" : "A criar conta…"}
              </span>
            ) : (
              mode === "login" ? "Entrar na Conta" : "Criar Conta Grátis"
            )}
          </button>
        </form>

        {/* ── Divider ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "24px 0" }}>
          <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.07)" }} />
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.25)", whiteSpace: "nowrap" }}>
            {mode === "login" ? "Ainda não tens conta?" : "Já tens conta?"}
          </span>
          <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.07)" }} />
        </div>

        <button
          className="btn-outline"
          onClick={() => switchMode(mode === "login" ? "register" : "login")}
          disabled={loading}
        >
          {mode === "login" ? "Criar Conta Grátis" : "Entrar na Conta"}
        </button>

        {/* ── Badges ── */}
        <div style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 28 }}>
          {["🔒 Seguro", "🇲🇿 Moçambique", "💎 Grátis"].map((b, i) => (
            <span key={i} style={{ fontSize: 11, color: "rgba(255,255,255,0.28)", fontWeight: 500 }}>{b}</span>
          ))}
        </div>

        <p style={{ textAlign: "center", color: "rgba(255,255,255,0.15)", fontSize: 11, marginTop: 20 }}>
          Bloxs mz © 2025 · Todos os direitos reservados
        </p>
      </div>
    </div>
  );
}

// ── Small helpers ─────────────────────────────────────────────────────────────
function Field({
  label,
  children,
  style,
}: {
  label: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div style={{ marginBottom: 14, ...style }}>
      <label style={{
        fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.45)",
        marginBottom: 7, display: "block", letterSpacing: "0.2px",
      }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function Spinner() {
  return (
    <span style={{
      width: 16, height: 16, border: "2px solid rgba(11,15,25,0.3)",
      borderTopColor: "#0b0f19", borderRadius: "50%",
      display: "inline-block",
      animation: "spin 0.7s linear infinite",
    }} />
  );
}
