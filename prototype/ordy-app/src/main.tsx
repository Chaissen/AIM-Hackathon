import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"
import App from "./App.tsx"
import { boot } from "@/lib/api"

// Theme: saved choice first, otherwise follow the system.
let theme: string | null = null
try { theme = localStorage.getItem("ordy-theme") } catch { /* storage blocked */ }
const dark = theme ? theme === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches
document.documentElement.classList.toggle("dark", dark)

boot().then(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
