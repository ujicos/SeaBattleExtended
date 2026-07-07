import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { installVersionRefresh } from "./services/version";
import "./styles.css";

installVersionRefresh();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
