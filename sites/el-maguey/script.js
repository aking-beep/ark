(() => {
  const WHATSAPP = "526692664660";
  const EMAIL = "bungalowselmaguey@gmail.com";

  // Show photo filenames on placeholders only when previewing locally.
  if (location.protocol === "file:" || /^(localhost|127\.)/.test(location.hostname)) document.documentElement.classList.add("show-labels");

  // Photo slots: hide broken images so the gradient placeholder shows through.
  document.querySelectorAll(".photo img").forEach((img) => {
    const fail = () => img.classList.add("missing");
    if (img.complete && img.naturalWidth === 0) fail();
    img.addEventListener("error", fail);
    img.addEventListener("load", () => img.parentElement.removeAttribute("data-label"));
  });

  // Nav: solid background once scrolled past the hero top.
  const nav = document.querySelector(".nav");
  const onScroll = () => nav.classList.toggle("solid", window.scrollY > 40);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  // Mobile menu.
  const menuBtn = document.querySelector(".menu-btn");
  const menu = document.getElementById("menu");
  const setMenu = (open) => {
    menu.classList.toggle("open", open);
    nav.classList.toggle("menu-open", open);
    menuBtn.setAttribute("aria-expanded", String(open));
    document.body.style.overflow = open ? "hidden" : "";
  };
  menuBtn.addEventListener("click", () => setMenu(!menu.classList.contains("open")));
  menu.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => setMenu(false)));

  // Reveal sections on scroll.
  const targets = document.querySelectorAll("main section > *:not(.hero-media):not(.wave):not(.hero-inner)");
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
    }, { rootMargin: "0px 0px -8% 0px" });
    targets.forEach((el) => { el.classList.add("reveal"); io.observe(el); });
  }

  document.getElementById("year").textContent = new Date().getFullYear();

  // Spanish translations; English is read from the page itself.
  const ES = {
    "nav.stay": "Los Bungalows", "nav.property": "La Propiedad", "nav.exp": "Experiencias", "nav.location": "Ubicación", "nav.book": "Reserva directo",
    "hero.eyebrow": "Zicatela · Puerto Escondido · Oaxaca",
    "hero.title": "Seis bungalows, una alberca en el jardín y el mejor atardecer de Puerto.",
    "hero.lede": "Una calle tranquila a dos cuadras de Playa Zicatela: cerca de las olas, los restaurantes y La Punta, y lo bastante lejos para dormir bien.",
    "hero.cta": "Ver disponibilidad", "hero.cta2": "Conoce los bungalows",
    "hero.b1": "calificación de huéspedes", "hero.b2a": "Superanfitrión", "hero.b2": "5 años recibiendo huéspedes", "hero.b3a": "A 2 calles", "hero.b3": "de Playa Zicatela",
    "intro.title": "Tu campamento base en la costa oaxaqueña",
    "intro.p1": "Bungalows El Maguey es un pequeño hotel familiar en la Colonia Santa María, a la vuelta de la avenida principal de Zicatela. Despierta frente al jardín, refréscate en la alberca o en el baño de hielo, entrena en el gimnasio y termina el día en una hamaca bajo la palapa viendo las olas.",
    "intro.p2": "Christian vive en Puerto y está disponible para lo que necesites: tips de surf, renta de motos o los mejores tacos de la zona.",
    "stay.eyebrow": "Los bungalows", "stay.title": "Seis estudios privados",
    "stay.lede": "Cada bungalow es independiente, con cocina, baño y balcón propios con vista al jardín. Los bungalows 1–3 están en planta baja; los 4–6 en el piso de arriba.",
    "stay.f1": "Huéspedes", "stay.f2": "Tipo", "stay.f2v": "Estudio", "stay.f3": "Cama", "stay.f3v": "King o 2 individuales", "stay.f4": "Baño", "stay.f4v": "Privado, agua caliente",
    "stay.inc": "En cada bungalow",
    "stay.i1": "Cama king size y almohadas de memory foam", "stay.i2": "Área de sofá — espacio para un tercer huésped",
    "stay.i3": "Cocina: refrigerador, estufa, licuadora, cafetera, microondas, tostador y utensilios completos",
    "stay.i4": "Balcón privado con mesa, sillas y hamaca propia", "stay.i5": "Baño privado con regadera de agua caliente",
    "stay.i6": "Router Starlink dedicado en cada unidad", "stay.i7": "Limpieza diaria opcional (excepto domingos y días festivos)",
    "stay.i8": "Reposición gratis: sal, pimienta, aceite, jabones, papel, agua potable y toallas limpias",
    "stay.cta": "Pregunta qué bungalows están libres",
    "prop.eyebrow": "La propiedad", "prop.title": "Mucho más que un lugar para dormir",
    "prop.f1t": "Palapa en la azotea", "prop.f1": "Vista panorámica al mar con mesas, sofás y hamacas — para trabajar, comer o ver el atardecer.",
    "prop.f2t": "Jardín, alberca y baño de hielo", "prop.f2": "Deck amplio, dos camastros, mesa para cuatro, alberca pequeña, regadera exterior y baño de hielo — encendido de 6am a 12pm, más frío de 10 a 12.",
    "prop.f3t": "Gimnasio y estudio de Pilates", "prop.f3": "Pesas libres, rack multifuncional, pelotas y tapetes de yoga, y un reformer de Pilates. ¿Nunca lo has usado? Pregunta por las clases.",
    "am.1": "Wifi Starlink en todo el hotel", "am.2": "Alberca", "am.3": "Baño de hielo", "am.4": "Cocinas equipadas", "am.5": "Espacio de trabajo", "am.6": "Estacionamiento en la calle gratis", "am.7": "Cámaras exteriores 24/7", "am.8": "Azotea con vista al mar",
    "exp.eyebrow": "Experiencias", "exp.title": "Surf, motos y todo lo demás", "exp.lede": "Organizamos todo aquí mismo. Pregúntanos precios y disponibilidad.",
    "exp.1": "Clases de surf", "exp.2": "Renta y venta de tablas", "exp.3": "Renta de motos y scooters", "exp.4": "Clases de Pilates", "exp.5": "Clases de box", "exp.6": "Masaje deportivo o relajante", "exp.7": "Renta de equipo de snorkel", "exp.8": "Tours en lancha y naturaleza", "exp.9": "Sombrillas de playa", "exp.10": "Juegos de mesa", "free": "Gratis",
    "rev.count": "Favorito de los huéspedes · 127 reseñas en Airbnb",
    "rev.c1": "Limpieza", "rev.c2": "Veracidad", "rev.c3": "Llegada", "rev.c4": "Comunicación", "rev.c5": "Ubicación", "rev.c6": "Calidad-precio",
    "rev.q1": "Huésped frecuente · 5★", "rev.most": "Lo que más mencionan:", "rev.t1": "Hospitalidad", "rev.t2": "Ubicación", "rev.t3": "Limpieza", "rev.t4": "Playa", "rev.t5": "Alberca",
    "loc.eyebrow": "Ubicación", "loc.title": "Calle tranquila, a cinco minutos de las olas",
    "loc.p": "A la vuelta de la zona de restaurantes, tiendas y bares de Zicatela — caminando a todo, pero lo bastante lejos para descansar de noche. Tenemos motos en renta y números de taxis de confianza para ir más lejos.",
    "loc.n1": "Playa Zicatela", "loc.n1d": "~5 min caminando", "loc.n2": "Zona de Zicatela y Mercado", "loc.n2d": "a la vuelta", "loc.n3": "La Punta", "loc.n3d": "caminando o en moto", "loc.n4": "Aeropuerto de Puerto Escondido (PXM)", "loc.n4d": "~15 min en taxi",
    "loc.dir": "Cómo llegar",
    "book.eyebrow": "Reserva directo", "book.title": "Planea tu estancia",
    "book.p": "Mándanos tus fechas y te respondemos con la disponibilidad, normalmente en menos de una hora. Reservar directo significa hablar con tu anfitrión desde el primer día.",
    "book.ci": "Entrada", "book.co": "Salida", "book.online": "Reserva en línea", "book.abnb": "Ver anuncio y reseñas",
    "form.title": "Consultar disponibilidad", "form.in": "Llegada", "form.out": "Salida", "form.guests": "Huéspedes", "form.units": "Bungalows", "form.name": "Tu nombre",
    "form.msg": "¿Algo más? (clases de surf, moto, entrada temprana…)", "form.wa": "Enviar por WhatsApp", "form.email": "Enviar por correo",
  };
  const EN = {};
  const nodes = document.querySelectorAll("[data-i18n]");
  nodes.forEach((el) => { EN[el.dataset.i18n] = el.textContent; });

  const MSG = {
    en: { dates: "Please choose your arrival and departure dates.", order: "Departure must be after arrival.", name: "Please add your name.",
      hi: (f) => `Hi! I'm ${f.name} and I'd like to check availability at Bungalows El Maguey.`, in: "Arrive", out: "Depart", g: "Guests", u: "Bungalows", subj: "Availability request" },
    es: { dates: "Elige tus fechas de llegada y salida.", order: "La salida debe ser después de la llegada.", name: "Agrega tu nombre.",
      hi: (f) => `¡Hola! Soy ${f.name} y quiero consultar disponibilidad en Bungalows El Maguey.`, in: "Llegada", out: "Salida", g: "Huéspedes", u: "Bungalows", subj: "Consulta de disponibilidad" },
  };

  let lang = "en";
  const langBtn = document.querySelector(".lang");
  const setLang = (next) => {
    lang = next;
    const dict = lang === "es" ? ES : EN;
    nodes.forEach((el) => { const t = dict[el.dataset.i18n]; if (t) el.textContent = t; });
    document.documentElement.lang = lang;
    langBtn.textContent = lang === "es" ? "EN" : "ES";
    langBtn.setAttribute("aria-label", lang === "es" ? "Switch to English" : "Cambiar a español");
    try { localStorage.setItem("maguey-lang", lang); } catch {}
  };
  langBtn.addEventListener("click", () => setLang(lang === "en" ? "es" : "en"));
  let saved = null;
  try { saved = localStorage.getItem("maguey-lang"); } catch {}
  if (saved === "es" || (!saved && navigator.language?.toLowerCase().startsWith("es"))) setLang("es");

  // Inquiry form: compose a WhatsApp or email message with the guest's details.
  const form = document.getElementById("inquiry");
  const err = form.querySelector(".form-error");
  const today = new Date().toISOString().slice(0, 10);
  form.checkin.min = today;
  form.checkout.min = today;
  form.checkin.addEventListener("change", () => { form.checkout.min = form.checkin.value || today; });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const m = MSG[lang];
    const f = Object.fromEntries(new FormData(form));
    let problem = "";
    if (!f.checkin || !f.checkout) problem = m.dates;
    else if (f.checkout <= f.checkin) problem = m.order;
    else if (!f.name.trim()) problem = m.name;
    err.hidden = !problem;
    err.textContent = problem;
    if (problem) return;

    const lines = [m.hi({ name: f.name.trim() }), "", `${m.in}: ${f.checkin}`, `${m.out}: ${f.checkout}`, `${m.g}: ${f.guests}`, `${m.u}: ${f.units}`];
    if (f.message.trim()) lines.push("", f.message.trim());
    const text = lines.join("\n");
    const via = e.submitter?.dataset.via || "whatsapp";
    if (via === "email") {
      window.location.href = `mailto:${EMAIL}?subject=${encodeURIComponent(`${m.subj} ${f.checkin} → ${f.checkout}`)}&body=${encodeURIComponent(text)}`;
    } else {
      window.open(`https://wa.me/${WHATSAPP}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
    }
  });
})();
