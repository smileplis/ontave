const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function referenceClient(manifest) {
  if (manifest.kind !== "recorded-sdk-fixtures")
    throw Error("Invalid fictional reference data");
  let scenario = "roof",
    index = 0,
    rejected = null;
  const current = () =>
    structuredClone({
      ...(rejected ?? manifest.scenarios[scenario].states[index]),
      mode: "reference",
    });
  return {
    state: current,
    reset(id) {
      if (!manifest.scenarios[id]) throw Error("Choose a supplied example");
      scenario = id;
      index = 0;
      rejected = null;
      return current();
    },
    act(action) {
      const expected = ["interpret", "evaluate", "activate", "accept"][index];
      if (action === "reject" && [1, 2, 3].includes(index)) {
        rejected =
          manifest.scenarios[scenario][
            index === 3 ? "rejectedFacts" : "rejectedModel"
          ];
        return current();
      }
      if (rejected || action !== expected)
        throw Error("This action is not available at the current step");
      index++;
      return current();
    },
  };
}
async function boot() {
  const root = document.querySelector("#playground");
  if (!root) return;
  const local = root.dataset.mode === "local";
  let state,
    busy = false,
    api;
  const query = (selector) => root.querySelector(selector);
  const request = async (path, input) => {
    const response = await fetch(path, {
      method: input ? "POST" : "GET",
      headers: input
        ? { "content-type": "application/json", "x-ontave-playground": "1" }
        : {},
      body: input ? JSON.stringify(input) : undefined,
      credentials: "same-origin",
    });
    const data = await response.json();
    if (!response.ok)
      throw Error(data.error?.message ?? "The playground is unavailable");
    return data;
  };
  if (local)
    api = {
      state: () => request("/api/state"),
      reset: (scenario) => request("/api/reset", { scenario }),
      act: (action) => request("/api/action", { action }),
    };
  else {
    const response = await fetch("/preview-reference.json");
    if (!response.ok)
      throw Error("Unable to load the fictional SDK reference run");
    api = referenceClient(await response.json());
  }
  const format = (value) =>
    typeof value === "object" && value?.currency
      ? new Intl.NumberFormat("en-IN", {
          style: "currency",
          currency: value.currency,
          maximumFractionDigits: 0,
        }).format(Number(value.amount))
      : typeof value === "string"
        ? value
        : JSON.stringify(value);
  function render() {
    root.dataset.phase = state.phase;
    root.setAttribute("aria-busy", String(busy));
    root
      .querySelectorAll("[data-reset]")
      .forEach((button) => (button.disabled = busy));
    root.querySelectorAll("[data-scenario]").forEach((button) => {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.scenario === state.scenario.id),
      );
      button.disabled = busy;
    });
    const quote = state.source.quote,
      text = state.source.text,
      at = text.indexOf(quote);
    query("#preview-message").innerHTML =
      escape(text.slice(0, at)) +
      `<mark>${escape(quote)}</mark>` +
      escape(text.slice(at + quote.length));
    query("#preview-source-state").textContent = state.source.evidenceId
      ? "✓ Original source preserved"
      : "Ready to preserve";
    query("#preview-evidence-detail").innerHTML =
      `<p>The supporting quote is “${escape(quote)}”.</p><dl><dt>Source coordinates</dt><dd>UTF-8 bytes ${state.source.span.startByte}–${state.source.span.endByte}</dd><dt>Evidence</dt><dd>${escape(state.source.evidenceId ?? "Preserved after interpretation")}</dd><dt>Processing state</dt><dd>${escape(state.source.jobState ?? "Not submitted")}</dd></dl>`;
    query("#preview-concepts").textContent = state.model.concepts
      .map((c) => c.name)
      .join(" · ");
    query("#preview-model-version").textContent = `v${state.model.ordinal}`;
    query("#preview-counter").textContent =
      `${state.records.length} new accepted record${state.records.length === 1 ? "" : "s"}`;
    query("#preview-backend").textContent = local
      ? "Live SDK + PostgreSQL"
      : "Fictional SDK reference run";
    const stage = {
      ready: 0,
      "model-review": 1,
      evaluated: 2,
      "fact-review": 3,
      accepted: 4,
      rejected: -1,
    }[state.phase];
    root.querySelectorAll(".preview-steps li").forEach((step, i) => {
      step.toggleAttribute("data-complete", i < stage);
      if (i === stage) step.setAttribute("aria-current", "step");
      else step.removeAttribute("aria-current");
    });
    const patch = state.proposal?.patch,
      concept = patch?.concepts[0];
    const schema = concept
      ? `<div class="preview-schema"><span class="preview-add">+</span><h3>${escape(concept.name)}</h3><dl>${concept.fields.map((f) => `<dt>${escape(f.name)}</dt><dd>${escape(f.type)}</dd>`).join("")}</dl><div class="preview-relations">${patch.relations.map((r) => `<div><span>${escape(r.name)}</span><span>→ ${escape(r.target === "person" ? "Ramesh" : "I-101")}</span></div>`).join("")}</div></div>`
      : "";
    let result = "",
      actions = "";
    if (state.phase === "ready") {
      result = `<h2>A familiar workflow.<br>An unfamiliar ${state.scenario.id === "payment" ? "claim" : "requirement"}.</h2><p>${escape(state.scenario.description)}</p><p class="preview-small">The fixture adapter accepts only these fictional messages. No model is called.</p>`;
      actions =
        '<button class="preview-primary" data-action="interpret">Interpret this message →</button>';
    } else if (state.phase === "model-review") {
      result = `<h2>A new concept.<br>Still your decision.</h2><p>The source is preserved. This proposal has not changed the approved model or added a record.</p>${schema}`;
      actions =
        '<button class="preview-primary" data-action="evaluate">Check the proposed change →</button><button class="preview-secondary" data-action="reject">Decline</button>';
    } else if (state.phase === "evaluated") {
      result = `<h2>The example checks pass.</h2><div class="preview-checks"><p>✓ Earlier Person contract remains readable</p><p>✓ New fields match the reviewed fictional source</p><p>✓ Relationship endpoints match the expected records</p></div><p>These checks use an authored fixture suite. They do not certify accuracy on arbitrary messages.</p>${schema}`;
      actions =
        '<button class="preview-primary" data-action="activate">Approve the model change →</button><button class="preview-secondary" data-action="reject">Decline</button>';
    } else if (state.phase === "fact-review") {
      const mention = state.bundle.extraction.entities.find(
        (e) => e.conceptId === state.scenario.conceptId,
      );
      result = `<h2>The model has changed.<br>The facts are waiting.</h2><p>Check this interpretation against the source, including its identity links.</p><div class="preview-fact"><h3>${escape(state.scenario.label)}</h3>${Object.entries(
        mention.fields,
      )
        .map(
          ([key, field]) =>
            `<div><span>${escape(key)}</span><strong>${escape(format(field.value))}</strong></div>`,
        )
        .join(
          "",
        )}<div><span>Verification</span><strong>reported</strong></div></div><label class="preview-confirm"><input type="checkbox" id="preview-confirm"><span>I checked the source and confirm the links to the existing Ramesh and installation I-101.</span></label>`;
      actions =
        '<button class="preview-primary" data-action="accept" disabled>Confirm matches & accept →</button><button class="preview-secondary" data-action="reject">Reject interpretation</button>';
    } else if (state.phase === "accepted") {
      const record = state.records[0];
      result = `<h2>A useful record.<br>A source to come back to.</h2><div class="preview-fact"><h3>${escape(state.scenario.label)}</h3>${Object.entries(
        record.fields,
      )
        .map(
          ([key, field]) =>
            `<div><span>${escape(key)}</span><strong>${escape(format(field.value))}</strong></div>`,
        )
        .join(
          "",
        )}<div><span>Verification</span><strong class="preview-reported">reported</strong></div><div><span>Evidence</span><strong>Message 014 ↗</strong></div></div><p>${state.scenario.id === "payment" ? "The claim is accepted as a report. This does not confirm that money was received." : "The requirement is accepted as reported. This does not mean the inspection has happened."}</p><p class="preview-query-note">✓ Queried through the new contract · no inference call</p>`;
      actions =
        '<button class="preview-primary" data-reset>Try another run ↺</button>';
    } else {
      result =
        "<h2>Your decision stands.</h2><p>The declined proposal added no accepted record. The original source remains available.</p><p>You can reset this fictional workspace and try the flow again.</p>";
      actions =
        '<button class="preview-primary" data-reset>Start again ↺</button>';
    }
    query("#preview-result").innerHTML = result;
    query("#preview-actions").innerHTML = actions;
    query("#preview-operation-note").textContent =
      `${local ? "Live local SDK calls" : "Recorded SDK calls"}: ingest → worker.runOnce → ontology.propose → evaluations.evaluate → ontology.publish → reviews.resolveIdentity → reviews.accept → entities.find. ${state.usage.interpretations} example interpretations; ${state.usage.providerCalls} provider calls. Evaluation also runs the fixture adapter on parent and candidate.`;
    query("#preview-json").textContent = JSON.stringify(
      {
        phase: state.phase,
        source: state.source,
        modelHash: state.model.hash,
        evaluation: state.evaluation,
        bundle: state.bundle,
        records: state.records,
        earlierContract: state.earlierContract,
      },
      null,
      2,
    );
    if (busy)
      root
        .querySelectorAll("button")
        .forEach((button) => (button.disabled = true));
  }
  async function operate(callback) {
    if (busy) return;
    busy = true;
    query(".preview-error").hidden = true;
    render();
    try {
      state = await callback();
    } catch (error) {
      query(".preview-error").textContent = error.message;
      query(".preview-error").hidden = false;
    } finally {
      busy = false;
      render();
    }
  }
  root.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button || busy) return;
    if (button.dataset.action) operate(() => api.act(button.dataset.action));
    else if (button.dataset.scenario)
      operate(() => api.reset(button.dataset.scenario));
    else if (button.hasAttribute("data-reset"))
      operate(() => api.reset(state.scenario.id));
  });
  root.addEventListener("change", (event) => {
    if (event.target.id === "preview-confirm")
      query('[data-action="accept"]').disabled = !event.target.checked || busy;
  });
  document
    .querySelector("[data-copy-command]")
    ?.addEventListener("click", async (event) => {
      try {
        await navigator.clipboard.writeText(
          document.querySelector(".preview-command code").textContent,
        );
        event.currentTarget.textContent = "Copied ✓";
      } catch {
        event.currentTarget.textContent = "Select the command to copy";
      }
    });
  state = await api.state();
  render();
}
if (typeof document !== "undefined")
  boot().catch((error) => {
    const area = document.querySelector(".preview-error");
    if (area) {
      area.hidden = false;
      area.textContent = error.message;
    }
  });
