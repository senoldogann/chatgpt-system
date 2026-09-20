const root = document.querySelector("#fixture-root");
const scenarioId = root?.dataset.scenario;
const eventURL = `${window.location.pathname}/event`;

async function postEvent(payload) {
  const response = await fetch(eventURL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("Fixture event rejected.");
}

function element(tag, text) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

function buildOpenFocusFixture() {
  const heading = element("h1", "Computer Flow Fixture Ready");
  heading.id = "page-ready";
  root.append(heading);
  void postEvent({ event: "page_ready" });
}

function buildFormFixture() {
  const form = document.createElement("form");
  form.id = "fixture-form";
  const fields = [
    ["field-alpha", "Alpha Field"],
    ["field-bravo", "Bravo Field"],
    ["field-charlie", "Charlie Field"],
  ];
  for (const [id, labelText] of fields) {
    const label = element("label", labelText);
    label.htmlFor = id;
    const input = document.createElement("input");
    input.id = id;
    input.autocomplete = "off";
    form.append(label, input);
  }

  const checkboxLabel = element("label", "Enable Fixture Checkbox");
  checkboxLabel.htmlFor = "fixture-checkbox";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.id = "fixture-checkbox";

  const selectLabel = element("label", "Fixture Option");
  selectLabel.htmlFor = "fixture-select";
  const select = document.createElement("select");
  select.id = "fixture-select";
  for (const value of ["option-a", "option-b"]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.append(option);
  }

  const submit = element("button", "Submit Fixture Form");
  submit.type = "submit";
  form.append(checkboxLabel, checkbox, selectLabel, select, submit);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const alpha = document.querySelector("#field-alpha")?.value ?? "";
    const bravo = document.querySelector("#field-bravo")?.value ?? "";
    const charlie = document.querySelector("#field-charlie")?.value ?? "";
    void postEvent({
      event: "form_submitted",
      textFieldsMatch: alpha === "alpha" && bravo === "bravo" && charlie === "charlie",
      checkboxChecked: checkbox.checked,
      selectionMatch: select.value === "option-b",
    });
  });
  root.append(form);
}

function buildScrollFixture() {
  const outer = document.createElement("div");
  outer.className = "outer-scroll";
  outer.setAttribute("aria-label", "Fixture Outer Scroll Container");
  let outerScrollChanged = false;
  outer.addEventListener("scroll", () => { outerScrollChanged = true; });

  const intro = element("p", "Keep the outer container stationary.");
  const inner = document.createElement("div");
  inner.className = "inner-scroll";
  inner.setAttribute("role", "region");
  inner.setAttribute("aria-label", "Fixture Inner Scroll Panel");
  const spacer = document.createElement("div");
  spacer.className = "spacer";
  const target = element("button", "Nested Scroll Target");
  target.addEventListener("click", () => {
    void postEvent({ event: "inner_target_activated", outerScrollChanged });
  });
  inner.append(spacer, target);
  outer.append(intro, inner);
  root.append(outer);
}

function buildStaleFixture() {
  const rerender = element("button", "Re-render Dynamic Target");
  const container = document.createElement("div");
  container.id = "dynamic-target-container";
  let generation = 0;

  const renderTarget = () => {
    container.replaceChildren();
    const target = element("button", `Dynamic Target Generation ${generation}`);
    target.dataset.generation = String(generation);
    target.addEventListener("click", () => {
      void postEvent({ event: "current_generation_activated" });
    });
    container.append(target);
  };

  rerender.addEventListener("click", () => {
    generation += 1;
    renderTarget();
    void postEvent({ event: "rerendered" });
  });
  renderTarget();
  root.append(rerender, container);
}

function buildVisualFixture() {
  const heading = element("h1", "Weak AX Visual Fixture");
  const canvas = document.createElement("canvas");
  canvas.width = 520;
  canvas.height = 220;
  canvas.setAttribute("aria-label", "Fixture Canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas unavailable.");
  context.fillStyle = "white";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "black";
  context.font = "24px system-ui";
  context.fillText("Visual Anchor", 40, 70);
  context.strokeStyle = "black";
  context.strokeRect(330, 105, 120, 60);
  context.font = "18px system-ui";
  context.fillText("Activate", 352, 142);

  canvas.addEventListener("click", (event) => {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    void (async () => {
      await postEvent({ event: "point_attempt" });
      if (x >= 330 && x <= 450 && y >= 105 && y <= 165) {
        await postEvent({ event: "visual_target_activated" });
      }
    })();
  });
  root.append(heading, canvas);
}

switch (scenarioId) {
  case "open-focus-verify":
    buildOpenFocusFixture();
    break;
  case "batched-multi-control-form":
    buildFormFixture();
    break;
  case "scoped-nested-scrolling":
    buildScrollFixture();
    break;
  case "stale-dynamic-target-recovery":
    buildStaleFixture();
    break;
  case "weak-ax-ocr-visual-point":
    buildVisualFixture();
    break;
  default:
    throw new Error("Unsupported fixture scenario.");
}
