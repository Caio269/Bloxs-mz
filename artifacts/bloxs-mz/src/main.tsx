import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// ── Captura de link de referência ─────────────────────────────────────────────
// Quando alguém abre <base>/ref/ID_DO_PADRINHO, guarda o ID no localStorage
// e redireciona para a raiz do app (base path do Vite).
// Exemplo: /bloxs-mz/ref/ABC123 → extrai "ABC123" → redireciona para /bloxs-mz/
const refMatch = window.location.pathname.match(/\/ref\/([A-Za-z0-9]+)/);
if (refMatch) {
  localStorage.setItem("padrinhoID", refMatch[1].toUpperCase());
  // import.meta.env.BASE_URL é o base path configurado no Vite (ex: "/bloxs-mz/")
  window.history.replaceState({}, "", import.meta.env.BASE_URL);
}

createRoot(document.getElementById("root")!).render(<App />);
