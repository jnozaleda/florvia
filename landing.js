// Contact form of the landing: sends the message to the Worker's comment channel (type "question"), where it
// reaches Noza by email and push. The hidden field «website» is a trap for bots.
const form = document.getElementById("contactForm");
const msg = document.getElementById("contactMsg");
const btn = document.getElementById("contactBtn");
const show = (text, ok) => { msg.hidden = false; msg.textContent = text; msg.className = `msg ${ok ? "ok" : "err"}`; };
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(form);
  const contact = String(fd.get("contact") ?? "").trim();
  const text = String(fd.get("text") ?? "").trim();
  if (!/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(contact)) return show("Revisa tu correo: no parece válido.", false);
  if (text.length < 4) return show("Escribe tu mensaje.", false);
  btn.disabled = true;
  btn.textContent = "Enviando…";
  try {
    const res = await fetch("https://api.florvia.app/feedback", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "question", text, contact, website: String(fd.get("website") ?? ""), tech: { version: "web", mode: "landing", lang: navigator.language } }),
    });
    if (res.status === 429) throw new Error("limit");
    if (res.status === 400) throw new Error("input");
    if (!res.ok) throw new Error("server");
    form.reset();
    show("¡Gracias! Lo hemos recibido y te respondemos por correo.", true);
  } catch (err) {
    show(err.message === "limit" ? "Has enviado varios mensajes hoy. Prueba mañana o escribe a hello@florvia.app." : err.message === "input" ? "Revisa el correo y el mensaje." : "No se ha podido enviar. Escríbenos a hello@florvia.app.", false);
  }
  btn.disabled = false;
  btn.textContent = "Enviar";
});
// Sticky header: transparent over the hero at the top (it shows the hero's own green), solid once the page is scrolled.
{
  const nav = document.querySelector(".site-nav");
  if (nav) {
    const sync = () => nav.classList.toggle("top", window.scrollY < 8);
    sync();
    window.addEventListener("scroll", sync, { passive: true });
  }
}

// Scroll animation: blocks fade in as they come into view; on the three steps a green line draws itself and the plant grows from seed to sprout to plant.
// Skipped when the visitor asked for reduced motion (everything stays visible and finished).
{
  const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!calm && "IntersectionObserver" in window) {
    document.documentElement.classList.add("js");
    const targets = [...document.querySelectorAll(".how h2, .how > p, .step, #que-hace .row, .mini div, .band h2, .cols div, .sec h2, .plan, .learn a, .contact")];
    const seen = new Map();
    targets.forEach((el) => {
      el.classList.add("reveal");
      const i = seen.get(el.parentElement) ?? 0;
      seen.set(el.parentElement, i + 1);
      el.style.setProperty("--d", `${Math.min(i, 3) * 0.08}s`);
    });
    const io = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });
    targets.forEach((el) => io.observe(el));
    const steps = document.querySelector(".steps");
    if (steps) {
      const list = [...steps.querySelectorAll(".step")];
      let tick = false;
      const update = () => {
        tick = false;
        const r = steps.getBoundingClientRect();
        const p = Math.min(1, Math.max(0, (window.innerHeight * 0.65 - r.top) / r.height));
        steps.style.setProperty("--p", p.toFixed(3));
        list.forEach((el, i) => el.classList.toggle("on", p >= [0.04, 0.42, 0.78][i]));
      };
      window.addEventListener("scroll", () => { if (!tick) { tick = true; requestAnimationFrame(update); } }, { passive: true });
      window.addEventListener("resize", update);
      update();
    }
  }
}
