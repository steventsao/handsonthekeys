import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { CookApp } from "./CookApp.tsx"
import "./cook.css"

const root = document.getElementById("root")

if (root === null) {
  throw new Error("Missing #root element")
}

createRoot(root).render(
  <StrictMode>
    <CookApp />
  </StrictMode>
)
