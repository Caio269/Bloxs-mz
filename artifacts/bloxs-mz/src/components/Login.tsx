import { useState, FormEvent } from "react";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  AuthError,
} from "firebase/auth";
import { ref, set, get, update, runTransaction, query as rtdbQuery, orderByChild, equalTo } from "firebase/database";
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

    // Lê o padrinhoID ANTES de qualquer operação assíncrona,
    // para que nenhuma race condition o possa apagar do localStorage.
    const padrinhoID = localStorage.getItem("padrinhoID")?.toUpperCase().trim() || null;

    setLoading(true);
    try {
      const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
      const firebaseUser = credential.user;
      const newUserId = firebaseUser.uid.slice(0, 9).toUpperCase();

      await updateProfile(firebaseUser, { displayName: name.trim() });

      const now = new Date().toISOString();
      await set(ref(rtdb, `usuarios/${firebaseUser.uid}`), {
        uid: firebaseUser.uid,
        id: newUserId,
        nome: name.trim(),
        email: email.trim().toLowerCase(),
        saldo: 0,
        retencao: 0,
        retencaoMax: 500,
        planos: {
          estagiario: { ativo: true, ultimaColeta: null, dataInicio: now },
          ferro: { ativo: false, ultimaColeta: null, dataInicio: null },
          cox:   { ativo: false, ultimaColeta: null, dataInicio: null },
          sc:    { ativo: false, ultimaColeta: null, dataInicio: null },
        },
        transacoes: {},
        levantamentos: {},
        depositos: {},
        equipa: {},
        ...(padrinhoID ? { padrinhoId: padrinhoID } : {}),
        criadoEm: now,
        ultimoAcesso: now,
      });

      // ── Bónus de referência ──────────────────────────────────────────────────
      // Credita +50 MT ao padrinho imediatamente após o cadastro do indicado,
      // sem exigir depósito ou plano activo.
      if (padrinhoID && padrinhoID !== newUserId) {
        await creditarBonusPadrinho({
          padrinhoID,
          indicadoUid: firebaseUser.uid,
          indicadoNome: name.trim(),
        });
      }
      // ────────────────────────────────────────────────────────────────────────

      localStorage.removeItem("padrinhoID");
      setSuccessMsg("Conta criada com sucesso! Bem-vindo ao Bloxs mz 🎉");
      onSuccess?.();
    } catch (err) {
      const e = err as AuthError;
      setError(mapFirebaseError(e.code));
    } finally {
      setLoading(false);
    }
  }

  /**
   * Encontra o padrinho pelo ID curto e credita os 50 MT.
   * Usa duas estratégias para encontrar o padrinho:
   *   1. Query indexada (orderByChild "id") — rápida
   *   2. Scan completo de todos os utilizadores — fallback robusto
   */
  async function creditarBonusPadrinho({
    padrinhoID,
    indicadoUid,
    indicadoNome,
  }: {
    padrinhoID: string;
    indicadoUid: string;
    indicadoNome: string;
  }) {
    try {
      // ── Estratégia 1: query indexada ──────────────────────────────────────
      let padrinhoUid: string | null = null;
      let padrinhoData: Record<string, any> | null = null;

      const q = rtdbQuery(ref(rtdb, "usuarios"), orderByChild("id"), equalTo(padrinhoID));
      const snap = await get(q);

      if (snap.exists()) {
        padrinhoUid = Object.keys(snap.val())[0];
        padrinhoData = Object.values(snap.val())[0] as Record<string, any>;
      } else {
        // ── Estratégia 2: scan completo (fallback) ────────────────────────
        // Necessário se a query falhou por falta de índice ou dado inconsistente
        const allSnap = await get(ref(rtdb, "usuarios"));
        if (allSnap.exists()) {
          const allUsers = allSnap.val() as Record<string, Record<string, any>>;
          for (const [uid, data] of Object.entries(allUsers)) {
            const idField = (data.id as string | undefined)?.toUpperCase();
            if (idField === padrinhoID) {
              padrinhoUid = uid;
              padrinhoData = data;
              break;
            }
          }
        }
      }

      if (!padrinhoUid || !padrinhoData) {
        console.warn(`[Referência] Padrinho com ID "${padrinhoID}" não encontrado.`);
        return;
      }

      // Auto-referência: padrinho não pode ser o próprio indicado
      if (padrinhoUid === indicadoUid) {
        console.warn("[Referência] Auto-referência detectada — bónus não creditado.");
        return;
      }

      // Previne duplicado: verifica se o indicado já está na equipa do padrinho
      const equipaExistente: Record<string, any> = padrinhoData.equipa ?? {};
      const jaIndicado = Object.values(equipaExistente).some(
        (m: any) => m.uid === indicadoUid
      );
      if (jaIndicado) {
        console.warn("[Referência] Indicado já registado na equipa — bónus não creditado.");
        return;
      }

      const now = new Date().toISOString();
      const txId    = `ref_${indicadoUid.slice(0, 8)}`;
      const membroId = `mem_${indicadoUid.slice(0, 8)}`;

      // 1. Saldo atómico via runTransaction (garante consistência mesmo com escrita concorrente)
      const txResult = await runTransaction(ref(rtdb, `usuarios/${padrinhoUid}/saldo`), (saldoAtual) =>
        Number(saldoAtual || 0) + 50
      );
      if (!txResult.committed) {
        console.error("[Referência] runTransaction não foi committed — saldo não alterado.");
        return;
      }

      // 2. Equipa + transacção em paralelo (usando set com chave estável para ser idempotente)
      await Promise.all([
        set(ref(rtdb, `usuarios/${padrinhoUid}/equipa/${membroId}`), {
          uid: indicadoUid,
          name: indicadoNome,
          joinDate: now,
          plan: "Novo membro",
        }),
        set(ref(rtdb, `usuarios/${padrinhoUid}/transacoes/${txId}`), {
          id: txId,
          type: "credit",
          amount: 50,
          description: `Bónus de referência — ${indicadoNome}`,
          date: now,
        }),
        update(ref(rtdb, `usuarios/${indicadoUid}`), {
          padrinhoId: padrinhoID,
          padrinhoUid,
        }),
      ]);

      console.log(`[Referência] ✅ 50 MT creditados ao padrinho ${padrinhoUid} (ID: ${padrinhoID})`);
    } catch (err) {
      // Falha no bónus não impede o utilizador de usar a conta
      console.error("[Referência] Erro ao creditar bónus:", err);
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
