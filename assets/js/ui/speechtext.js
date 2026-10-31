/**
 * LifeLine - Testo da pronunciare (funzioni pure, senza DOM, caricabili anche in Node)
 *
 *   toSpeech(text)   separa le didascalie tra parentesi «(sussurra)», «(piange)» dal parlato:
 *                    le didascalie diventano effetti (cues) e non vengono mai lette
 *   langOf(text)     lingua di una frase: 'it', 'en' o 'de' (turisti, interprete)
 *   hash(str)        FNV-1a a 32 bit, per scelte stabili (stessa voce allo stesso chiamante)
 *   plan(o)          ritmo e taglio della frase per stare nel tempo della domanda successiva
 *   prosody(o)       tono, velocità e volume per tipo di voce, età e agitazione
 *   syllables(text)  sillabe e pause del «parlato telefonico» sintetico (voce di riserva)
 *
 * Il testo nel fumetto resta sempre completo: qui si decide solo cosa si sente.
 */
(function (LL) {
    'use strict';

    /* ---------------- Didascalie ---------------- */

    // Ordine = priorità. Una didascalia può dare più effetti: «(risate, poi riattaccano)» -> laugh + hangup.
    const CUES = [
        ['whisper', /\b(sussurr\w*|sottovoce|bisbigli\w*)/],
        ['laugh', /\b(risat\w*|ride\b|ridono|ridacchi\w*)/],
        ['sob', /\b(piang\w*|singhiozz\w*|tira su col naso|lacrim\w*)/],
        ['hangup', /\b(riattacc\w*)/],
        ['silence', /\b(silenzio|lunga pausa|fruscio)/],
        ['interpreter', /\b(interprete)/],
        ['child', /\b(voce di bambin\w*|vocina|bambin[oa])\b/],
    ];
    // Didascalia: parentesi che inizia con una minuscola e non contiene segnaposto «{»
    const PAREN = /\(\s*([a-zàèéìòù][^(){}]*)\)/g;

    function classify(inner) {
        const s = inner.toLowerCase();
        const kinds = CUES.filter(([, re]) => re.test(s)).map(([k]) => k);
        return kinds.length ? kinds : ['ambient'];
    }

    const ORD_M = ['', 'primo', 'secondo', 'terzo', 'quarto', 'quinto', 'sesto', 'settimo', 'ottavo', 'nono', 'decimo',
        'undicesimo', 'dodicesimo', 'tredicesimo', 'quattordicesimo', 'quindicesimo', 'sedicesimo', 'diciassettesimo', 'diciottesimo', 'diciannovesimo', 'ventesimo'];

    /** «3°» -> «terzo», «3ª» -> «terza»; oltre il ventesimo resta il numero (senza il segno, che i sintetizzatori leggono «gradi»). */
    function ordinal(n, fem) {
        const w = ORD_M[Number(n)];
        if (!w) return String(n);
        return fem ? w.slice(0, -1) + 'a' : w;
    }

    function tidy(s) {
        return s
            .replace(/\s+/g, ' ')
            .replace(/\s+([,.;:!?])/g, '$1')
            .replace(/([,;:])(\s*[,;:])+/g, '$1')
            .replace(/([.!?])\s*[,;:]+/g, '$1')
            .replace(/[,;:]+\s*([.!?])/g, '$1')
            .replace(/^[\s,;:.]+/, '')
            .replace(/[\s,;:]+$/, '')
            .trim();
    }

    /**
     * @param {string} text  battuta del chiamante già risolta (niente segnaposto)
     * @returns {{say: string, cues: {kind: string, text: string, pos: 'start'|'mid'|'end'}[]}}
     */
    function toSpeech(text) {
        if (typeof text !== 'string' || !text) return { say: '', cues: [] };
        const cues = [];
        let say = text.replace(PAREN, (m, inner, offset) => {
            const before = text.slice(0, offset).trim();
            const after = text.slice(offset + m.length).trim();
            const pos = !before ? 'start' : (!after ? 'end' : 'mid');
            for (const kind of classify(inner)) cues.push({ kind, text: inner.trim(), pos });
            return ' , ';
        });
        say = say
            .replace(/[«»“”"]/g, '')
            .replace(/…|\.{3}/g, ', ')
            .replace(/\b[nN]\.\s*(?=\d)/g, 'numero ')
            .replace(/(\d)\s*°\s*C\b/g, '$1 gradi')
            .replace(/\b(\d{1,3})\s*([°º]|ª)(?![\p{L}\d])/gu, (m, n, sign) => ordinal(n, sign === 'ª'))
            .replace(/\d{6,}/g, (d) => d.split('').join(' '));
        say = tidy(say);
        if (!/[\p{L}\p{N}]/u.test(say)) say = '';
        return { say, cues };
    }

    const hasCue = (sp, kind) => !!(sp && sp.cues && sp.cues.some((c) => c.kind === kind));

    /* ---------------- Lingua ---------------- */

    const STOP = {
        en: new Set(['the', 'please', 'my', 'he', 'she', 'is', 'are', 'help', 'hello', 'yes', 'no', 'not', 'and', 'you', 'we', 'what', 'where', 'husband', 'wife', 'speak', 'fall', 'fell', 'now', 'good', 'strange', 'there', 'here', 'this', 'with', 'have', 'has', 'can']),
        de: new Set(['hallo', 'hilfe', 'bitte', 'mein', 'meine', 'mann', 'frau', 'ist', 'nicht', 'und', 'ich', 'wir', 'sie', 'er', 'ja', 'nein', 'der', 'die', 'das', 'schnell', 'kommen', 'wo', 'was', 'hier', 'gefallen', 'spricht']),
        it: new Set(['il', 'la', 'lo', 'le', 'gli', 'un', 'una', 'di', 'che', 'è', 'e', 'non', 'mi', 'si', 'ci', 'mio', 'mia', 'sono', 'ha', 'per', 'con', 'in', 'sì', 'no', 'pronto', 'aiuto', 'qui', 'casa', 'via', 'al', 'del', 'della', 'sta', 'mio', 'lei', 'lui']),
    };

    /** 'it' salvo che le parole inglesi o tedesche siano chiaramente di più. */
    function langOf(text) {
        const words = String(text || '').toLowerCase().match(/[\p{L}']+/gu) || [];
        const n = { it: 0, en: 0, de: 0 };
        for (const w of words) for (const k of ['it', 'en', 'de']) if (STOP[k].has(w)) n[k]++;
        // «no» e «in» sono comuni a più lingue: contano per l'italiano solo se c'è altro
        const best = n.en >= n.de ? 'en' : 'de';
        return n[best] >= 2 && n[best] > n.it ? best : 'it';
    }

    /* ---------------- Hash e numeri stabili ---------------- */

    function hash(str) {
        let h = 0x811c9dc5;
        const s = String(str ?? '');
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 0x01000193);
        }
        return h >>> 0;
    }

    /** Generatore locale (solo interfaccia, mai il flusso casuale del motore). */
    function mulberry32(seed) {
        let a = seed >>> 0;
        return function () {
            a = (a + 0x6D2B79F5) >>> 0;
            let t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    /* ---------------- Ritmo e taglio ---------------- */

    const CPS = 14;             // caratteri al secondo a velocità 1
    const MAX_RATE = 1.5;
    const BUDGET = { full: Infinity, adaptive: 9, short: Infinity };

    /** Fine delle frasi: indici subito dopo . ! ? seguiti da spazio o fine testo. */
    function sentenceEnds(text) {
        const ends = [];
        const re = /[.!?]+(?=\s|$)/g;
        let m;
        while ((m = re.exec(text))) ends.push(m.index + m[0].length);
        if (!ends.length || ends[ends.length - 1] < text.trim().length) ends.push(text.length);
        return ends;
    }

    /** Frasi intere (per la sintesi a pezzi della Voce HD). */
    function sentences(text) {
        const out = [];
        let from = 0;
        for (const e of sentenceEnds(text)) {
            const s = text.slice(from, e).trim();
            if (s) out.push(s);
            from = e;
        }
        return out;
    }

    /**
     * @param {object} o
     * @param {string} [o.text]      testo da dire (oppure o.chars)
     * @param {number} [o.chars]
     * @param {number} [o.panic]     0-100
     * @param {string} [o.mode]      'full' | 'adaptive' | 'short'
     * @param {number} [o.budgetSec] tempo disponibile (predefinito: 9 s in modalità adattiva)
     * @param {number} [o.baseRate]  velocità di partenza (predefinita 0.95 + panic × 0.0045)
     * @returns {{rate: number, truncateAt: number, est: number}}  est in secondi, truncateAt = caratteri da dire
     */
    function plan({ text, chars, panic = 0, mode = 'adaptive', budgetSec, baseRate } = {}) {
        const s = typeof text === 'string' ? text : null;
        const len = s !== null ? s.length : Math.max(0, chars | 0);
        let rate = typeof baseRate === 'number' ? baseRate : 0.95 + Math.max(0, Math.min(100, panic)) * 0.0045;
        rate = Math.max(0.5, Math.min(MAX_RATE, rate));
        let cut = len;
        if (mode === 'short' && s) {
            cut = sentenceEnds(s)[0];
        } else {
            const budget = typeof budgetSec === 'number' ? budgetSec : BUDGET[mode] ?? BUDGET.adaptive;
            if (len / (CPS * rate) > budget) {
                rate = Math.min(MAX_RATE, Math.max(rate, len / (CPS * budget)));
                const fit = Math.floor(budget * CPS * rate);
                if (len > fit) {
                    if (s) {
                        const ends = sentenceEnds(s);
                        const ok = ends.filter((e) => e <= fit);
                        cut = ok.length ? ok[ok.length - 1] : ends[0];   // almeno la prima frase
                    } else {
                        cut = fit;
                    }
                }
            }
        }
        const rounded = Math.round(rate * 1000) / 1000;
        return { rate: rounded, truncateAt: cut, est: cut / (CPS * rounded) };
    }

    /* ---------------- Prosodia ---------------- */

    const PITCH = { male: 0.85, female: 1.1, child: 1.45, operator: 1 };

    /**
     * @param {object} o
     * @param {string} o.kind   'male' | 'female' | 'child' | 'operator'
     * @param {string} [o.age]  'child' | 'adult' | 'elderly'
     * @param {number} [o.panic]
     * @param {string} [o.lvl]  'calm' | 'panic' | 'hyst'
     * @param {number} [o.seed] variazione stabile del timbro (±4% di tono)
     * @param {boolean} [o.whisper]
     * @returns {{pitch: number, rate: number, volume: number}}  valori per SpeechSynthesisUtterance
     */
    function prosody({ kind = 'male', age = 'adult', panic = 0, lvl = 'calm', seed = 0, whisper = false } = {}) {
        let pitch = PITCH[kind] || 1;
        let rate = 0.95 + Math.max(0, Math.min(100, panic)) * 0.0045;
        if (age === 'elderly') { pitch *= 0.93; rate *= 0.92; }
        if (age === 'child' && kind !== 'child') pitch = PITCH.child;
        if (lvl === 'hyst') { rate += 0.1; pitch *= 1.06; }
        else if (lvl === 'panic') pitch *= 1.03;
        if (seed) pitch *= 1 + (mulberry32(seed)() - 0.5) * 0.08;
        if (kind === 'operator') rate = 1;
        return {
            pitch: Math.round(Math.max(0.1, Math.min(2, pitch)) * 1000) / 1000,
            rate: Math.round(Math.max(0.5, Math.min(MAX_RATE, rate)) * 1000) / 1000,
            volume: whisper ? 0.45 : 1,
        };
    }

    /* ---------------- Sillabe del parlato sintetico ---------------- */

    const VOWEL_OF = { a: 'a', à: 'a', á: 'a', e: 'e', è: 'e', é: 'e', i: 'i', ì: 'i', í: 'i', y: 'i', o: 'o', ò: 'o', ó: 'o', u: 'u', ù: 'u', ú: 'u', ä: 'e', ö: 'o', ü: 'u' };

    /**
     * Sillabe ricavate dai gruppi vocalici del testo.
     * @returns {{v: string, cons: boolean, gap: number, rise: boolean, loud: boolean}[]}
     *          gap = pausa dopo la sillaba in ms (… 350, virgola 150, fine frase 260, tra parole 40)
     */
    function syllables(text) {
        const out = [];
        const s = String(text || '').toLowerCase();
        // segmenti di frase con la punteggiatura che li chiude
        const parts = s.match(/[^,;:.!?…]+[,;:.!?…]*/g) || [];
        for (const part of parts) {
            const punct = (part.match(/[,;:.!?…]+$/) || [''])[0];
            const words = part.replace(/[,;:.!?…]+$/, '').match(/[\p{L}\p{N}']+/gu) || [];
            const startIdx = out.length;
            for (const w of words) {
                const groups = w.match(/[^aeiouàáèéìíòóùúyäöü]*[aeiouàáèéìíòóùúyäöü]+/g)
                    || (/\d/.test(w) ? w.split('').map(() => 'e') : [w]);
                groups.forEach((g, i) => {
                    const vch = (g.match(/[aeiouàáèéìíòóùúyäöü]/g) || ['e']).pop();
                    out.push({ v: VOWEL_OF[vch] || 'e', cons: /^[^aeiouàáèéìíòóùúyäöü]/.test(g), gap: i === groups.length - 1 ? 40 : 0, rise: false, loud: false });
                });
            }
            if (out.length > startIdx) {
                const last = out[out.length - 1];
                if (punct.includes('…')) last.gap = 350;
                else if (/[.!?]/.test(punct)) last.gap = 260;
                else if (/[,;:]/.test(punct)) last.gap = 150;
                if (punct.includes('?')) for (let i = Math.max(startIdx, out.length - 2); i < out.length; i++) out[i].rise = true;
                if (punct.includes('!')) for (let i = startIdx; i < out.length; i++) out[i].loud = true;
            }
        }
        return out;
    }

    LL.SpeechText = { toSpeech, hasCue, langOf, hash, mulberry32, plan, sentences, sentenceEnds, prosody, syllables, CPS, MAX_RATE };
})(globalThis.LL = globalThis.LL || {});
