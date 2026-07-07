export interface AppVersion {
  version: string;
  commit?: string;
  builtAt?: string;
}

const currentVersionKey = "sea-battle.current-version";
const reloadedVersionKey = "sea-battle.reloaded-version";
const checkIntervalMs = 60_000;

let checking = false;

async function fetchVersion(): Promise<AppVersion | null> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}version.json?ts=${Date.now()}`, {
      cache: "no-store",
      headers: {
        "cache-control": "no-cache"
      }
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as AppVersion;
  } catch {
    return null;
  }
}

export async function loadAppVersion(): Promise<AppVersion | null> {
  return fetchVersion();
}

async function checkForUpdate(): Promise<void> {
  if (checking) {
    return;
  }

  checking = true;
  const next = await fetchVersion();
  checking = false;

  if (!next?.version) {
    return;
  }

  const current = localStorage.getItem(currentVersionKey);
  if (!current) {
    localStorage.setItem(currentVersionKey, next.version);
    return;
  }

  if (current === next.version) {
    sessionStorage.removeItem(reloadedVersionKey);
    return;
  }

  if (sessionStorage.getItem(reloadedVersionKey) === next.version) {
    localStorage.setItem(currentVersionKey, next.version);
    return;
  }

  sessionStorage.setItem(reloadedVersionKey, next.version);
  localStorage.setItem(currentVersionKey, next.version);
  window.location.reload();
}

export function installVersionRefresh(): void {
  void checkForUpdate();
  window.setInterval(() => void checkForUpdate(), checkIntervalMs);
  window.addEventListener("focus", () => void checkForUpdate());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void checkForUpdate();
    }
  });
}
