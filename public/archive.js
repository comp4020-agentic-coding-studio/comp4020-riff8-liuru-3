// Stepped replay for a saved dream: re-renders the stored keyframes with the
// same scene markup the live scroll uses.
import { sceneMarkup } from "./shared.js";

const { keyframes } = JSON.parse(document.getElementById("keyframes").textContent);
const art = document.querySelector("#archive-scene .scene-art");
const label = document.getElementById("kf-label");
const prev = document.getElementById("kf-prev");
const next = document.getElementById("kf-next");
let at = keyframes.length - 1;

function show() {
  art.innerHTML = sceneMarkup(keyframes[at], "d");
  const final = at === keyframes.length - 1;
  label.innerHTML = `${final ? "定格 <span lang=\"en\">Final</span>" : "过程 <span lang=\"en\">Step</span>"} ${at + 1}/${keyframes.length}`;
  prev.disabled = at === 0;
  next.disabled = final;
}

prev.addEventListener("click", () => {
  at = Math.max(0, at - 1);
  show();
});
next.addEventListener("click", () => {
  at = Math.min(keyframes.length - 1, at + 1);
  show();
});

const view = document.getElementById("archive-view");
const fit = document.getElementById("fit-toggle");
fit.addEventListener("click", () => {
  const on = view.classList.toggle("fit");
  fit.setAttribute("aria-pressed", String(on));
});
show();
