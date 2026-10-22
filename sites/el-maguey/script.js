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
    "hero.title": "Regálate una experiencia relajante en el corazón de Puerto Escondido",
    "hero.lede": "¡A solo dos calles de Playa Zicatela!",
    "hero.cta": "Ver disponibilidad", "hero.cta2": "Conoce los bungalows",
    "hero.b1": "calificación de huéspedes", "hero.b2a": "Superanfitrión", "hero.b2": "5 años recibiendo huéspedes", "hero.b3a": "A 2 calles", "hero.b3": "de Playa Zicatela",
    "intro.title": "Vista al mar, alberca en el jardín y baño de hielo",
    "intro.p1": "Disfruta de nuestra increíble vista al mar desde la hermosa palapa en la azotea, entrena en nuestro gimnasio / estudio de Pilates, o baja al jardín, refréscate en la alberca y date un chapuzón en el baño de hielo si te sientes aventurero.",
    "stay.eyebrow": "Los bungalows", "stay.title": "Seis hermosos bungalows",
    "stay.lede": "¡Tenemos seis hermosos bungalows disponibles en nuestra propiedad! Cada uno cuenta con baño / regadera privada, sala, cocina totalmente equipada y balcón privado con mesa, sillas y hamaca personal.",
    "stay.f1": "Huéspedes", "stay.f2": "Tipo", "stay.f2v": "Estudio", "stay.f3": "Cama", "stay.f3v": "King o 2 individuales", "stay.f4": "Baño", "stay.f4v": "Privado, agua caliente",
    "stay.inc": "En cada bungalow",
    "stay.i1": "Cama king size y almohadas de memory foam (o dos camas individuales si lo solicitas)", "stay.i2": "Área de sofá para relajarte o recibir a un huésped extra",
    "stay.i3": "Cocina totalmente equipada: refrigerador, estufa, licuadora, cafetera, microondas, tostador y todos los cubiertos, platos, sartenes, cuchillos, etc.",
    "stay.i4": "Terraza privada con vista al jardín, mesa, sillas y hamaca personal", "stay.i5": "Baño privado con regadera de agua caliente",
    "stay.i6": "Router Starlink propio para wifi de alta velocidad",
    "stay.cta": "Pregunta qué bungalows están libres",
    "prop.eyebrow": "La propiedad", "prop.title": "Mucho más que un lugar para dormir",
    "prop.f1t": "Palapa en la azotea", "prop.f1": "Nuestra palapa en la azotea tiene una increíble vista al mar con mesas, sofás y hamacas para trabajar, convivir o comer con vista.",
    "prop.f2t": "Jardín, alberca y baño de hielo", "prop.f2": "En el jardín tenemos un deck amplio, dos camastros, mesa para cuatro, alberca pequeña, baño de hielo y regadera exterior.",
    "prop.f3t": "Gimnasio y estudio de Pilates", "prop.f3": "Arriba también tenemos un pequeño gimnasio con gran variedad de equipo: pesas libres, rack multifuncional, pelotas y tapetes de yoga y nuestro Reformer de Pilates. Si no sabes usarlo, no te preocupes: pregúntanos por nuestras clases.",
    "am.1": "Wifi Starlink en todo el hotel", "am.2": "Alberca", "am.3": "Baño de hielo", "am.4": "Cocinas equipadas", "am.5": "Espacio de trabajo", "am.6": "Estacionamiento en la calle gratis", "am.7": "Cámaras exteriores 24/7", "am.8": "Azotea con vista al mar",
    "exp.eyebrow": "Experiencias", "exp.title": "Experiencias y actividades extra", "exp.lede": "Y por último, ofrecemos una gran lista de experiencias y actividades extra. ¡Pregúntanos precios y más información!",
    "exp.1": "Renta de scooters / motos", "exp.2": "Tablas de surf en renta / venta", "exp.3": "Clases de Pilates", "exp.4": "Renta de equipo de snorkel", "exp.5": "Clases de surf", "exp.6": "Muchas opciones de tours", "exp.7": "Masaje deportivo o relajante", "exp.8": "Clases de box", "exp.9": "Juegos de mesa", "free": "Gratis",
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
    "det.1t": "Wifi Starlink potente",
    "det.1": "Ofrecemos wifi potente en toda la propiedad. Instalamos Starlink y estamos muy contentos con su funcionamiento. El jardín, la azotea y cada bungalow tienen su propio router para que tengas alta velocidad dondequiera que estés.",
    "det.2t": "Regaderas con agua caliente",
    "det.2": "Instalamos agua caliente en todas las regaderas de los bungalows (excepto la regadera exterior del jardín).",
    "det.3t": "Videovigilancia 24/7",
    "det.3": "Instalamos cámaras de videovigilancia 24/7 que cubren todo el exterior de la propiedad y la calle / entrada principal.",
    "note.eyebrow": "Bueno saber",
    "note.title": "Otras cosas a tomar en cuenta",
    "note.1t": "¡La vista al mar es desde la azotea!",
    "note.1": "Cada bungalow tiene vista al jardín y la alberca.",
    "note.2t": "Planta baja y planta alta",
    "note.2": "Los bungalows 1, 2 y 3 están en planta baja. Los bungalows 4, 5 y 6 están en planta alta.",
    "note.3t": "Horario del baño de hielo",
    "note.3": "El baño de hielo está encendido de 6am a 12pm (más frío de 10am a 12pm). Después se apaga el enfriador, pero el agua se mantiene fría el resto del día, ¡y puedes agregarle hielo cuando quieras!",
    "note.4t": "Limpieza diaria",
    "note.4": "Nuestro personal de limpieza arregla y reabastece tu habitación diariamente si lo solicitas (excepto domingos y días festivos como Navidad y Año Nuevo).",
    "note.5t": "Reabastecimiento gratis",
    "note.5": "Sal, pimienta, aceite, jabón de manos, jabón para trastes, papel higiénico, agua potable y toallas limpias bajo pedido.",
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
