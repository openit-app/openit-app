import React from "react";
import ReactDOM from "react-dom/client";
// Bundled fonts — desktop app must work offline. Weights pulled match
// what App.css references.
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/inter/800.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource-variable/source-serif-4/standard.css";
import "@fontsource-variable/source-serif-4/standard-italic.css";
// Brand wordmark — italic "IT" in the OpenIT lockup. Matches the PH /
// landing-page design system. Only italic weights needed.
import "@fontsource/fraunces/500-italic.css";
import "@fontsource/fraunces/600-italic.css";
import App from "./App";
import { ToastProvider } from "./Toast";

// Mark the host OS on <html> so layout that differs by platform
// (currently: TitleRail clearance — traffic lights on macOS, native
// min/max/close on the right on Windows) can branch in pure CSS.
{
  const ua = navigator.userAgent;
  const os = ua.includes("Windows")
    ? "windows"
    : ua.includes("Mac")
      ? "macos"
      : ua.includes("Linux")
        ? "linux"
        : "other";
  document.documentElement.setAttribute("data-os", os);
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </React.StrictMode>,
);
