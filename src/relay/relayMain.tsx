import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { RelayApp } from "./RelayApp.tsx"
import "./relay.css"

const root = document.getElementById("root")

if (root === null) throw new Error("Missing #root element")

createRoot(root).render(
  <StrictMode>
    <RelayApp />
  </StrictMode>
)
