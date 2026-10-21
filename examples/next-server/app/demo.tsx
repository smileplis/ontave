"use client";
import { useState } from "react";
export default function Demo() {
  const [token, setToken] = useState(""),
    [status, setStatus] = useState("");
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        const response = await fetch("/api/ingest", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer " + token,
          },
          body: JSON.stringify({
            source: "next-demo",
            idempotencyKey: crypto.randomUUID(),
            payload: { kind: "text", text: "Asha" },
          }),
        });
        setStatus(JSON.stringify(await response.json()));
      }}
    >
      <label>
        Local demo credential{" "}
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          autoComplete="off"
        />
      </label>
      <button>Preserve fictional source</button>
      <pre>{status}</pre>
    </form>
  );
}
