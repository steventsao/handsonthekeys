import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { SlopApp } from "./slop/SlopApp.tsx"
import "./slop/slop.css"

const root = document.getElementById("root")

if (root === null) {
  throw new Error("Missing #root element")
}

createRoot(root).render(
  <StrictMode>
    <SlopApp />
  </StrictMode>
)
