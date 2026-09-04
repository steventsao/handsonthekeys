import { createRoot } from "react-dom/client"
import { KaraokeApp } from "./KaraokeApp.tsx"
import "./karaoke.css"
import "./karaoke-room-theme.css"

const root = document.getElementById("root")

if (root === null) {
  throw new Error("Missing #root element")
}

createRoot(root).render(<KaraokeApp />)
