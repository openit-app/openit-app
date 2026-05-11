import { useCallback, useEffect, useRef, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export interface UpdateState {
  /** An update is available and ready to prompt the user. */
  available: boolean;
  /** The new version string (e.g. "1.0.3"). */
  version: string;
  /** Release notes markdown body. */
  body: string;
  /** Currently downloading + installing. */
  installing: boolean;
  /** Trigger download, install, and relaunch. */
  install: () => void;
}

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // re-check every 5 min

/**
 * React hook that checks for updates on mount and periodically,
 * exposing state for a persistent UI indicator instead of a modal dialog.
 */
export function useUpdateChecker(): UpdateState {
  const [available, setAvailable] = useState(false);
  const [version, setVersion] = useState("");
  const [body, setBody] = useState("");
  const [installing, setInstalling] = useState(false);
  const updateRef = useRef<Update | null>(null);

  const doCheck = useCallback(async () => {
    try {
      const update = await check();
      if (update) {
        updateRef.current = update;
        setAvailable(true);
        setVersion(update.version);
        setBody(update.body ?? "");
      }
    } catch (err) {
      console.warn("[updater] check failed:", err);
    }
  }, []);

  useEffect(() => {
    doCheck();
    const id = setInterval(doCheck, CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [doCheck]);

  const install = useCallback(async () => {
    const update = updateRef.current;
    if (!update || installing) return;
    setInstalling(true);
    try {
      await update.downloadAndInstall();
      await relaunch();
    } catch (err) {
      console.error("[updater] install failed:", err);
      setInstalling(false);
    }
  }, [installing]);

  return { available, version, body, installing, install };
}
