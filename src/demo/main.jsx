import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import DemoApp from "./DemoApp.jsx";
import "./demo.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <DemoApp />
  </StrictMode>
);
