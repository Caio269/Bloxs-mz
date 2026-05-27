import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// ── Captura de link de referência ─────────────────────────────────────────────
// O hash (#ref=ID) nunca é enviado ao servidor e sobrevive a qualquer redirect,
// incluindo a tela "Run this app" do Replit.
//
// São suportadas 3 estratégias, por ordem de prioridade:
//   1. Hash:        https://domain.com/bloxs-mz/#ref=ID   ← link novo (recomendado)
//   2. Path:        https://domain.com/bloxs-mz/ref/ID    ← link antigo
//   3. Query param: https://domain.com/bloxs-mz/?ref=ID   ← fallback extra
//
// A captura acontece antes do React renderizar, garantindo que o padrinhoID
// está no localStorage quando o componente Login for montado.

(function captureReferral() {
  // 1. Hash fragment: #ref=ID  ou  #/ref/ID
  const hashRef =
    window.location.hash.match(/[#&]ref=([A-Za-z0-9]+)/)?.[1] ||
    window.location.hash.match(/\/ref\/([A-Za-z0-9]+)/)?.[1];

  // 2. URL path: /ref/ID  (links antigos)
  const pathRef = window.location.pathname.match(/\/ref\/([A-Za-z0-9]+)/)?.[1];

  // 3. Query param: ?ref=ID
  const queryRef = new URLSearchParams(window.location.search).get("ref") ?? undefined;

  const capturedId = hashRef || pathRef || queryRef;

  if (capturedId) {
    localStorage.setItem("padrinhoID", capturedId.toUpperCase());
    // Limpa o referral da URL mas mantém o utilizador no app
    window.history.replaceState({}, "", import.meta.env.BASE_URL);
  }
})();

createRoot(document.getElementById("root")!).render(<App />);
