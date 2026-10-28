"use client";
import "./service-state.css";
import { NOT_CONFIGURED, SERVICE_DOWN } from "./api";

export const isServiceMessage = (what: string) => what.startsWith(SERVICE_DOWN) || what.startsWith(NOT_CONFIGURED);

/** Designed error state for "the service is not there" and "this part is not configured". Never sample data: say what is wrong and offer a retry. */
export function ServiceState({ what, onRetry }: { what: string; onRetry?: () => void }) {
  const notConfigured = what.startsWith(NOT_CONFIGURED);
  const detail = notConfigured ? what.slice(NOT_CONFIGURED.length).trim() : "";
  return (
    <div className="service-state" role="alert">
      <span className="micro">{notConfigured ? "Not configured" : "Service unavailable"}</span>
      <b>{notConfigured ? "This part of Clippo is not switched on for this deployment." : "Clippo could not reach its service."}</b>
      <p className="muted">
        {notConfigured
          ? `${detail || "A required setting is missing."} Nothing was changed and no money moved. An operator needs to finish the configuration.`
          : "Nothing was changed and no money moved. Your connection, or the service itself, may be down. No sample data is shown in its place."}
      </p>
      {onRetry && (
        <button className="btn sm" onClick={onRetry} style={{ justifySelf: "start" }}>
          Try again
        </button>
      )}
    </div>
  );
}
