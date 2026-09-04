import { createRoot } from "react-dom/client"
import { InstrumentLearningApp } from "./InstrumentLearningApp.tsx"
import "./studio.css"
import "./instrument-learning.css"

const root = document.getElementById("root")

if (root === null) {
  throw new Error("Missing #root element")
}

createRoot(root).render(<InstrumentLearningApp />)
