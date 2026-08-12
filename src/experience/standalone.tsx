import { createRoot } from "react-dom/client";

import { PackOpening } from "./pack-opening";
import type { PackOpeningEvent } from "./types";

declare global {
  interface Window {
    tcgerPack?: { destroy: () => void };
    webkit?: {
      messageHandlers?: {
        packBridge?: { postMessage: (event: PackOpeningEvent) => void };
      };
    };
  }
}

function emit(event: PackOpeningEvent): void {
  window.webkit?.messageHandlers?.packBridge?.postMessage(event);
  window.dispatchEvent(new CustomEvent("tcger-pack-event", { detail: event }));
}

window.addEventListener("error", (event) => {
  emit({ type: "error", message: event.message || "Unknown JavaScript error" });
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  emit({
    type: "error",
    message: reason instanceof Error ? reason.message : String(reason),
  });
});

const container = document.getElementById("root");
if (!container) throw new Error("Pack opening root element is missing");

const root = createRoot(container);
root.render(
  <PackOpening
    // The iOS scheme handler proxies this host to the same R2 manifest used by
    // the website and falls back to PackOpening.bundle when offline.
    assetBase="tcger-pack://assets"
    embedded
    onEvent={emit}
  />,
);

window.tcgerPack = { destroy: () => root.unmount() };
