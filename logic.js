// Calcolo di partenze e viaggi "da ... a ...": nessuna dipendenza, usato dall'app e dai test (node).
var QP = (function () {
  var GIORNI = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];
  var MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
  var CAMBIO_MIN = 3, CAMBIO_MAX = 120;
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function norm(s) { return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }

  // Tipo di giorno per una sede. scuola: true / false / null (calendario scolastico non configurato).
  function infoGiorno(d, cal, sede) {
    var s = ymd(d), js = d.getDay(), wd = js === 0 ? 7 : js;
    var festivo = wd === 7 || cal.festivi.indexOf(s) >= 0;
    var sc = (cal.scuola || {})[sede || "aosta"], scuola = null, fuori = false;
    if (festivo) scuola = false;
    else if (sc) {
      var chiusa = sc.chiusure.some(function (r) { return s >= r[0] && s <= r[1]; });
      scuola = s >= sc.inizio && s <= sc.fine && !chiusa && (wd !== 6 || sc.sabato_scolastico !== false);
      fuori = s > sc.fine.slice(0, 4) + "-09-01";
      if (fuori) scuola = null;
    }
    return { data: s, wd: wd, festivo: festivo, scuola: scuola, fuoriCalendario: fuori,
      testo: GIORNI[js] + " " + d.getDate() + " " + MESI[d.getMonth()],
      tipo: festivo ? "festivo" : (scuola === true ? "feriale, con scuole aperte" : scuola === false ? "feriale, scuole chiuse" : "feriale") };
  }

  function versione(L, data) {
    var best = null;
    L.versioni.forEach(function (v) {
      if (v.dal <= data && (!v.al || v.al >= data) && (!best || v.dal >= best.dal)) best = v;
    });
    return best;
  }

  // 0 = non circola, 1 = circola, 2 = circola solo se è (o non è) giorno di scuola, ma il calendario non è noto
  function circola(c, g) {
    var wd = String(g.wd), giorni = c.g || "", incerto = false;
    function scuolaServe(vuole) { if (g.scuola === null) { incerto = true; return true; } return g.scuola === vuole; }
    if (c.t !== "GG") {
      if (c.t === "FEST") { if (!g.festivo) return 0; }
      else {
        if (g.festivo) return 0;
        if (giorni && /^[1-8]+$/.test(giorni) && giorni.indexOf(wd) < 0) return 0;
        if (c.t === "SCOL" && !scuolaServe(true)) return 0;
        if (c.t === "NOSCOL" && !scuolaServe(false)) return 0;
      }
    }
    var regole = c.r || [];
    for (var i = 0; i < regole.length; i++) {
      var r = regole[i];
      if (r.tipo === "solo_non_scuola" && !scuolaServe(false)) return 0;
      if (r.tipo === "solo_scuola" && (!scuolaServe(true) || (r.giorni && r.giorni.indexOf(g.wd) < 0))) return 0;
      if (r.tipo === "no_scuola_giorni" && r.giorni.indexOf(g.wd) >= 0 && g.scuola !== false) {
        if (g.scuola === true) return 0; incerto = true;
      }
      if (r.tipo === "no_giorni" && r.giorni.indexOf(g.wd) >= 0) return 0;
      if (r.tipo === "periodo" && (g.data < r.dal || g.data > r.al)) return 0;
      if (r.tipo === "no_date" && r.date.indexOf(g.data.slice(5)) >= 0) return 0;
      if (r.tipo === "no_periodo" && g.data.slice(5) >= r.dal && g.data.slice(5) <= r.al) return 0;
    }
    return incerto ? 2 : 1;
  }

  // Corse che circolano in una data, con indice per fermata. Calcolato una volta per data.
  // Nomi delle fermate scritti in modi diversi dalle varie zone: "TO c.so Bolzano" -> "Torino - c.so Bolzano",
  // "Cremona, Via Dante 3881" (col codice fermata) -> "Cremona - Via Dante", "CREMA Piazzale X" -> "Crema - Piazzale X".
  function maiuscola(w) { return w.split(/([ -])/).map(function (p) { return p.charAt(0) + p.slice(1).toLowerCase(); }).join(""); }
  function pulisciNome(f) {
    var s = f.replace(/\s+/g, " ").trim(), m;
    if ((m = /^TO\s+(.+)$/.exec(s))) return "Torino - " + m[1];
    if ((m = /^([A-ZÀ-Ý][a-zà-ÿ'’]+(?:[ -][A-ZÀ-Ýa-zà-ÿ'’]+){0,3}?)\s*,[\s,]*(.+)$/.exec(s)) && !/ - /.test(s)) {
      var resto = m[2].replace(/\s+\d{2,5}$/, "").replace(/\s*,\s*$/, "");
      return m[1] + " - " + resto;
    }
    if ((m = /^([A-ZÀ-Ý][A-ZÀ-Ý'’]{2,})\s+(\S.*)$/.exec(s)) && !/ - /.test(s) && (/[a-zà-ÿ]/.test(m[2]) || /^F\.?S\.?$/.test(m[2]))) return maiuscola(m[1]) + " - " + m[2];
    return s;
  }
  function prepara(D) {
    if (D._pronto) return D;
    D.fermate = D.fermate.map(pulisciNome);
    D._pronto = true;
    return D;
  }
  // stessa fermata con due id (zone diverse, nomi scritti in modo diverso): si può cambiare bus lì
  function chiaveFermata(f) {
    var c = comune(f), r = f.indexOf(" - ") >= 0 ? f.slice(f.indexOf(" - ") + 3) : f.slice(c.length);
    if (/porta susa/i.test(f) && norm(c) === "torino") return "torino|porta susa";
    return norm(c) + "|" + norm(r).replace(/\b(p ?za|p le|piazzale|piazza)\b/g, "piazza");
  }
  function gemelle(D) {
    if (D._gemelle) return D._gemelle;
    var per = {}, out = {};
    D.fermate.forEach(function (f, i) { var k = chiaveFermata(f); (per[k] || (per[k] = [])).push(i); });
    Object.keys(per).forEach(function (k) { var l = per[k]; if (l.length > 1) l.forEach(function (i) { out[i] = l; }); });
    return (D._gemelle = out);
  }
  function conGemelle(D, ids) {
    var G = gemelle(D), v = {}, out = [];
    ids.forEach(function (i) { (G[i] || [i]).forEach(function (j) { if (!v[j]) { v[j] = 1; out.push(j); } }); });
    return out;
  }

  var cache = {};
  function corseDelGiorno(D, d) {
    prepara(D);
    var key = ymd(d);
    if (cache.k === key && cache.D === D) return cache.v;
    var giorni = {}, corse = [], perFermata = {};
    D.linee.forEach(function (L) {
      var sede = L.sede || "aosta";
      var g = giorni[sede] || (giorni[sede] = infoGiorno(d, D.calendario, sede));
      var v = versione(L, g.data);
      if (!v) return;
      v.corse.forEach(function (c) {
        var ok = circola(c, g);
        if (!ok) return;
        var dubbio = c.d || (ok === 2 ? "dipende dal calendario scolastico di questa zona, non ancora configurato" : null);
        var T = { L: L, s: c.s, dubbio: dubbio, n: corse.length };
        corse.push(T);
        c.s.forEach(function (x, p) { (perFermata[x[0]] || (perFermata[x[0]] = [])).push(p === c.s.length - 1 ? null : [T, p]); });
      });
    });
    Object.keys(perFermata).forEach(function (k) { perFermata[k] = perFermata[k].filter(Boolean); });
    cache = { k: key, D: D, v: { corse: corse, perFermata: perFermata, giorni: giorni } };
    return cache.v;
  }

  function verso(D, T) { return D.fermate[T.s[T.s.length - 1][0]]; }

  // Partenze da un insieme di fermate, raggruppate per linea e destinazione finale della corsa.
  function partenze(D, origini, d) {
    var X = corseDelGiorno(D, d), gruppi = {};
    origini = conGemelle(D, origini);
    origini.forEach(function (o) {
      (X.perFermata[o] || []).forEach(function (tp) {
        var T = tp[0], v = verso(D, T), key = T.L.id + "|" + v;
        var gr = gruppi[key] || (gruppi[key] = { linea: T.L, verso: v, corse: [] });
        gr.corse.push({ t: T.s[tp[1]][1], da: o, dubbio: T.dubbio });
      });
    });
    return Object.keys(gruppi).map(function (k) {
      var gr = gruppi[k];
      gr.corse.sort(function (a, b) { return a.t - b.t; });
      gr.corse = gr.corse.filter(function (c, n) { return n === 0 || c.t - gr.corse[n - 1].t > 1; });
      return gr;
    });
  }


  function trattaDi(D, T, i, j) {
    return { linea: T.L, verso: verso(D, T), da: T.s[i][0], a: T.s[j][0], parte: T.s[i][1], arriva: T.s[j][1], dubbio: T.dubbio, s: T.s, i: i, j: j };
  }

  // --- Viaggi con più cambi (quando non basta un cambio solo), con l'algoritmo "connection scan":
  // tutti i tratti fermata->fermata del giorno in ordine di partenza, si segna l'arrivo più presto a ogni fermata.
  var CAMBIO_PIEDI = 5, MAX_TRATTE = 5;
  function connessioni(X) {
    if (X.conn) return X.conn;
    var c = [];
    X.corse.forEach(function (T) { for (var p = 0; p < T.s.length - 1; p++) c.push([T.s[p][1], T.s[p + 1][1], T.s[p][0], T.s[p + 1][0], T, p]); });
    c.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    return (X.conn = c);
  }
  function scansione(D, X, origini, isD, dopo) {
    var C = connessioni(X), G = gemelle(D), n = D.fermate.length;
    var arr = new Float64Array(n).fill(Infinity), pronto = new Float64Array(n).fill(Infinity), J = new Array(n);
    var sale = new Int32Array(X.corse.length).fill(-1), best = Infinity, fine = -1;
    origini.forEach(function (o) { arr[o] = dopo; pronto[o] = dopo; });
    var lo = 0, hi = C.length;
    while (lo < hi) { var m = (lo + hi) >> 1; if (C[m][0] < dopo) lo = m + 1; else hi = m; }
    for (var k = lo; k < C.length; k++) {
      var c = C[k], T = c[4];
      if (c[0] > best) break;
      if (sale[T.n] < 0) { if (pronto[c[2]] > c[0]) continue; sale[T.n] = c[5]; }
      var x = c[3], ta = c[1];
      if (ta >= arr[x]) continue;
      arr[x] = ta; J[x] = { T: T, i: sale[T.n], j: c[5] + 1 };
      if (isD[x] && ta < best) { best = ta; fine = x; }
      if (ta + CAMBIO_MIN < pronto[x]) pronto[x] = ta + CAMBIO_MIN;
      (G[x] || []).forEach(function (y) {  // stessa fermata con un altro nome: ci si arriva a piedi
        if (y === x || ta >= arr[y]) return;
        arr[y] = ta; J[y] = { piedi: x };
        if (ta + CAMBIO_PIEDI < pronto[y]) pronto[y] = ta + CAMBIO_PIEDI;
      });
    }
    if (fine < 0) return null;
    var out = [], z = fine, giri = 0;
    while (J[z] && giri++ < 30) {
      if (J[z].piedi != null) { z = J[z].piedi; continue; }
      out.unshift(trattaDi(D, J[z].T, J[z].i, J[z].j)); z = J[z].T.s[J[z].i][0];
    }
    return out.length ? out : null;
  }
  function itinerari(D, origini, destinazioni, d, dopo, max) {
    var X = corseDelGiorno(D, d), isD = {}, out = [];
    origini = conGemelle(D, origini); destinazioni = conGemelle(D, destinazioni);
    destinazioni.forEach(function (x) { isD[x] = 1; });
    var t = dopo, giri = 0;
    function arrivo(v) { return v[v.length - 1].arriva; }
    while (out.length < (max || 8) && giri++ < 40) {
      var v = scansione(D, X, origini, isD, t);
      if (!v) break;
      // stesso arrivo partendo più tardi? meglio (meno attesa)
      for (var g2 = 0; g2 < 10; g2++) {
        var w = scansione(D, X, origini, isD, v[0].parte + 1);
        if (!w || arrivo(w) > arrivo(v)) break;
        v = w;
      }
      t = v[0].parte + 1;
      if (v.length > MAX_TRATTE) continue;
      // se hai scelto un paese intero, scendi all'ultima sua fermata (come nei viaggi diretti)
      var u = v[v.length - 1];
      if (destinazioni.length > 1) for (var q = u.j + 1; q < u.s.length; q++) if (isD[u.s[q][0]]) { u.j = q; u.a = u.s[q][0]; u.arriva = u.s[q][1]; }
      out.push(v);
    }
    return out;
  }

  // Le fermate raggiungibili con i bus caricati, in qualsiasi giorno e con quanti cambi servono:
  // serve a dire "queste linee non sono collegate tra loro" invece di un generico "nessun bus".
  function collegato(D, origini, destinazioni) {
    prepara(D);
    var G = gemelle(D), preso = {}, coda = conGemelle(D, origini).slice(), dest = {};
    conGemelle(D, destinazioni).forEach(function (x) { dest[x] = 1; });
    if (!D._perFermata) {
      var pf = {};
      D.linee.forEach(function (L) { L.versioni.forEach(function (v) { v.corse.forEach(function (c) { c.s.forEach(function (x, p) { (pf[x[0]] || (pf[x[0]] = [])).push([c.s, p]); }); }); }); });
      D._perFermata = pf;
    }
    coda.forEach(function (x) { preso[x] = 1; });
    while (coda.length) {
      var x = coda.pop();
      if (dest[x]) return true;
      (D._perFermata[x] || []).forEach(function (cp) {
        for (var p = cp[1] + 1; p < cp[0].length; p++) {
          var y = cp[0][p][0];
          (G[y] || [y]).forEach(function (z) { if (!preso[z]) { preso[z] = 1; coda.push(z); } });
        }
      });
    }
    return false;
  }

  // Viaggi da un insieme di fermate a un altro, diretti o con un cambio, che partono dopo "dopo" (minuti).
  function viaggi(D, origini, destinazioni, d, dopo, max) {
    var X = corseDelGiorno(D, d), out = [], G = gemelle(D);
    origini = conGemelle(D, origini); destinazioni = conGemelle(D, destinazioni);
    var isO = {}, isD = {};
    origini.forEach(function (o) { isO[o] = 1; });
    destinazioni.forEach(function (x) { isD[x] = 1; });
    function tratta(T, i, j) {
      return trattaDi(D, T, i, j);
    }
    origini.forEach(function (o) {
      (X.perFermata[o] || []).forEach(function (tp) {
        var T = tp[0], i = tp[1];
        if (T.s[i][1] < dopo) return;
        // se hai scelto un paese intero, sali alla prima sua fermata dove passa il bus (di solito il capolinea)
        for (var z = 0; z < i; z++) if (isO[T.s[z][0]] && T.s[z][1] >= dopo) return;
        // diretto: scendi all'ultima fermata del paese di arrivo (es. Torino Porta Nuova, non la prima periferia)
        var ultima = -1;
        for (var j = i + 1; j < T.s.length; j++) if (isD[T.s[j][0]]) { ultima = j; if (destinazioni.length === 1) break; }
        if (ultima > 0) { out.push([tratta(T, i, ultima)]); return; }
        // con un cambio: scendi a una fermata k e prendi un'altra corsa che arriva a destinazione
        for (var k = i + 1; k < T.s.length; k++) {
          var x = T.s[k][0], arr = T.s[k][1];
          if (isO[x]) continue;
          (G[x] || [x]).forEach(function (y) { (X.perFermata[y] || []).forEach(function (tp2) {
            var T2 = tp2[0], p = tp2[1];
            if (T2 === T || T2.L === T.L && verso(D, T2) === verso(D, T)) return;
            var t2 = T2.s[p][1];
            if (t2 < arr + CAMBIO_MIN || t2 > arr + CAMBIO_MAX) return;
            var uq = -1;
            for (var q = p + 1; q < T2.s.length; q++) if (isD[T2.s[q][0]]) { uq = q; if (destinazioni.length === 1) break; }
            if (uq > 0) out.push([tratta(T, i, k), tratta(T2, p, uq)]);
          }); });
        }
      });
    });
    // tieni solo i viaggi non peggiori di un altro (che parte più tardi e arriva prima, o con meno cambi)
    out = out.filter(function (v) {
      var p = v[0].parte, a = v[v.length - 1].arriva;
      return !out.some(function (w) {
        if (w === v) return false;
        var wp = w[0].parte, wa = w[w.length - 1].arriva;
        var meglio = wp >= p && wa <= a && w.length <= v.length;
        var strett = wp > p || wa < a || w.length < v.length;
        return meglio && strett;
      });
    });
    // lo stesso bus può comparire in due orari (es. brochure Torino e Milano): una sola volta, preferendo la linea col numero
    out.sort(function (a, b) { return a.filter(function (t) { return !t.linea.numero; }).length - b.filter(function (t) { return !t.linea.numero; }).length; });
    var visti = {};
    out = out.filter(function (v) {
      var k = v.map(function (t) { return t.da + "@" + t.parte + ">" + t.a + "@" + t.arriva; }).join("|");
      if (visti[k]) return false; visti[k] = 1; return true;
    });
    out.sort(function (a, b) { return a[0].parte - b[0].parte || a[a.length - 1].arriva - b[b.length - 1].arriva; });
    return max ? out.slice(0, max) : out;
  }

  // Ricerca: comuni (tutte le fermate del paese) e singole fermate.
  // "Aosta - Autostazione" -> "Aosta"; "TORINO Autostazione" (senza trattino) -> "Torino"
  function comune(nome) {
    nome = pulisciNome(nome);
    var c = nome.split(" - ")[0].trim();
    if (c === nome.trim()) {
      var m = /^([A-ZÀ-Ý][A-ZÀ-Ý'’]{2,})\s/.exec(c);
      if (m) c = m[1].charAt(0) + m[1].slice(1).toLowerCase();
    }
    return c;
  }
  // tutte le fermate dello stesso paese (in qualsiasi zona) delle fermate date
  function stessoPaese(D, ids) {
    var paesi = {}, out = [];
    ids.forEach(function (i) { paesi[norm(comune(D.fermate[i]))] = 1; });
    D.fermate.forEach(function (f, i) { if (paesi[norm(comune(f))]) out.push(i); });
    return out;
  }
  // Quante corse passano da ogni fermata: serve a mettere in cima le fermate principali (autostazioni, stazioni).
  function traffico(D) {
    if (D._traffico) return D._traffico;
    var n = D.fermate.map(function () { return 0; });
    D.linee.forEach(function (L) { (L.versioni[0] || { corse: [] }).corse.forEach(function (c) { c.s.forEach(function (x) { n[x[0]]++; }); }); });
    return (D._traffico = n);
  }
  // Elenco per il menu: prima il paese (tutte le sue fermate, scritto solo col nome del paese),
  // poi le singole fermate, le più servite per prime.
  // fermate servite dalle stesse linee delle fermate date (per mettere in cima quelle davvero collegate)
  function collegate(D, ids) {
    var su = {}, out = {};
    ids.forEach(function (i) { su[i] = 1; });
    D.linee.forEach(function (L) {
      var corse = (L.versioni[0] || { corse: [] }).corse;
      if (corse.some(function (c) { return c.s.some(function (x) { return su[x[0]]; }); }))
        corse.forEach(function (c) { c.s.forEach(function (x) { out[x[0]] = 1; }); });
    });
    return out;
  }
  function cerca(D, testo, max, vicino) {
    var q = norm(testo).split(" ").filter(Boolean);
    if (!q.length) return [];
    prepara(D);
    var tr = traffico(D), comuni = {}, singole = [], col = vicino && vicino.length ? collegate(D, vicino) : null;
    D.fermate.forEach(function (f, i) {
      var n = norm(f);
      if (!q.every(function (w) { return n.indexOf(w) >= 0; })) return;
      if (!tr[i]) return;  // fermata senza corse nell'orario in vigore
      singole.push(i);
      var c = comune(f), k = norm(c);
      if (q.every(function (w) { return k.indexOf(w) >= 0; })) (comuni[k] || (comuni[k] = { nome: c, ids: [], peso: 0 })).ids.push(i), comuni[k].peso += tr[i];
    });
    var res = Object.keys(comuni).map(function (k) { return comuni[k]; })
      .filter(function (c) { return c.ids.length > 1; })
      .sort(function (a, b) {  // il paese che inizia con quanto scritto prima, poi il più servito
        var pa = norm(a.nome).indexOf(q[0]) === 0 ? 0 : 1, pb = norm(b.nome).indexOf(q[0]) === 0 ? 0 : 1;
        return pa - pb || b.peso - a.peso;
      })
      .map(function (c) { return { etichetta: c.nome, breve: c.nome, ids: c.ids }; });
    // la stessa fermata può esistere in due zone (es. Aosta Autostazione): una sola voce con tutti e due gli id
    var viste = {};
    singole.sort(function (a, b) { return (col ? (col[b] ? 1 : 0) - (col[a] ? 1 : 0) : 0) || tr[b] - tr[a]; }).forEach(function (i) {
      var n = D.fermate[i].replace(/ - /g, ", "), k = norm(n);
      if (viste[k]) { viste[k].ids.push(i); return; }
      viste[k] = { etichetta: n, breve: n, ids: [i] };
      res.push(viste[k]);
    });
    return res.slice(0, max || 15);
  }

  function hhmm(m) { m = ((m % 1440) + 1440) % 1440; return Math.floor(m / 60) + ":" + pad(m % 60); }
  function durata(min) {
    var h = Math.floor(min / 60), r = min % 60;
    return (h ? (h === 1 ? "1 ora" : h + " ore") + (r ? " e " : "") : "") + (r || !h ? (r === 1 ? "1 minuto" : r + " minuti") : "");
  }
  function traQuanto(min) { return min <= 0 ? "adesso" : "tra " + durata(min); }

  return { prepara: prepara, pulisciNome: pulisciNome, infoGiorno: infoGiorno, versione: versione, circola: circola, partenze: partenze, viaggi: viaggi, itinerari: itinerari, collegato: collegato, cerca: cerca,
    hhmm: hhmm, durata: durata, traQuanto: traQuanto, ymd: ymd, norm: norm, corseDelGiorno: corseDelGiorno,
    comune: comune, stessoPaese: stessoPaese };
})();
if (typeof module !== "undefined") module.exports = QP;
