/**
 * Test del testo da pronunciare (didascalie, lingua, ritmo, prosodia, sillabe).
 * Uso: node tests/speechtext.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadEngine, loadTemplates, city, makeChecker } = require('./_load');

const ctx = vm.createContext({ console });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../assets/js/ui/speechtext.js'), 'utf8'), ctx, { filename: 'speechtext.js' });
const ST = ctx.LL.SpeechText;
const { check, done } = makeChecker();
const kinds = (sp) => sp.cues.map((c) => c.kind).join(',');

// 1. Didascalie
{
    const a = ST.toSpeech('(sussurra) Pronto… ci sono dei ladri in casa. Li sento al piano di sotto.');
    check(a.say === 'Pronto, ci sono dei ladri in casa. Li sento al piano di sotto.', '(sussurra): didascalia tolta, … diventa virgola');
    check(kinds(a) === 'whisper' && a.cues[0].pos === 'start', '(sussurra) -> effetto whisper all\'inizio');

    const b = ST.toSpeech('(sussurra, con il fiato corto) Pronto… sono in casa… sono in casa, li sento!');
    check(kinds(b) === 'whisper' && !/fiato/.test(b.say), '(sussurra, con il fiato corto): una sola didascalia, non letta');

    const c = ST.toSpeech('(interprete in linea) La signora si chiama Anna, è tedesca, in vacanza con il marito.');
    check(kinds(c) === 'interpreter' && c.say.startsWith('La signora'), '(interprete in linea) -> effetto interpreter');
    check(ST.hasCue(c, 'interpreter') && !ST.hasCue(c, 'whisper'), 'hasCue');

    const d = ST.toSpeech('(una lunga pausa) …sì. Scusi. (riattacca)');
    check(d.say === 'sì. Scusi.', 'pausa e riattacco tolti: «' + d.say + '»');
    check(kinds(d) === 'silence,hangup', 'effetti silence e hangup: ' + kinds(d));
    check(d.cues[1].pos === 'end', 'riattacca in fondo alla frase');

    const e = ST.toSpeech('(risate, poi riattaccano)');
    check(e.say === '' && kinds(e) === 'laugh,hangup', 'battuta di sola didascalia: niente da dire, effetti laugh+hangup');

    const f = ST.toSpeech('(silenzio… un fruscio)');
    check(f.say === '' && kinds(f) === 'silence', 'solo fruscio: niente da dire');

    const g = ST.toSpeech('(una vocina) «Ciao! Chi sei? Io sono Sofia!»');
    check(g.say === 'Ciao! Chi sei? Io sono Sofia!' && kinds(g) === 'child', 'vocina: voce di bambino, virgolette tolte');

    const h = ST.toSpeech('Pronto?! La mamma… la mamma non si sveglia! (piange)');
    check(kinds(h) === 'sob' && h.cues[0].pos === 'end' && h.say === 'Pronto?! La mamma, la mamma non si sveglia!', '(piange) in fondo -> sob');

    const i = ST.toSpeech('(una mamma in lontananza: «Sofia, dov\'è il mio telefono?»)');
    check(i.say === '' && kinds(i) === 'ambient', 'descrizione d\'ambiente con parlato tra «» non viene letta');

    const j = ST.toSpeech('Via {location.street} (incerto {x})');
    check(j.say.includes('(incerto {x})') && j.cues.length === 0, 'parentesi con segnaposto «{» mai toccate');

    const k = ST.toSpeech('Abito in via Roma (Centro), al terzo piano.');
    check(k.say.includes('(Centro)') && k.cues.length === 0, 'parentesi che iniziano con maiuscola restano');

    const l = ST.toSpeech('Il mio numero è 3471234567, civico n. 12, ci sono 40 °C.');
    check(l.say.includes('3 4 7 1 2 3 4 5 6 7') && l.say.includes('numero 12') && l.say.includes('40 gradi'), 'cifre lunghe spaziate, n. -> numero, °C -> gradi: ' + l.say);

    check(ST.toSpeech('').say === '' && ST.toSpeech(null).say === '', 'testo vuoto o non valido');
}

// 2. Lingua
{
    const t10 = loadTemplates().find((t) => t.code === 'SAN_010');
    check(ST.langOf(t10.content.opening.calm) === 'en', 'SAN_010 apertura calma: inglese');
    check(ST.langOf(t10.content.opening.panic) === 'en', 'SAN_010 apertura nel panico: inglese (con un po\' di tedesco)');
    check(ST.langOf('Hallo, bitte, mein Mann ist gefallen, schnell!') === 'de', 'tedesco');
    check(ST.langOf('Pronto, c\'è un incendio in via Roma, al secondo piano!') === 'it', 'italiano');
    check(ST.langOf('Sì, no, è caduto in bagno.') === 'it', 'frasi brevi italiane restano italiane');
}

// 3. Hash e generatore locale
{
    check(ST.hash('') === 0x811c9dc5 && ST.hash('a') === 0xe40c292c, 'FNV-1a: valori di riferimento');
    check(ST.hash('Maria Rossi|3331234567') === ST.hash('Maria Rossi|3331234567'), 'hash stabile');
    const r1 = ST.mulberry32(42), r2 = ST.mulberry32(42);
    const s1 = [r1(), r1(), r1()].join(), s2 = [r2(), r2(), r2()].join();
    check(s1 === s2 && r1() < 1, 'mulberry32 deterministico in [0,1)');
}

// 4. plan(): ritmo e taglio
{
    const long = 'Mio marito è caduto dalle scale e non si muove più. Respira male, fa un rumore strano. '
        + 'Siamo al terzo piano, la porta è aperta. Vi prego fate presto, ho paura che muoia. Non so cosa fare! '
        + 'I bambini sono di là con la nonna e piangono.';
    const a = ST.plan({ text: long, panic: 80, mode: 'adaptive' });
    check(a.rate <= 1.5 && a.rate > 0.95 + 80 * 0.0045 - 1e-9, 'adattiva: velocità aumentata ma ≤ 1.5 (' + a.rate + ')');
    check(a.truncateAt < long.length && /[.!?]$/.test(long.slice(0, a.truncateAt)), 'adattiva: taglio su fine frase');
    check(a.est <= 9.01, 'adattiva: entro 9 s (' + a.est.toFixed(2) + ')');

    const b = ST.plan({ text: long, panic: 80, mode: 'full' });
    check(b.truncateAt === long.length && b.rate === Math.round((0.95 + 80 * 0.0045) * 1000) / 1000, 'completa: niente tagli, velocità da panico');

    const c = ST.plan({ text: long, panic: 10, mode: 'short' });
    check(long.slice(0, c.truncateAt) === 'Mio marito è caduto dalle scale e non si muove più.', 'breve: solo la prima frase');

    const d = ST.plan({ text: 'Sì.', panic: 0 });
    check(d.truncateAt === 3 && d.rate === 0.95, 'frase corta invariata');

    const e = ST.plan({ chars: 180, panic: 80, mode: 'adaptive' });
    check(e.rate <= 1.5 && e.truncateAt === 180, '180 caratteri a panico 80: basta accelerare (' + e.rate + ')');

    const noStop = 'a'.repeat(400);
    const f = ST.plan({ text: noStop, panic: 50 });
    check(f.truncateAt === 400, 'senza fine frase si dice tutto (almeno la prima frase)');
    check(ST.sentences('Uno. Due! Tre? Quattro').join('|') === 'Uno.|Due!|Tre?|Quattro', 'sentences()');
}

// 5. Prosodia
{
    const m = ST.prosody({ kind: 'male' }), f = ST.prosody({ kind: 'female' }), ch = ST.prosody({ kind: 'child' });
    check(m.pitch === 0.85 && f.pitch === 1.1 && ch.pitch === 1.45, 'tono per tipo di voce');
    check(ST.prosody({ kind: 'male', age: 'elderly' }).pitch < m.pitch, 'anziano: tono più basso');
    const calm = ST.prosody({ kind: 'female', panic: 10 }), hyst = ST.prosody({ kind: 'female', panic: 90, lvl: 'hyst' });
    check(hyst.rate > calm.rate && hyst.rate <= 1.5, 'agitazione: più veloce (isterico +0.1)');
    check(ST.prosody({ kind: 'male', whisper: true }).volume === 0.45, 'sussurro: volume × 0.45');
    check(ST.prosody({ kind: 'male', seed: 123 }).pitch !== ST.prosody({ kind: 'male', seed: 456 }).pitch, 'timbro diverso per chiamante');
}

// 6. Sillabe del parlato sintetico
{
    const s = ST.syllables('Pronto? Mi sente… aiuto!');
    check(s.length >= 7 && s.every((x) => 'aeiou'.includes(x.v)), 'sillabe dai gruppi vocalici (' + s.length + ')');
    check(s[1].rise && s[1].gap === 260, 'domanda: tono che sale e pausa di fine frase');
    check(s.some((x) => x.gap === 350), '… -> pausa di 350 ms');
    check(s[s.length - 1].loud, '! -> più forte');
    check(ST.syllables('').length === 0, 'testo vuoto: nessuna sillaba');
}

// 7. Tutti i modelli, 300 varianti: nessuna parola di didascalia letta, nessuna parentesi normale tolta
{
    const LL = loadEngine();
    const templates = loadTemplates();
    const CUE_WORDS = /\b(sussurr\w*|sottovoce|risat\w*|piang\w*|singhiozz\w*|riattacc\w*|interprete)\b/i;
    const texts = new Set();
    const collect = (v) => {
        if (typeof v === 'string') texts.add(v);
        else if (v && typeof v === 'object') Object.values(v).forEach(collect);
    };
    for (const t of templates) {
        for (let seed = 1; seed <= 300; seed++) {
            const c = LL.CallBuilder.build(t, new LL.RNG(seed), city);
            collect(c.opening);
            for (const n of c.nodes) { collect(n.reply); if (n.replyFlag) collect(n.replyFlag); if (n.error) collect(n.error.reply); }
            collect(c.lines);
        }
    }
    let leaked = [], removed = [];
    for (const text of texts) {
        const sp = ST.toSpeech(text);
        // parole-didascalia fuori dalle parentesi possono esistere nel parlato vero: controlla solo quelle che erano tra parentesi
        const inParens = [...text.matchAll(/\(\s*([a-zàèéìòù][^(){}]*)\)/g)].map((m) => m[1]);
        for (const p of inParens) if (CUE_WORDS.test(p) && sp.say.includes(p)) leaked.push(text);
        const upper = [...text.matchAll(/\(([A-Z0-9][^()]*)\)/g)].map((m) => m[1]);
        for (const p of upper) if (!sp.say.includes(p.replace(/[«»"…]/g, '').trim().slice(0, 4))) removed.push(text);
        if (/[()]/.test(sp.say) && /\(\s*[a-zàèéìòù]/.test(sp.say) && !/\{/.test(sp.say)) leaked.push(text);
    }
    check(texts.size > 500, `battute raccolte da tutti i modelli: ${texts.size}`);
    check(leaked.length === 0, 'nessuna didascalia letta ad alta voce' + (leaked.length ? ': ' + leaked.slice(0, 3).join(' | ') : ''));
    check(removed.length === 0, 'nessuna parentesi normale tolta' + (removed.length ? ': ' + removed.slice(0, 3).join(' | ') : ''));
}

done();
