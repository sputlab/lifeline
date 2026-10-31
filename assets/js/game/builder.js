/**
 * LifeLine - Costruzione delle chiamate dai modelli
 *
 * Un modello (template) + un flusso casuale => il contenuto concreto di una chiamata:
 * variabili estratte (indirizzo, varianti, età...), segnaposto {x.y} risolti,
 * verità nascosta calcolata. Stesso modello e stesso seed danno sempre la stessa chiamata.
 *
 * Tipi di variabile:
 *   { "pool": "stradario", "zones": [...], "floor": [min, max] }   -> oggetto indirizzo
 *   { "pool": "names_f" | "names_m" | "surnames" }                 -> stringa
 *   { "choice": [...], "weights": [...] }                           -> elemento (stringa o oggetto)
 *   { "range": [min, max] }                                         -> intero
 * Variabili automatiche: caller_first, caller_surname, caller_name, g (accordo di genere: {g.o}, {g.lui}, {g.sig}).
 *
 * Campi facoltativi della 1.2.0 (timeline, callback_opening, idle_lines, deterioration,
 * switch_caller, voce come oggetto): l'unica estrazione nuova è quella dei tempi della
 * cronologia, dal flusso derivato "timeline", che non tocca il flusso della chiamata.
 */
(function (LL) {
    'use strict';

    const AGENCIES = ['118', '115', 'PS', 'CC'];
    const PH = /\{([a-z_]+(?:\.[a-z_]+)*)\}/g;
    const EXACT = /^\{([a-z_]+(?:\.[a-z_]+)*)\}$/;

    function lookup(vars, path) {
        return path.split('.').reduce((o, k) => (o !== null && o !== undefined ? o[k] : undefined), vars);
    }

    /** Sostituisce i segnaposto; ripete per i segnaposto annidati nelle varianti. */
    function resolveString(str, vars) {
        let out = str;
        for (let pass = 0; pass < 4; pass++) {
            const next = out.replace(PH, (m, path) => {
                const v = lookup(vars, path);
                return v === undefined || v === null || typeof v === 'object' ? m : String(v);
            });
            if (next === out) break;
            out = next;
        }
        return out;
    }

    /** Risolve in profondità; "{x}" da solo restituisce il valore grezzo (array, numeri...). */
    function resolveDeep(value, vars) {
        if (typeof value === 'string') {
            const m = value.match(EXACT);
            if (m) {
                const raw = lookup(vars, m[1]);
                if (raw !== undefined && raw !== null && typeof raw === 'object') return resolveDeep(raw, vars);
                if (typeof raw === 'string') return resolveString(raw, vars);
                if (raw !== undefined) return raw;
            }
            return resolveString(value, vars);
        }
        if (Array.isArray(value)) return value.map((v) => resolveDeep(v, vars));
        if (value && typeof value === 'object') {
            const o = {};
            for (const [k, v] of Object.entries(value)) o[k] = resolveDeep(v, vars);
            return o;
        }
        return value;
    }

    /** Appiattisce una lista di enti (anche annidata) e tiene solo quelli validi, in ordine canonico. */
    function agencyList(list) {
        const flat = [];
        (function walk(x) {
            if (Array.isArray(x)) x.forEach(walk);
            else if (typeof x === 'string') flat.push(x);
        })(list || []);
        return AGENCIES.filter((a) => flat.includes(a));
    }

    function wrongNumber(n, rng, max) {
        const s = String(n);
        if (s.length === 2 && s[0] !== s[1] && s[1] !== '0') return Number(s[1] + s[0]);
        let w = n + rng.pick([-2, 2, 10, -10, 1]);
        if (w < 1 || w === n) w = n + 3;
        return Math.min(Math.max(1, w), Math.max(max, n + 3));
    }

    function makeLocation(def, rng, city, forceZone) {
        let zones = (def.zones && def.zones.length ? def.zones : Object.keys(city.zones))
            .filter((z) => city.zones[z]);
        if (forceZone && city.zones[forceZone]) zones = [forceZone];
        const zoneKey = rng.pick(zones);
        const z = city.zones[zoneKey];
        const allowed = Array.isArray(def.streets) ? z.streets.filter((st) => def.streets.includes(st.name)) : [];
        const street = rng.pick(allowed.length ? allowed : z.streets);
        const others = z.streets.filter((s) => s.name !== street.name);
        const number = rng.int(1, street.max);
        const [fmin, fmax] = def.floor || [0, 0];
        const floor = rng.int(fmin, fmax);
        const [rmin, rmax] = z.aml_radius_m;
        const point = LL.Geo.addressPoint(street, number);
        const lm = LL.Geo.nearestLandmark(z, point);
        return {
            zone: zoneKey,
            zone_name: z.name,
            police: z.police,
            street: street.name,
            street_wrong: others.length ? rng.pick(others).name : street.name,
            number,
            number_wrong: wrongNumber(number, rng, street.max),
            floor,
            floor_text: floor === 0 ? 'piano terra' : `${floor}° piano`,
            landmark: lm ? lm.name : z.name,
            aml_radius_m: rng.int(rmin, rmax),
            x: Math.round(point[0] * 10) / 10,
            y: Math.round(point[1] * 10) / 10,
        };
    }

    /**
     * Posizione AML stimata (cellulari): un cerchio che contiene il punto reale,
     * con centro spostato a caso. Fisso: indirizzo di intestazione della linea.
     */
    function makeAml(loc, phone, tplAml, rng, city) {
        const mpu = city.map?.meters_per_unit || 1;
        if (phone.type !== 'mobile' || (tplAml && tplAml.available === false)) return null;
        const r = loc.aml_radius_m / mpu;
        const ang = rng.range(0, Math.PI * 2);
        const off = rng.range(0, 0.8) * r;
        return {
            x: Math.round((loc.x + Math.cos(ang) * off) * 10) / 10,
            y: Math.round((loc.y + Math.sin(ang) * off) * 10) / 10,
            r: Math.round(r * 10) / 10,
            meters: loc.aml_radius_m,
        };
    }

    function makeVar(def, rng, city, opts) {
        if (def.pool === 'stradario') return makeLocation(def, rng, city, opts.zone);
        if (def.pool) return rng.pick(city[def.pool] || ['?']);
        if (def.choice) {
            if (Array.isArray(def.weights) && def.weights.length === def.choice.length) {
                const items = def.choice.map((v, i) => ({ v, weight: def.weights[i] }));
                return rng.weighted(items).v;
            }
            return rng.pick(def.choice);
        }
        if (def.range) return rng.int(def.range[0], def.range[1]);
        return null;
    }

    function makeCallerName(cl, gender, rng, city) {
        const firstPool = cl.first_pool && city[cl.first_pool] ? cl.first_pool : (gender === 'f' ? 'names_f' : 'names_m');
        const lastPool = cl.surname_pool && city[cl.surname_pool] ? cl.surname_pool : 'surnames';
        const first = rng.pick(city[firstPool]);
        const surname = rng.pick(city[lastPool]);
        return { caller_first: first, caller_surname: surname, caller_name: `${first} ${surname}` };
    }

    /** Accordo di genere per i testi: {g.o}, {g.lui}, {g.sig}. Derivato, nessuna estrazione. */
    function genderVars(gender) {
        return gender === 'f' ? { o: 'a', lui: 'lei', sig: 'Signora' } : { o: 'o', lui: 'lui', sig: 'Signore' };
    }

    const AGES = ['child', 'adult', 'elderly'];
    const STYLES = ['whisper', 'breathless', 'slurred', 'crying'];

    /**
     * Profilo della voce per l'audio: { kind, age, accent?, style? }.
     * spec: stringa ("child", "adult", "elderly", "male", "female") oppure { age, accent, style }.
     */
    function voiceProfile(spec, gender) {
        const o = spec && typeof spec === 'object' ? spec : { age: AGES.includes(spec) ? spec : 'adult' };
        const age = AGES.includes(o.age) ? o.age : 'adult';
        const p = { kind: age === 'child' ? 'child' : (gender === 'f' ? 'female' : 'male'), age };
        if (typeof o.accent === 'string' && /^[a-z]{2}$/.test(o.accent)) p.accent = o.accent;
        if (STYLES.includes(o.style)) p.style = o.style;
        return p;
    }

    /** Cronologia del chiamante: tempi estratti dal flusso dedicato "timeline". */
    function makeTimeline(list, rng, vars) {
        if (!Array.isArray(list) || !list.length) return null;
        const tr = rng.fork('timeline');
        return list.map((raw) => {
            const t = resolveDeep(raw, vars);
            const at = Array.isArray(t.at_s) ? tr.int(Number(t.at_s[0]) || 0, Number(t.at_s[1]) || 0) : Number(t.at_s) || 0;
            const ua = t.unless_asked;
            return {
                id: String(t.id),
                atMs: at * 1000,
                say: t.say || { calm: '…' },
                ifFlag: typeof t.if_flag === 'string' ? t.if_flag : null,
                unlessFlag: typeof t.unless_flag === 'string' ? t.unless_flag : null,
                unlessAsked: Array.isArray(ua) ? ua : (typeof ua === 'string' ? [ua] : []),
                panicDelta: Number(t.panic_delta) || 0,
                reveals: Array.isArray(t.reveals) ? t.reveals : [],
                setsFlag: typeof t.sets_flag === 'string' ? t.sets_flag : null,
                endsCall: !!t.ends_call,
                interrupt: !!t.interrupt,
            };
        });
    }

    function makeSwitch(sw, id) {
        if (!sw || typeof sw !== 'object') return null;
        const gender = sw.gender === 'm' ? 'm' : 'f';
        const profile = voiceProfile(sw.voice, gender);
        return {
            key: id,
            name: typeof sw.name === 'string' ? sw.name : null,
            gender,
            voice: profile,
            panicStart: Math.min(100, Math.max(0, Number(sw.panic_start) || 0)),
            reliability: typeof sw.reliability === 'number' ? sw.reliability : 1,
            opening: sw.opening || null,
        };
    }

    function makePhone(type, rng) {
        const t = type === 'mobile' || type === 'landline' ? type : (rng.chance(0.75) ? 'mobile' : 'landline');
        return t === 'mobile'
            ? { type: t, number: `+39 3${rng.int(20, 93)} ${rng.int(100, 999)} ${rng.int(1000, 9999)}` }
            : { type: t, number: `+39 0481 ${rng.int(10, 99)} ${rng.int(1000, 9999)}` };
    }

    const CallBuilder = {
        /**
         * @param {object} tpl   modello come arriva dal server: { id, code, version, content }
         * @param {LL.RNG} rng   flusso casuale dedicato a questa chiamata
         * @param {object} city  dati della città (stradario, nomi)
         */
        /**
         * @param {object} [opts]  { zone } per forzare la zona dell'indirizzo (eventi "gemelli" vicini)
         */
        build(tpl, rng, city, opts = {}) {
            const c = tpl.content;
            const cl = c.caller || {};

            // 1. variabili
            const vars = {};
            const gender = cl.gender === 'm' || cl.gender === 'f' ? cl.gender : (rng.chance(0.5) ? 'f' : 'm');
            const who = makeCallerName(cl, gender, rng, city);
            Object.assign(vars, who);
            vars.g = genderVars(gender);
            for (const [name, def] of Object.entries(c.variables || {})) {
                vars[name] = makeVar(def, rng, city, opts);
            }
            if (!vars.location) vars.location = makeLocation({}, rng, city, opts.zone);

            const phone = makePhone(cl.phone_type, rng);
            const jitter = () => rng.range(0.85, 1.15);
            const aml = makeAml(vars.location, phone, c.aml, rng, city);
            const directory = phone.type === 'landline'
                ? { surname: vars.caller_surname, street: vars.location.street, number: vars.location.number,
                    x: vars.location.x, y: vars.location.y }
                : null;

            // 2. sezioni risolte
            const facts = resolveDeep(c.facts || {}, vars);
            const nodes = (c.nodes || []).map((n) => {
                const r = resolveDeep(n, vars);
                return {
                    id: r.id,
                    label: r.label,
                    type: r.type === 'reassure' ? 'reassure' : 'question',
                    costSec: Number(r.cost_s) || 5,
                    panicDelta: Number(r.panic_delta) || 0,
                    requires: r.requires || [],
                    reveals: r.reveals || [],
                    reply: r.reply || { calm: '…' },
                    error: r.error || null,
                    endsCall: !!r.ends_call,
                    setsFlag: typeof r.sets_flag === 'string' ? r.sets_flag : null,
                    requiresFlag: typeof r.requires_flag === 'string' ? r.requires_flag : null,
                    hiddenIfFlag: typeof r.hidden_if_flag === 'string' ? r.hidden_if_flag : null,
                    replyFlag: r.reply_flag && typeof r.reply_flag.flag === 'string' ? r.reply_flag : null,
                    repeat: r.repeat || null,
                    switchCaller: makeSwitch(r.switch_caller, r.id),
                };
            });
            const truth = resolveDeep(c.truth || {}, vars);
            truth.agencies_required = agencyList(truth.agencies_required);
            truth.agencies_acceptable = agencyList(truth.agencies_acceptable);
            truth.acceptable_event_types = Array.isArray(truth.acceptable_event_types) ? truth.acceptable_event_types : [];
            const drop = Array.isArray(c.drop_after_s) ? rng.int(c.drop_after_s[0], c.drop_after_s[1]) * 1000 : null;
            // Dopo l'ultima estrazione dal flusso della chiamata: il flusso "timeline" è indipendente
            const timeline = makeTimeline(c.timeline, rng, vars);
            const voice = cl.voice === 'child' || (cl.voice && cl.voice.age === 'child') ? 'child' : (gender === 'f' ? 'female' : 'male');

            return {
                templateId: tpl.id,
                code: c.code || tpl.code,
                version: tpl.version,
                title: c.title,
                category: c.category,
                difficulty: c.difficulty,
                opening: resolveDeep(c.opening || { calm: 'Pronto?' }, vars),
                caller: {
                    name: vars.caller_name,
                    gender,
                    phone: phone.number,
                    phoneType: phone.type,
                    ringPatienceSec: Math.round((cl.ring_patience_s || 40) * jitter()),
                    holdPatienceSec: Math.round((cl.hold_patience_s || 40) * jitter()),
                    panicStart: Math.min(100, Math.max(0, (cl.panic_start || 0) + rng.int(-8, 8))),
                    reliability: typeof cl.reliability === 'number' ? cl.reliability : 1,
                    callbackChance: typeof cl.callback_chance === 'number' ? cl.callback_chance : 0.5,
                    voice,
                    voiceProfile: voiceProfile(cl.voice, gender),
                },
                callbackOpening: c.callback_opening ? resolveDeep(c.callback_opening, vars) : null,
                timeline,
                idleLines: c.idle_lines ? resolveDeep(c.idle_lines, vars) : null,
                deterioration: Array.isArray(c.deterioration) && c.deterioration.length ? resolveDeep(c.deterioration, vars) : null,
                facts,
                nodes,
                nodesById: Object.fromEntries(nodes.map((n) => [n.id, n])),
                truth,
                location: vars.location,
                aml,
                directory,
                dropAtActiveMs: drop,
                duplicates: c.duplicates || null,
                vars,
                lines: city.generic_lines || {},
            };
        },

        /**
         * Testimone dello stesso evento: stessa verità, luogo e informazioni,
         * ma chiamante, telefono e posizione AML nuovi, e un'apertura da testimone.
         */
        buildWitness(tpl, base, rng, city) {
            const c = tpl.content;
            const cl = c.caller || {};
            const gender = rng.chance(0.5) ? 'f' : 'm';
            const who = makeCallerName({}, gender, rng, city);
            const vars = Object.assign({}, base.vars, who, { g: genderVars(gender) });
            const phone = makePhone('mobile', rng);
            const wv = c.witness_voice;
            const opening = resolveDeep(c.witness_opening || c.opening || { calm: 'Pronto?' }, vars);
            const jitter = () => rng.range(0.85, 1.15);
            return Object.assign({}, base, {
                opening,
                vars,
                isWitness: true,
                // la cronologia, le frasi di attesa e la richiamata sono del chiamante principale
                callbackOpening: null,
                timeline: null,
                idleLines: null,
                caller: Object.assign({}, base.caller, {
                    name: who.caller_name,
                    gender,
                    voice: wv && wv.age === 'child' ? 'child' : (gender === 'f' ? 'female' : 'male'),
                    voiceProfile: voiceProfile(wv, gender),
                    phone: phone.number,
                    phoneType: phone.type,
                    ringPatienceSec: Math.round((cl.ring_patience_s || 40) * 1.1 * jitter()),
                    holdPatienceSec: Math.round((cl.hold_patience_s || 40) * 1.2 * jitter()),
                    panicStart: Math.max(0, base.caller.panicStart - 25),
                    reliability: Math.min(1, base.caller.reliability + 0.05),
                    callbackChance: 0.1,
                }),
                aml: makeAml(base.location, phone, c.aml, rng, city),
                directory: null,
                dropAtActiveMs: null,
            });
        },

        /** Segnaposto rimasti non risolti (per test e validazione). */
        unresolved(content) {
            const found = new Set();
            const scan = (v) => {
                if (typeof v === 'string') (v.match(PH) || []).forEach((m) => found.add(m));
                else if (Array.isArray(v)) v.forEach(scan);
                else if (v && typeof v === 'object') Object.values(v).forEach(scan);
            };
            scan({ o: content.opening, f: content.facts, n: content.nodes, t: content.truth,
                cb: content.callbackOpening, tl: content.timeline, il: content.idleLines, d: content.deterioration });
            return [...found];
        },

        resolveString,
        agencyList,
        voiceProfile,
        genderVars,
    };

    LL.CallBuilder = CallBuilder;
})(globalThis.LL = globalThis.LL || {});
