(function () {
  var D = null, sel = { da: null, a: null }, quanti = { andata: 6, ritorno: 6 }, ultimoStato = "";
  var $ = function (id) { return document.getElementById(id); };
  function store(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(k)); localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } }
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function annuncia(msg) { var a = $("annuncio"); a.textContent = ""; setTimeout(function () { a.textContent = msg; }, 80); }
  function nomeF(i) { return D.fermate[i].replace(/ - /g, ", "); }
  // Una settimana: "Oggi", "Domani", poi solo il nome del giorno ("Lunedì", "Martedì"...)
  function riempiGiorni() {
    var sel = $("giorno"), scelto = sel.value ? new Date(Date.now() + Number(sel.value) * 864e5).toDateString() : null;
    sel.textContent = "";
    for (var k = 0; k < 7; k++) {
      var d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + k);
      var nome = d.toLocaleDateString("it-IT", { weekday: "long" });
      var o = document.createElement("option"); o.value = String(k);
      o.textContent = k === 0 ? "Oggi" : k === 1 ? "Domani" : nome.charAt(0).toUpperCase() + nome.slice(1);
      sel.appendChild(o);
    }
    sel.value = "0";
    if (scelto) for (var j = 0; j < 7; j++) { var x = new Date(); x.setDate(x.getDate() + j); if (x.toDateString() === scelto) sel.value = String(j); }
    giornoCaricato = new Date().toDateString();
  }
  var giornoCaricato = null;
  function giorno() { var d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + Number($("giorno").value)); return d; }
  function dopo() {
    var v = $("ora").value;
    if (v) { var p = v.split(":"); return Number(p[0]) * 60 + Number(p[1]); }
    if ($("giorno").value !== "0") return 0;
    var n = new Date(); return n.getHours() * 60 + n.getMinutes();
  }
  function copertura() {
    var nomi = D.linee.map(function (L) { return (L.numero ? L.numero + " " : "") + L.nome; });
    if (nomi.length <= 5) return "Per ora l'app contiene solo " + (nomi.length === 1 ? "la linea " : "le linee ") + nomi.join(", ") + ".";
    var zone = {}; D.linee.forEach(function (L) { zone[(D.sedi && D.sedi[L.sede]) || L.sede] = 1; });
    return "Le zone caricate sono: " + Object.keys(zone).join(", ") + ".";
  }
  function a_(n) { return /^[AaEe]/.test(n) ? "ad " + n : "a " + n; }
  function linea(t) { return (t.linea.numero ? "Linea " + t.linea.numero : "Linea " + t.linea.nome); }

  function carica() {
    fetch("orari.json", { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (dati) {
        D = dati; $("caricamento").textContent = copertura();
        var g = new Date(D.generato), sedi = {};
        D.linee.forEach(function (L) { sedi[L.sede] = 1; });
        $("stato-dati").textContent = "Ultimo controllo degli orari: " + g.toLocaleDateString("it-IT") + " alle " +
          g.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }) + ". Linee caricate: " + D.linee.length +
          ", zone: " + Object.keys(sedi).map(function (s) { return (D.sedi && D.sedi[s]) || s; }).join(", ") + ".";
        mostraPreferiti();
        var ult = store("qp-ultimo");
        if (ult) imposta(ult, false);
      }).catch(function () { $("caricamento").textContent = "Non riesco a caricare gli orari. Controlla la connessione e riapri l'app."; });
  }

  // --- ricerca fermate
  function collega(campo) {
    var input = $(campo), ul = $(campo + "-lista"), timer;
    input.addEventListener("input", function () {
      sel[campo] = null; clearTimeout(timer);
      timer = setTimeout(function () {
        ul.textContent = "";
        if (!D || input.value.trim().length < 2) return;
        var altro = campo === "da" ? sel.a : sel.da;
        var res = QP.cerca(D, input.value, 10, altro && altro.ids);
        if (!res.length) {
          var msg = "Nessuna fermata trovata per " + input.value.trim() + ". " + copertura();
          ul.appendChild(el("li", "box", msg)); annuncia(msg); return;
        }
        res.forEach(function (r) {
          var li = el("li"), b = el("button", null, r.etichetta); b.type = "button";
          b.addEventListener("click", function () {
            sel[campo] = r; input.value = r.breve; ul.textContent = "";
            if (campo === "da" && !sel.a) { $("a").focus(); annuncia("Partenza: " + r.etichetta + ". Ora scrivi dove vuoi arrivare, oppure premi Cerca orari."); }
            else { cerca(true); }
          });
          li.appendChild(b); ul.appendChild(li);
        });
        annuncia(res.length + (res.length === 1 ? " risultato: " : " risultati. Il primo è: ") + res[0].etichetta + ". Scorri sotto per scegliere.");
      }, 250);
    });
  }

  // --- preferiti (tragitti salvati)
  function mostraPreferiti() {
    var pref = store("qp-tragitti") || [];
    $("preferiti").hidden = !pref.length;
    var ul = $("pref-lista"); ul.textContent = "";
    pref.forEach(function (t) {
      var li = el("li"), b = el("button", null, t.da.breve + (t.a ? " → " + t.a.breve : ", tutte le partenze")); b.type = "button";
      b.addEventListener("click", function () { imposta(t, true); });
      li.appendChild(b); ul.appendChild(li);
    });
  }
  function valido(r) { return r && r.ids && r.ids.every(function (i) { return i < D.fermate.length; }); }
  function imposta(t, parla) {
    if (!valido(t.da)) return;
    sel.da = t.da; sel.a = valido(t.a) ? t.a : null;
    $("da").value = t.da.breve; $("a").value = sel.a ? sel.a.breve : "";
    cerca(parla);
  }

  // --- risultati
  function descriviViaggio(v, conDa, conA) {
    var t1 = v[0], ult = v[v.length - 1];
    conDa = conA = true;  // la fermata precisa (con la via, quando il PDF la scrive) va sempre detta
    var s = QP.hhmm(t1.parte) + ", arrivo alle " + QP.hhmm(ult.arriva) + " (" + QP.durata(ult.arriva - t1.parte) + ")";
    var fine = conA ? ", scendi " + a_(nomeF(ult.a)) : "";
    if (v.length === 1) s += ". " + linea(t1) + (conDa ? ", da " + nomeF(t1.da) : "") + fine + ".";
    else s += ", con un cambio. " + linea(t1) + (conDa ? " da " + nomeF(t1.da) : "") + " fino " + a_(nomeF(t1.a)) +
      ", poi " + linea(v[1]).toLowerCase() + " alle " + QP.hhmm(v[1].parte) + fine + ".";
    var dub = v.filter(function (t) { return t.dubbio; }).map(function (t) { return t.dubbio; });
    if (dub.length) s += " Corsa da verificare: " + dub[0] + ".";
    return s;
  }

  function blocco(contenitore, titolo, chiave, lista, conDa, conA, vuoto) {
    var sec = el("section", "field"); sec.setAttribute("aria-labelledby", "h-" + chiave);
    var h = el("h2", null, titolo); h.id = "h-" + chiave; h.tabIndex = -1; sec.appendChild(h);
    if (!lista.length) { sec.appendChild(el("p", "box", vuoto)); contenitore.appendChild(sec); return; }
    var ol = el("ol", "viaggi");
    lista.slice(0, quanti[chiave]).forEach(function (v) {
      var li = el("li");
      var o = el("span", "orario", QP.hhmm(v[0].parte) + " → " + QP.hhmm(v[v.length - 1].arriva)); o.setAttribute("aria-hidden", "true");
      li.appendChild(o);
      li.appendChild(el("span", null, "Parte alle " + descriviViaggio(v, conDa, conA)));
      ol.appendChild(li);
    });
    sec.appendChild(ol);
    if (lista.length > quanti[chiave]) {
      var b = el("button", "sec", "Mostra altri orari (" + (lista.length - quanti[chiave]) + ")"); b.type = "button";
      b.addEventListener("click", function () { quanti[chiave] += 10; disegna(); annuncia("Altri orari aggiunti."); });
      sec.appendChild(b);
    }
    contenitore.appendChild(sec);
  }

  function calcola() {
    var d = giorno(), da = sel.da.ids, now = dopo();
    var g = QP.infoGiorno(d, D.calendario, D.fermate_sede ? D.fermate_sede[da[0]] : "aosta");
    if (!sel.a) {
      var gruppi = QP.partenze(D, da, d).map(function (gr) { gr.prossime = gr.corse.filter(function (c) { return c.t >= now; }); return gr; })
        .filter(function (gr) { return gr.prossime.length; })
        .sort(function (x, y) { return x.prossime[0].t - y.prossime[0].t; });
      return { g: g, now: now, gruppi: gruppi };
    }
    var a = sel.a.ids, andata = QP.viaggi(D, da, a, d, now), domani = false, allargato = false;
    // dalla fermata scelta non passa nessun bus per quel tragitto: prova le altre fermate degli stessi paesi
    if (!andata.length) {
      var da2 = QP.stessoPaese(D, da), a2 = QP.stessoPaese(D, a);
      if (da2.length > da.length || a2.length > a.length) {
        var prova = QP.viaggi(D, da2, a2, d, now);
        if (prova.length || $("giorno").value === "0") { da = da2; a = a2; andata = prova; allargato = true; }
      }
    }
    // oggi non ci sono più bus: mostra subito quelli di domani invece di una pagina vuota
    if (!andata.length && $("giorno").value === "0" && !$("ora").value) {
      d = new Date(d.getTime() + 864e5); now = 0; domani = true;
      andata = QP.viaggi(D, da, a, d, 0);
    }
    var dopoR = andata.length ? andata[0][andata[0].length - 1].arriva : now;
    var ritorno = QP.viaggi(D, a, da, d, dopoR);
    return { g: g, now: now, andata: andata, ritorno: ritorno, dopoR: dopoR, domani: domani, allargato: allargato };
  }

  function disegna() {
    var c = calcola(), box = $("esiti");
    box.textContent = "";
    var oggi = Number($("giorno").value) === 0;
    var kk = Number($("giorno").value), tg = (kk === 0 ? "Oggi, " : kk === 1 ? "Domani, " : "") + c.g.testo;
    $("oggi").textContent = tg.charAt(0).toUpperCase() + tg.slice(1) + ": giorno " + c.g.tipo +
      ($("ora").value ? ". Partenze dopo le " + $("ora").value : "") + "." +
      (c.g.fuoriCalendario ? " Attenzione: il calendario scolastico non è aggiornato per quest'anno." : "");
    var tutti = sel.da.ids.concat(sel.a ? sel.a.ids : []);
    var av = $("avvisi-box"); av.textContent = "";
    var avvisi = (D.avvisi || []).filter(function (a) { return a.fermate.some(function (f) { return tutti.indexOf(f) >= 0; }); });
    if (avvisi.length) {  // chiusi: si aprono solo se li vuoi leggere, e stanno sotto gli orari
      var det = el("details", "alert"), sum = el("summary", null, "Avvisi Arriva per queste fermate: " + avvisi.length + ". Premi per aprirli.");
      det.appendChild(sum);
      avvisi.forEach(function (a) {
        var p = el("p"); p.appendChild(document.createTextNode((a.data ? a.data.split("-").reverse().join("/") + ": " : "")));
        var l = el("a", null, a.titolo); l.href = a.url; l.target = "_blank"; l.rel = "noopener"; p.appendChild(l); det.appendChild(p);
      });
      av.appendChild(det);
    }
    var mDa = sel.da.ids.length > 1, mA = sel.a && sel.a.ids.length > 1;
    if (sel.a) {
      if (c.allargato) box.appendChild(el("p", "box", "Dalla fermata che hai scelto non passano bus per questo tragitto: ti mostro quelli dalle altre fermate dello stesso paese. Guarda da quale fermata parte ognuno."));
      if (c.domani) box.appendChild(el("p", "box", "Oggi non ci sono più bus per questo tragitto. Ecco quelli di domani."));
      blocco(box, (c.domani ? "Domani, andata" : "Andata") + ": da " + sel.da.breve + " " + a_(sel.a.breve), "andata", c.andata, mDa, mA,
        "Nessun bus " + (oggi && !$("ora").value ? "da adesso a fine giornata" : "in questo giorno dopo l'orario scelto") + " per questo tragitto, anche con un cambio.");
      blocco(box, "Ritorno: da " + sel.a.breve + " " + a_(sel.da.breve) + (c.andata.length ? ", dopo il tuo arrivo delle " + QP.hhmm(c.dopoR) : ""),
        "ritorno", c.ritorno, mA, mDa, "Nessun bus di ritorno in questo giorno dopo quell'ora.");
    } else {
      var sec = el("section", "field"), h = el("h2", null, "Partenze da " + sel.da.breve); h.id = "h-andata"; h.tabIndex = -1; sec.appendChild(h);
      if (!c.gruppi.length) sec.appendChild(el("p", "box", "Nessun'altra partenza in questo giorno."));
      var ol = el("ol", "viaggi");
      c.gruppi.forEach(function (gr) {
        var li = el("li"), p0 = gr.prossime[0];
        var o = el("span", "orario", QP.hhmm(p0.t)); o.setAttribute("aria-hidden", "true"); li.appendChild(o);
        li.appendChild(el("span", null, "Alle " + QP.hhmm(p0.t) + ", " + (gr.linea.numero ? "Linea " + gr.linea.numero : "Linea " + gr.linea.nome) + " verso " + gr.verso.replace(/ - /g, ", ") +
          ", da " + nomeF(p0.da) +
          (oggi && !$("ora").value ? ", " + QP.traQuanto(p0.t - c.now) : "") +
          (gr.prossime.length > 1 ? ". Poi alle " + gr.prossime.slice(1, 3).map(function (x) { return QP.hhmm(x.t); }).join(" e alle ") : "") + "." +
          (p0.dubbio ? " Corsa da verificare: " + p0.dubbio + "." : "")));
        ol.appendChild(li);
      });
      sec.appendChild(ol); box.appendChild(sec);
    }
    var pref = store("qp-tragitti") || [];
    $("salva").textContent = indicePref(pref) >= 0 ? "Togli dai tuoi tragitti" : "Salva questo tragitto";
    var primo = sel.a ? (c.andata[0] && c.andata[0][0].parte) : (c.gruppi[0] && c.gruppi[0].prossime[0].t);
    ultimoStato = JSON.stringify([primo, sel.a ? c.ritorno.length : c.gruppi.length]);
    return c;
  }

  function frase(c) {
    var mDa = sel.da.ids.length > 1, mA = sel.a && sel.a.ids.length > 1;
    function prime(lista, cd, ca) { return lista.slice(0, 3).map(function (v) { return descriviViaggio(v, cd, ca); }).join(" Poi: "); }
    if (!sel.a) {
      if (!c.gruppi.length) return "Nessun'altra partenza da " + sel.da.breve + ".";
      return "Partenze da " + sel.da.breve + ". " + c.gruppi.slice(0, 4).map(function (gr) {
        return (gr.linea.numero ? "Linea " + gr.linea.numero : "Linea " + gr.linea.nome) + " verso " + gr.verso.replace(/ - /g, ", ") + " alle " + QP.hhmm(gr.prossime[0].t) + " da " + nomeF(gr.prossime[0].da);
      }).join(". ") + ".";
    }
    return (c.allargato ? "Dalla fermata scelta non passano bus per questo tragitto, ecco quelli dalle altre fermate dello stesso paese. " : "") +
      (c.domani ? "Oggi non ci sono più bus. Domani, andata da " : "Andata da ") + sel.da.breve + " " + a_(sel.a.breve) + ": " + (c.andata.length ? prime(c.andata, mDa, mA) : "nessun bus.") +
      " Ritorno: " + (c.ritorno.length ? prime(c.ritorno, mA, mDa) : "nessun bus dopo il tuo arrivo.");
  }

  function cerca(parla) {
    if (!D) return;
    if (!sel.da) { annuncia("Prima scegli da dove parti dall'elenco sotto il campo Parto da."); $("da").focus(); return; }
    quanti = { andata: 6, ritorno: 6 };
    store("qp-ultimo", { da: sel.da, a: sel.a });
    $("risposta").hidden = false;
    var c = disegna();
    if (parla) { var h = $("h-andata"); if (h) h.focus(); annuncia(frase(c)); }
  }

  function indicePref(pref) {
    var k = JSON.stringify([sel.da && sel.da.ids, sel.a && sel.a.ids]);
    for (var i = 0; i < pref.length; i++) if (JSON.stringify([pref[i].da.ids, pref[i].a && pref[i].a.ids]) === k) return i;
    return -1;
  }

  collega("da"); collega("a");
  $("a").addEventListener("input", function () { if (!$("a").value.trim()) sel.a = null; });
  $("modulo").addEventListener("submit", function (e) { e.preventDefault(); cerca(true); });
  $("inverti").addEventListener("click", function () {
    if (!sel.da || !sel.a) { annuncia("Per invertire scegli sia la partenza sia l'arrivo."); return; }
    var x = sel.da; sel.da = sel.a; sel.a = x; $("da").value = sel.da.breve; $("a").value = sel.a.breve; cerca(true);
  });
  $("giorno").addEventListener("change", function () {
    $("ora").value = "";
    if (sel.da) { cerca(false); annuncia($("giorno").options[$("giorno").selectedIndex].text + ", orari " + ($("giorno").value === "0" ? "da adesso" : "da inizio giornata") + ". " + frase(calcola())); }
  });
  $("ora").addEventListener("change", function () { if (sel.da) cerca(false); });
  $("leggi").addEventListener("click", function () { annuncia(frase(disegna())); });
  $("salva").addEventListener("click", function () {
    var pref = store("qp-tragitti") || [], i = indicePref(pref);
    if (i >= 0) { pref.splice(i, 1); annuncia("Tragitto tolto."); } else { pref.push({ da: sel.da, a: sel.a }); annuncia("Tragitto salvato."); }
    store("qp-tragitti", pref); mostraPreferiti(); disegna();
  });
  // ogni minuto aggiorna i risultati solo se è cambiato qualcosa (non sposta lo screen reader)
  setInterval(function () {
    if (!sel.da || $("risposta").hidden || $("ora").value || $("giorno").value !== "0") return;
    var c = calcola();
    var primo = sel.a ? (c.andata[0] && c.andata[0][0].parte) : (c.gruppi[0] && c.gruppi[0].prossime[0].t);
    var f = JSON.stringify([primo, sel.a ? c.ritorno.length : c.gruppi.length]);
    if (f !== ultimoStato) { ultimoStato = f; disegna(); }
  }, 60000);
  // --- installazione come app (PWA)
  var promptInstall = null;
  // Dentro l'app installata il pulsante non serve. L'app si apre con "?app=1" (start_url nel manifest);
  // i modi di visualizzazione coprono le installazioni fatte prima di quel parametro.
  function installata() {
    var modi = ["standalone", "fullscreen", "minimal-ui", "window-controls-overlay"];
    var media = window.matchMedia && modi.some(function (m) { return matchMedia("(display-mode: " + m + ")").matches; });
    var daApp = /[?&]app=1\b/.test(location.search) || document.referrer.indexOf("android-app://") === 0;
    try { if (daApp) sessionStorage.setItem("qp-app", "1"); daApp = daApp || sessionStorage.getItem("qp-app") === "1"; } catch (e) {}
    if (media || navigator.standalone === true || daApp) { store("qp-installata", true); return true; }
    return store("qp-installata") === true;  // installata su questo dispositivo o pulsante nascosto a mano
  }
  function istruzioni() {
    var ua = navigator.userAgent;
    if (/iPhone|iPad|iPod/.test(ua)) return "Su iPhone e iPad: tocca il pulsante Condividi del browser, poi scegli Aggiungi alla schermata Home.";
    if (/SamsungBrowser/.test(ua)) return "In Samsung Internet: apri il menu, scegli Aggiungi pagina a, poi Schermata Home.";
    if (/Firefox/.test(ua) && /Android/.test(ua)) return "In Firefox: apri il menu con i tre puntini e scegli Installa.";
    if (/Firefox/.test(ua)) return "Firefox per computer non installa le app web: apri questa pagina con Chrome o Edge e premi di nuovo Installa l'app.";
    if (/Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome/.test(ua)) return "In Safari su Mac: apri il menu File e scegli Aggiungi al Dock.";
    return "Apri il menu del browser e scegli Installa app, oppure Aggiungi a schermata Home.";
  }
  // Il riquadro compare solo nel browser, quando il browser stesso dice che l'app si può installare
  // (evento beforeinstallprompt, che nell'app già installata non arriva mai). Su iPhone quell'evento non
  // esiste: lì si mostrano le istruzioni, ma solo fuori dall'app installata.
  if (!installata() && /iPhone|iPad|iPod/.test(navigator.userAgent) && navigator.standalone === false) {
    $("installa").hidden = false;
    $("installa-aiuto").textContent = istruzioni();
  }
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault(); promptInstall = e;
    if (installata()) return;
    $("installa").hidden = false;
    $("installa-aiuto").textContent = "Premi il pulsante: il browser ti chiederà la conferma e l'app comparirà tra le tue app.";
  });
  window.addEventListener("appinstalled", function () { store("qp-installata", true); $("installa").hidden = true; annuncia("App installata. La trovi tra le tue app."); });
  $("installa-no").addEventListener("click", function () { store("qp-installata", true); $("installa").hidden = true; annuncia("Fatto, il riquadro per installare non comparirà più su questo dispositivo."); });
  $("installa-btn").addEventListener("click", function () {
    if (!promptInstall) { annuncia(istruzioni()); return; }
    promptInstall.prompt();
    promptInstall.userChoice.then(function (r) {
      annuncia(r.outcome === "accepted" ? "Installazione avviata." : "Installazione annullata. Puoi riprovare quando vuoi.");
      promptInstall = null;
    });
  });

  riempiGiorni();
  // a mezzanotte (o quando riapri l'app il giorno dopo) l'elenco dei giorni si aggiorna
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && giornoCaricato !== new Date().toDateString()) { riempiGiorni(); if (sel.da) cerca(false); }
  });
  carica();
})();
