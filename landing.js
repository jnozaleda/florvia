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
