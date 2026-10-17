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
  var cache = {};
  function corseDelGiorno(D, d) {
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

  // Viaggi da un insieme di fermate a un altro, diretti o con un cambio, che partono dopo "dopo" (minuti).
  function viaggi(D, origini, destinazioni, d, dopo, max) {
    var X = corseDelGiorno(D, d), out = [];
    var isO = {}, isD = {};
    origini.forEach(function (o) { isO[o] = 1; });
    destinazioni.forEach(function (x) { isD[x] = 1; });
    function tratta(T, i, j) {
      return { linea: T.L, verso: verso(D, T), da: T.s[i][0], a: T.s[j][0], parte: T.s[i][1], arriva: T.s[j][1], dubbio: T.dubbio };
    }
    origini.forEach(function (o) {
      (X.perFermata[o] || []).forEach(function (tp) {
        var T = tp[0], i = tp[1];
        if (T.s[i][1] < dopo) return;
        // diretto
        for (var j = i + 1; j < T.s.length; j++) {
          if (isD[T.s[j][0]]) { out.push([tratta(T, i, j)]); return; }
        }
        // con un cambio: scendi a una fermata k e prendi un'altra corsa che arriva a destinazione
        for (var k = i + 1; k < T.s.length; k++) {
          var x = T.s[k][0], arr = T.s[k][1];
          if (isO[x]) continue;
          (X.perFermata[x] || []).forEach(function (tp2) {
            var T2 = tp2[0], p = tp2[1];
            if (T2 === T || T2.L === T.L && verso(D, T2) === verso(D, T)) return;
            var t2 = T2.s[p][1];
            if (t2 < arr + CAMBIO_MIN || t2 > arr + CAMBIO_MAX) return;
            for (var q = p + 1; q < T2.s.length; q++) {
              if (isD[T2.s[q][0]]) { out.push([tratta(T, i, k), tratta(T2, p, q)]); return; }
            }
          });
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
    var visti = {};
    out = out.filter(function (v) {
      var k = v.map(function (t) { return t.linea.id + t.parte + "-" + t.arriva; }).join("|");
      if (visti[k]) return false; visti[k] = 1; return true;
    });
    out.sort(function (a, b) { return a[0].parte - b[0].parte || a[a.length - 1].arriva - b[b.length - 1].arriva; });
    return max ? out.slice(0, max) : out;
  }

  // Ricerca: comuni (tutte le fermate del paese) e singole fermate.
  function comune(nome) { return nome.split(" - ")[0].trim(); }
  function cerca(D, testo, max) {
    var q = norm(testo).split(" ").filter(Boolean);
    if (!q.length) return [];
    var multiSede = D.fermate_sede ? D.fermate_sede.some(function (x) { return x !== D.fermate_sede[0]; }) : false;
    var sede = function (i) { return D.fermate_sede ? D.fermate_sede[i] : "aosta"; };
    var etSede = function (s) { return multiSede && D.sedi ? ", zona " + D.sedi[s] : ""; };
    var comuni = {}, singole = [];
    D.fermate.forEach(function (f, i) {
      var n = norm(f);
      if (!q.every(function (w) { return n.indexOf(w) >= 0; })) return;
      singole.push(i);
      var c = comune(f), key = c + "|" + sede(i);
      if (q.every(function (w) { return norm(c).indexOf(w) >= 0; })) (comuni[key] || (comuni[key] = { nome: c, sede: sede(i), ids: [] })).ids.push(i);
    });
    var res = [];
    Object.keys(comuni).forEach(function (k) {
      var c = comuni[k];
      if (c.ids.length > 1) res.push({ etichetta: c.nome + ", tutte le " + c.ids.length + " fermate" + etSede(c.sede), breve: c.nome, ids: c.ids });
    });
    res.sort(function (a, b) { return a.breve.length - b.breve.length; });
    singole.sort(function (a, b) { return D.fermate[a].length - D.fermate[b].length; });
    singole.forEach(function (i) {
      var n = D.fermate[i].replace(/ - /g, ", ");
      res.push({ etichetta: n + etSede(sede(i)), breve: n, ids: [i] });
    });
    return res.slice(0, max || 15);
  }

  function hhmm(m) { m = ((m % 1440) + 1440) % 1440; return Math.floor(m / 60) + ":" + pad(m % 60); }
  function durata(min) {
    var h = Math.floor(min / 60), r = min % 60;
    return (h ? (h === 1 ? "1 ora" : h + " ore") + (r ? " e " : "") : "") + (r || !h ? (r === 1 ? "1 minuto" : r + " minuti") : "");
  }
  function traQuanto(min) { return min <= 0 ? "adesso" : "tra " + durata(min); }

  return { infoGiorno: infoGiorno, versione: versione, circola: circola, partenze: partenze, viaggi: viaggi, cerca: cerca,
    hhmm: hhmm, durata: durata, traQuanto: traQuanto, ymd: ymd, norm: norm, corseDelGiorno: corseDelGiorno };
})();
if (typeof module !== "undefined") module.exports = QP;
