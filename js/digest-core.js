// Copiado do RM2 Digest (mesmo formato do digest.json do reMarkable), com campo de áudio.
// RM2 Digest — lógica pura, usada pelo botão de captura (qmd) e pelo app do AppLoad.
// Regras: só funções de topo, sem literais de regex (use new RegExp), comentários de linha com //.

function dgStr(v) {
    return (v === undefined || v === null) ? "" : ("" + v);
}

function dgClean(t, maxChars) {
    var s = dgStr(t).split("\r\n").join("\n").split("\r").join("\n").split("\u0000").join("");
    s = s.replace(new RegExp("^\\s+|\\s+$", "g"), "");
    var lim = maxChars || 20000;
    return s.length > lim ? s.substring(0, lim) : s;
}

// trecho selecionado: junta as linhas quebradas pela diagramação
function dgCleanQuote(t) {
    var s = dgStr(t).replace(new RegExp("-\\n(?=[a-zà-ú])", "g"), "");
    s = s.replace(new RegExp("\\s*\\n\\s*", "g"), " ").replace(new RegExp("[ \\t]+", "g"), " ");
    return dgClean(s, 6000);
}

function dgEmpty() {
    return { version: 1, seq: 0, items: [], exportedTags: [] };
}

// "pinça óptica, #MEH-PPV" -> ["pinça-óptica", "MEH-PPV"]
function dgParseTags(text) {
    var parts = dgArr(text) || dgStr(text).split(new RegExp("[,;\\n]+"));
    var out = [];
    var seen = {};
    for (var i = 0; i < parts.length; i++) {
        var t = dgStr(parts[i]).replace(new RegExp("^\\s+|\\s+$", "g"), "").replace(new RegExp("^#+"), "");
        t = t.replace(new RegExp("\\s+", "g"), "-").replace(new RegExp("[^0-9A-Za-zÀ-ÖØ-öø-ÿ_/-]", "g"), "");
        t = t.replace(new RegExp("^[-/]+|[-/]+$", "g"), "");
        if (t === "" || new RegExp("^[0-9]+$").test(t)) continue;
        var k = t.toLowerCase();
        if (seen[k]) continue;
        seen[k] = true;
        out.push(t);
    }
    return out;
}

function dgNormItem(it) {
    if (!it || typeof it !== "object") return null;
    var id = dgStr(it.id);
    if (id === "") return null;
    var src = (it.src && typeof it.src === "object") ? it.src : {};
    return {
        id: id,
        created: dgStr(it.created),
        updated: dgStr(it.updated),
        src: { doc: dgStr(src.doc), name: dgStr(src.name) || "Sem fonte" },
        page: Number(it.page) > 0 ? Math.floor(Number(it.page)) : 0,
        pageEnd: Number(it.pageEnd) > Number(it.page) ? Math.floor(Number(it.pageEnd)) : 0,
        area: dgNormArea(it.area),
        pageKey: dgStr(it.pageKey),
        quote: dgStr(it.quote),
        note: dgStr(it.note),
        tags: dgParseTags(dgArr(it.tags) || []),
        audio: dgStr(it.audio),
        images: (dgArr(it.images) || []).map(dgStr).filter(function(x) { return x !== ""; }),
        pageKeyEnd: dgStr(it.pageKeyEnd)
    };
}

// área: caminho do nível 1 para baixo, ex. ["Física", "Óptica", "Pinças ópticas"]
// aceita também listas que não são Array de verdade (vindas do Qt)
function dgArr(a) {
    if (Array.isArray(a)) return a;
    if (a && typeof a === "object" && typeof a.length === "number") return Array.prototype.slice.call(a);
    return null;
}

function dgNormArea(a) {
    var out = [];
    a = dgArr(a);
    if (!a) return out;
    for (var i = 0; i < a.length && out.length < 8; i++) {
        var t = dgStr(a[i]).replace(new RegExp("[›>/#\\[\\]|]+", "g"), " ").replace(new RegExp("\\s+", "g"), " ").replace(new RegExp("^\\s+|\\s+$", "g"), "");
        if (t.length > 60) t = t.substring(0, 60);
        if (t === "") break;
        out.push(t);
    }
    return out;
}

function dgAreaText(a) {
    return (a || []).join(" › ");
}

// tag aninhada do Obsidian: #area/Física/Óptica/Pinças-ópticas
function dgAreaTag(a) {
    if (!a || !a.length) return "";
    return "area/" + a.map(function(x) { return x.replace(new RegExp("\\s+", "g"), "-").replace(new RegExp("[^0-9A-Za-zÀ-ÖØ-öø-ÿ_-]", "g"), ""); }).join("/");
}

function dgAreaStartsWith(a, prefix) {
    if (prefix.length > a.length) return false;
    for (var i = 0; i < prefix.length; i++) if (a[i].toLowerCase() !== prefix[i].toLowerCase()) return false;
    return true;
}

// filhos de um caminho (nível seguinte), com contagem total (incluindo subáreas) e dos trechos só naquela área
function dgAreaChildren(st, path) {
    path = dgNormArea(path);
    var m = {};
    for (var i = 0; i < st.items.length; i++) {
        var a = st.items[i].area;
        if (a.length <= path.length || !dgAreaStartsWith(a, path)) continue;
        var nm = a[path.length], k = nm.toLowerCase();
        if (!m[k]) m[k] = { name: nm, count: 0, direct: 0, deeper: false };
        m[k].count++;
        if (a.length === path.length + 1) m[k].direct++; else m[k].deeper = true;
    }
    var out = Object.keys(m).map(function(k) { return m[k]; });
    out.sort(function(x, y) { return (y.count - x.count) || (x.name.toLowerCase() < y.name.toLowerCase() ? -1 : 1); });
    return out;
}

// junta a continuação do trecho (outra página/coluna); tira o hífen de palavra quebrada
function dgJoinQuote(a, b) {
    var x = dgStr(a).replace(new RegExp("\\s+$"), ""), y = dgCleanQuote(b);
    if (x === "") return y;
    if (y === "") return x;
    if (new RegExp("[A-Za-zÀ-ÿ]-$").test(x) && new RegExp("^[a-zà-ÿ]").test(y)) return x.substring(0, x.length - 1) + y;
    return x + " " + y;
}

function dgPages(it) {
    if (!it.page) return "";
    return "p. " + it.page + (it.pageEnd > it.page ? ("–" + it.pageEnd) : "");
}

function dgSeqOf(id) {
    var n = parseInt(dgStr(id).replace("D", ""), 10);
    return isNaN(n) ? 0 : n;
}

// devolve { store, ok, empty }; ok=false = arquivo ilegível (não gravar por cima)
function dgParse(text) {
    var st = dgEmpty();
    var t = dgStr(text);
    if (t.replace(new RegExp("\\s", "g"), "") === "") return { store: st, ok: true, empty: true };
    var raw;
    try { raw = JSON.parse(t); } catch (e) { return { store: st, ok: false, empty: false }; }
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.items)) return { store: st, ok: false, empty: false };
    var mx = typeof raw.seq === "number" ? raw.seq : 0;
    var seen = {};
    for (var i = 0; i < raw.items.length; i++) {
        var it = dgNormItem(raw.items[i]);
        if (!it || seen[it.id]) continue;
        seen[it.id] = true;
        st.items.push(it);
        if (dgSeqOf(it.id) > mx) mx = dgSeqOf(it.id);
    }
    st.seq = mx;
    if (Array.isArray(raw.exportedTags)) st.exportedTags = raw.exportedTags.map(dgStr);
    return { store: st, ok: true, empty: false };
}

function dgSerialize(st) {
    return JSON.stringify({ version: 1, seq: st.seq, items: st.items, exportedTags: st.exportedTags || [] }, null, 1);
}

function dgWith(st, items, seq) {
    return { version: 1, seq: seq === undefined ? st.seq : seq, items: items, exportedTags: st.exportedTags || [] };
}

function dgAdd(st, f, nowMs) {
    var seq = st.seq + 1;
    var now = new Date(nowMs).toISOString();
    var it = dgNormItem({ id: "D" + seq, created: now, updated: now, src: { doc: f.doc, name: f.name }, page: f.page, pageEnd: f.pageEnd,
                          pageKey: f.pageKey, pageKeyEnd: f.pageKeyEnd, quote: dgCleanQuote(f.quote), note: dgClean(f.note), tags: dgParseTags(f.tags || []), area: f.area || [], audio: f.audio, images: f.images || [] });
    if (!it || (it.quote === "" && it.note === "" && it.images.length === 0)) return { store: st, item: null };
    return { store: dgWith(st, st.items.concat([it]), seq), item: it };
}

function dgUpdate(st, id, patch, nowMs) {
    var found = false;
    var items = st.items.map(function(it) {
        if (it.id !== id) return it;
        found = true;
        var c = JSON.parse(JSON.stringify(it));
        if (patch.note !== undefined) c.note = dgClean(patch.note);
        if (patch.tags !== undefined) c.tags = dgParseTags(patch.tags);
        if (patch.area !== undefined) c.area = dgNormArea(patch.area);
        if (patch.audio !== undefined) c.audio = dgStr(patch.audio);
        if (patch.images !== undefined) c.images = (dgArr(patch.images) || []).map(dgStr).filter(function(x) { return x !== ""; });
        if (patch.quote !== undefined) c.quote = dgClean(patch.quote, 12000);
        if (patch.pageEnd !== undefined) c.pageEnd = Number(patch.pageEnd) > c.page ? Math.floor(Number(patch.pageEnd)) : 0;
        c.updated = new Date(nowMs).toISOString();
        return c;
    });
    return { store: dgWith(st, items), found: found };
}

function dgDelete(st, id) {
    return dgWith(st, st.items.filter(function(it) { return it.id !== id; }));
}

function dgFind(st, id) {
    for (var i = 0; i < st.items.length; i++) if (st.items[i].id === id) return st.items[i];
    return null;
}

// tags com contagem, mais usadas primeiro (empate: ordem alfabética)
function dgTagCounts(st) {
    var m = {};
    var shown = {};
    for (var i = 0; i < st.items.length; i++) {
        var tg = st.items[i].tags;
        for (var j = 0; j < tg.length; j++) {
            var k = tg[j].toLowerCase();
            m[k] = (m[k] || 0) + 1;
            if (!shown[k]) shown[k] = tg[j];
        }
    }
    var out = Object.keys(m).map(function(k) { return { tag: shown[k], count: m[k] }; });
    out.sort(function(a, b) { return (b.count - a.count) || (a.tag.toLowerCase() < b.tag.toLowerCase() ? -1 : 1); });
    return out;
}

// fontes com contagem; a mais recente primeiro
function dgSources(st) {
    var m = {};
    for (var i = 0; i < st.items.length; i++) {
        var it = st.items[i];
        var k = it.src.doc !== "" ? it.src.doc : ("nome:" + it.src.name);
        if (!m[k]) m[k] = { key: k, name: it.src.name, count: 0, last: "" };
        m[k].count++;
        m[k].name = it.src.name;
        if (it.created > m[k].last) m[k].last = it.created;
    }
    var out = Object.keys(m).map(function(k) { return m[k]; });
    out.sort(function(a, b) { return a.last < b.last ? 1 : (a.last > b.last ? -1 : 0); });
    return out;
}

function dgSourceKey(it) {
    return it.src.doc !== "" ? it.src.doc : ("nome:" + it.src.name);
}

function dgFold(s) {
    var t = dgStr(s).toLowerCase();
    var from = "áàâãäéèêëíìîïóòôõöúùûüçñ";
    var to = "aaaaaeeeeiiiiooooouuuucn";
    var out = "";
    for (var i = 0; i < t.length; i++) {
        var p = from.indexOf(t.charAt(i));
        out += p >= 0 ? to.charAt(p) : t.charAt(i);
    }
    return out;
}

// filtro: { source: chave, tags: [..] (todas), text: busca }; ordem: "recentes" | "pagina"
function dgFilter(st, f, order) {
    f = f || {};
    var tags = (f.tags || []).map(function(t) { return t.toLowerCase(); });
    var words = dgFold(f.text || "").split(new RegExp("\\s+")).filter(function(w) { return w !== ""; });
    var out = st.items.filter(function(it) {
        if (f.source && dgSourceKey(it) !== f.source) return false;
        if (f.noArea && it.area.length > 0) return false;
        if (f.area && f.area.length) {
            if (!dgAreaStartsWith(it.area, f.area)) return false;
            if (f.areaExact && it.area.length !== f.area.length) return false;
        }
        var itTags = it.tags.map(function(t) { return t.toLowerCase(); });
        for (var i = 0; i < tags.length; i++) if (itTags.indexOf(tags[i]) < 0) return false;
        if (words.length) {
        var hay = dgFold(it.quote + " " + it.note + " " + it.tags.join(" ") + " " + it.src.name + " " + it.area.join(" "));
            for (var j = 0; j < words.length; j++) if (hay.indexOf(words[j]) < 0) return false;
        }
        return true;
    });
    if (order === "pagina") out.sort(function(a, b) { return (a.page - b.page) || (a.created < b.created ? -1 : 1); });
    else out.sort(function(a, b) { return a.created < b.created ? 1 : (a.created > b.created ? -1 : 0); });
    return out;
}

function dgPad2(n) {
    return (n < 10 ? "0" : "") + n;
}

function dgDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return dgPad2(d.getDate()) + "/" + dgPad2(d.getMonth() + 1) + "/" + d.getFullYear();
}

function dgPreview(s, n) {
    var t = dgStr(s).replace(new RegExp("\\s+", "g"), " ").replace(new RegExp("^\\s+|\\s+$", "g"), "");
    return t.length > n ? (t.substring(0, n - 1) + "…") : t;
}

// mesmo nome de arquivo que o RM2 Notas dá à nota do artigo no Obsidian (para o [[link]] funcionar)
function dgSafeFileName(name) {
    var s = dgStr(name).replace(new RegExp("[^A-Za-z0-9À-ÿ._ -]+", "g"), "_");
    s = s.replace(new RegExp("\\s+", "g"), " ").replace(new RegExp("^[ ._-]+|[ ._-]+$", "g"), "");
    if (s.length > 80) s = s.substring(0, 80);
    return s === "" ? "documento" : s;
}

function dgTagFileName(tag) {
    return dgSafeFileName(dgStr(tag).split("/").join("-"));
}

function dgIsoLocal(ms) {
    var d = new Date(ms);
    return d.getFullYear() + "-" + dgPad2(d.getMonth() + 1) + "-" + dgPad2(d.getDate()) + " " + dgPad2(d.getHours()) + ":" + dgPad2(d.getMinutes());
}

// um trecho em Markdown (callout de citação)
function dgItemMd(it, withSource) {
    var out = [];
    out.push("> [!quote]" + (withSource ? (" " + it.src.name.replace(new RegExp("[\\r\\n]+", "g"), " ")) : "") + (it.page > 0 ? (" · " + dgPages(it)) : ""));
    var q = it.quote.split("\n");
    if (it.quote !== "") for (var i = 0; i < q.length; i++) out.push("> " + q[i]);
    if (it.images && it.images.length) {
        for (var im = 0; im < it.images.length; im++) out.push("> ![[" + it.images[im] + "]]");
    }
    if (it.audio && it.audio !== "") {
        out.push(">");
        out.push("> ![[" + it.audio + "]]");
    }
    if (it.note !== "") {
        out.push(">");
        var n = it.note.split("\n");
        for (var j = 0; j < n.length; j++) out.push("> " + (j === 0 ? "**Nota:** " : "") + n[j]);
    }
    var meta = [];
    if (it.src.name !== "" && it.src.doc !== "") meta.push("[[" + dgSafeFileName(it.src.name) + "]]");
    if (it.area.length) meta.push(dgAreaText(it.area) + " #" + dgAreaTag(it.area));
    if (it.tags.length) meta.push(it.tags.map(function(t) { return "#" + t; }).join(" "));
    meta.push(dgDate(it.created));
    out.push(">");
    out.push("> <small>" + meta.join(" · ") + "</small>");
    return out.join("\n");
}

// arquivos para o Obsidian: [{ path: "Digest.md" | "Tags/<tag>.md", text }]
function dgObsidianFiles(st, nowMs) {
    var files = [];
    var srcs = dgSources(st);
    var head = function(title, n, extra) {
        return ["---", "tags:", "  - remarkable", "  - digest" + (extra ? ("\n  - " + extra) : ""), "atualizado: \"" + dgIsoLocal(nowMs) + "\"", "trechos: " + n, "---", "# " + title, ""].join("\n");
    };
    var body = [head("Digest", st.items.length, "")];
    if (st.items.length === 0) body.push("_Nenhum trecho ainda._\n");
    for (var i = 0; i < srcs.length; i++) {
        var items = dgFilter(st, { source: srcs[i].key }, "pagina");
        body.push("## " + srcs[i].name + " (" + items.length + ")\n");
        for (var j = 0; j < items.length; j++) body.push(dgItemMd(items[j], false) + "\n");
    }
    files.push({ path: "Digest.md", text: body.join("\n") });
    var ab = [head("Digest · Áreas", st.items.filter(function(x) { return x.area.length > 0; }).length, "")];
    var walk = function(path) {
        var ch = dgAreaChildren(st, path);
        for (var c = 0; c < ch.length; c++) {
            var p2 = path.concat([ch[c].name]);
            ab.push("#".repeat(Math.min(6, p2.length + 1)) + " " + ch[c].name + " (" + ch[c].count + ")\n");
            var direct = dgFilter(st, { area: p2, areaExact: true }, "recentes");
            for (var d = 0; d < direct.length; d++) ab.push(dgItemMd(direct[d], true) + "\n");
            walk(p2);
        }
    };
    walk([]);
    var none = dgFilter(st, { noArea: true }, "recentes");
    if (none.length) {
        ab.push("## Sem área (" + none.length + ")\n");
        for (var z = 0; z < none.length; z++) ab.push(dgItemMd(none[z], true) + "\n");
    }
    files.push({ path: "Áreas.md", text: ab.join("\n") });
    var tags = dgTagCounts(st);
    var written = {};
    for (var k = 0; k < tags.length; k++) {
        var tg = tags[k].tag;
        var its = dgFilter(st, { tags: [tg] }, "recentes");
        var b = [head("Digest · #" + tg, its.length, tg)];
        for (var m = 0; m < its.length; m++) b.push(dgItemMd(its[m], true) + "\n");
        var fn = dgTagFileName(tg);
        written[fn.toLowerCase()] = true;
        files.push({ path: "Tags/" + fn + ".md", text: b.join("\n") });
    }
    // tags que sumiram: o arquivo antigo é esvaziado (o mod não consegue apagar arquivos)
    var old = st.exportedTags || [];
    for (var o = 0; o < old.length; o++) {
        if (!written[old[o].toLowerCase()]) files.push({ path: "Tags/" + old[o] + ".md", text: "Nenhum trecho com esta tag no Digest. Pode apagar este arquivo.\n" });
    }
    return files;
}

function dgExportedTagNames(st) {
    return dgTagCounts(st).map(function(t) { return dgTagFileName(t.tag); });
}

// área de transferência do celular (mesmo formato do RM2 Notas)
function dgParseClipIndex(text) {
    var re = new RegExp("^[0-9]{6,12}-[0-9]{1,8}\\.txt$");
    var out = [];
    var lines = dgStr(text).split("\n");
    for (var i = 0; i < lines.length && out.length < 15; i++) {
        var l = lines[i].replace(new RegExp("\\s+$"), "");
        if (re.test(l) && out.indexOf(l) < 0) out.push(l);
    }
    return out;
}

function dgClipTimeMs(name) {
    var n = parseInt(dgStr(name).split("-")[0], 10);
    return isNaN(n) ? 0 : n * 1000;
}
