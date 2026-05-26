import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// ── Captura de link de referência ─────────────────────────────────────────────
// Quando alguém abre /ref/ID_DO_PADRINHO, guarda o ID no localStorage
// e redireciona para a raiz (ecrã de registo).
const refMatch = window.location.pathname.match(/^\/ref\/([A-Za-z0-9]+)/);
if (refMatch) {
  localStorage.setItem("padrinhoID", refMatch[1].toUpperCase());
  window.history.replaceState({}, "", "/");
}

createRoot(document.getElementById("root")!).render(<App />);
