/**
 * LifeLine - Valutazione del turno
 *
 * Deterministica: dipende solo dallo stato finale del motore (e quindi da seed + azioni).
 * Le stesse formule sono replicate lato server (api/shift.php) per calcolare XP e voto.
 *
 * Assi per chiamata (0-100, null = non applicabile):
 *   time            risposta rapida e gestione nei tempi
 *   location        distanza tra luogo indicato e luogo reale
 *   classification  tipologia di evento
 *   agencies        enti richiesti, mancanti, superflui, competenza territoriale
 *   protocol        informazioni critiche raccolte, scheda completa, gestione del panico
 *
 * Esito per evento (le richiamate appartengono all'evento originale):
 *   ritardo effettivo = decisione - primo arrivo + penalità (scheda incompleta, errore di luogo, competenza)
 *   <= acceptable_s positivo, <= limit_s parziale, oltre negativo; un ente richiesto mancante peggiora di un livello,
 *   nessun ente utile = negativo.
 */
(function (LL) {
    'use strict';

    const S = LL.CallState;
    // Tutti i calcoli di punteggio usano interi (centesimi): risultati identici in JavaScript e PHP.
    const WEIGHTS = { time: 20, location: 20, classification: 20, agencies: 25, protocol: 15 };
    const OUTCOME_FACTOR = { positivo: 100, parziale: 80, negativo: 50, nessuno: 100 };
    const GRADE_MULT = { S: 150, A: 125, B: 100, C: 80, D: 50 };
    const ZONE_TOL_M = { centro: [30, 400], residenziale: [30, 400], industriale: [50, 600], colline: [80, 900], montagna: [200, 2000] };
    const POLICE = ['PS', 'CC'];
    const INCOMPLETE_PENALTY_S = 45;
    const COMPETENCE_PENALTY_S = 180;
    const TRAVEL_M_PER_S = 8.3; // circa 30 km/h
    const POINTS_FACTOR = 35; // centesimi
    const COMPLETION_XP = 50;

    const lin = (v, good, bad) => (v <= good ? 100 : v >= bad ? 0 : (100 * (bad - v)) / (bad - good));
    const r0 = (v) => (v === null ? null : Math.round(Math.max(0, Math.min(100, v))));

    function isEmergency(truth) {
        return !String(truth.event_type || '').startsWith('impropria.') && (truth.agencies_required || []).length > 0;
    }

    /** Peso della difficoltà in centesimi: 100 + 15 per ogni livello oltre il primo. */
    function difficultyWeight(d) { return 100 + (Math.max(1, d || 1) - 1) * 15; }

    /** Divisione intera con arrotondamento a metà per eccesso (numeri non negativi). */
    function idiv(num, den) { return den > 0 ? Math.floor((2 * num + den) / (2 * den)) : 0; }

    function gradeFor(pct) {
        if (pct >= 90) return 'S';
        if (pct >= 80) return 'A';
        if (pct >= 65) return 'B';
        if (pct >= 50) return 'C';
        return 'D';
    }

    /** Tetti al voto: un esito negativo limita a B, due o più parziali limitano ad A. */
    function capGrade(grade, outcomes) {
        const order = ['S', 'A', 'B', 'C', 'D'];
        let cap = 'S';
        if (outcomes.negativo > 0) cap = 'B';
        else if (outcomes.parziale >= 2) cap = 'A';
        return order[Math.max(order.indexOf(grade), order.indexOf(cap))];
    }

    /** Punteggio finale intero: media pesata degli assi applicabili per il fattore di esito (%). */
    function finalScore(axes, factor = 100) {
        let num = 0;
        let w = 0;
        for (const k of Object.keys(WEIGHTS)) {
            const v = axes[k];
            if (v === null || v === undefined) continue;
            num += v * WEIGHTS[k];
            w += WEIGHTS[k];
        }
        return idiv(num * factor, w * 100);
    }

    /** Enti: corrispondenza con richiesti/accettabili e scambio di competenza PS/CC. */
    function agencyCheck(truth, sent) {
        const R = truth.agencies_required || [];
        const A = truth.agencies_acceptable || [];
        const missing = [];
        const swapped = [];
        let matched = 0;
        for (const a of R) {
            if (sent.includes(a)) { matched += 1; continue; }
            const other = POLICE.includes(a) ? POLICE.find((p) => p !== a) : null;
            if (other && sent.includes(other) && !R.includes(other)) { matched += 0.5; swapped.push({ required: a, sent: other }); continue; }
            missing.push(a);
        }
        const superfluous = sent.filter((a) => !R.includes(a) && !A.includes(a) && !swapped.some((sw) => sw.sent === a));
        const score = R.length ? (100 * matched) / R.length - 15 * superfluous.length : 100;
        return { score, missing, swapped, superfluous };
    }

    function evaluateShift(engine, city) {
        const calls = [...engine.calls.values()].sort((a, b) => a.id - b.id);
        const byIncident = new Map();
        for (const c of calls) {
            if (!byIncident.has(c.incidentKey)) byIncident.set(c.incidentKey, []);
            byIncident.get(c.incidentKey).push(c);
        }

        // ---------- esito per evento ----------
        const incidents = new Map();
        for (const [key, group] of byIncident) {
            const first = group[0];
            const truth = first.content.truth;
            const emergency = isEmergency(truth);
            const transfers = group.filter((c) => c.state === S.TRANSFERRED).sort((a, b) => a.closedMs - b.closedMs);
            const decisive = transfers[0] || null;
            const inc = { key, emergency, decisiveId: decisive ? decisive.id : null, outcome: 'nessuno', delaySec: null, reasons: [] };

            if (emergency) {
                if (!decisive) {
                    inc.outcome = 'negativo';
                    inc.reasons.push('no_help');
                } else {
                    const f = decisive.result.form || {};
                    const firstArrival = Math.min(...group.map((c) => c.arrivalMs));
                    let delay = (decisive.closedMs - firstArrival) / 1000;
                    const missingMin = (f.location ? 0 : 1) + (f.eventType ? 0 : 1);
                    delay += missingMin * INCOMPLETE_PENALTY_S;
                    const loc = decisive.content.location;
                    if (f.location) {
                        const m = LL.Geo.meters(city, [f.location.x, f.location.y], [loc.x, loc.y]);
                        const tol = (ZONE_TOL_M[loc.zone] || [30, 400])[0];
                        delay += Math.min(600, Math.max(0, m - tol) / TRAVEL_M_PER_S);
                    }
                    const ag = agencyCheck(truth, decisive.result.agencies);
                    delay += ag.swapped.length * COMPETENCE_PENALTY_S;
                    inc.delaySec = Math.round(delay);

                    const sev = truth.severity || { acceptable_s: 600, limit_s: 1800 };
                    const levels = ['positivo', 'parziale', 'negativo'];
                    let lvl = delay <= sev.acceptable_s ? 0 : delay <= sev.limit_s ? 1 : 2;
                    if (ag.missing.length === (truth.agencies_required || []).length) {
                        lvl = 2; // nessuno degli enti necessari arriva
                        inc.reasons.push('no_useful_agency');
                    } else if (ag.missing.length) {
                        lvl = Math.min(2, lvl + 1);
                        inc.reasons.push('missing_agency');
                    }
                    inc.outcome = levels[lvl];
                }
            }
            incidents.set(key, inc);
        }

        // ---------- valutazione per chiamata ----------
        const results = [];
        const firstTransferMs = new Map();
        for (const c of calls) {
            if (c.state === S.TRANSFERRED) {
                const prev = firstTransferMs.get(c.incidentKey);
                if (prev === undefined || c.closedMs < prev) firstTransferMs.set(c.incidentKey, c.closedMs);
            }
        }

        for (const c of calls) {
            const truth = c.content.truth;
            const emergency = isEmergency(truth);
            const inc = incidents.get(c.incidentKey);
            const form = c.result?.form || {};
            const sent = c.result?.agencies || [];
            const answered = c.answeredMs !== null;
            const notes = [];
            const axes = { time: null, location: null, classification: null, agencies: null, protocol: null };
            let errorM = null;

            // Tempo
            const waitSec = c.waitMs / 1000;
            const handleSec = answered && c.closedMs !== null ? (c.closedMs - c.answeredMs) / 1000 : null;
            if (!answered) {
                axes.time = 0;
            } else {
                const ideal = emergency ? 75 : 40;
                axes.time = 0.4 * lin(waitSec, 5, 45) + 0.6 * lin(handleSec, ideal, ideal * 3);
            }

            if (c.state === S.ABANDONED) {
                notes.push({ key: `db.note_abandoned_${c.result.where}` });
                const later = byIncident.get(c.incidentKey).find((k) => k.arrivalMs > c.arrivalMs);
                if (later) notes.push({ key: 'db.note_called_back', vars: { time: LL.Time ? LL.Time.clock(engine.gameStartSec + later.arrivalMs / 1000).slice(0, 5) : '' } });
            } else if (c.state === S.TRANSFERRED) {
                // Luogo
                if (emergency) {
                    if (form.location) {
                        errorM = Math.round(LL.Geo.meters(city, [form.location.x, form.location.y], [c.content.location.x, c.content.location.y]));
                        const [good, bad] = ZONE_TOL_M[c.content.location.zone] || [30, 400];
                        axes.location = lin(errorM, good, bad);
                        const addr = c.facts.indirizzo;
                        if (errorM > good && addr && addr.reports.some((r) => !r.correct)) notes.push({ key: 'db.note_wrong_address' });
                        else if (errorM > bad) notes.push({ key: 'db.note_far', vars: { m: errorM } });
                    } else {
                        axes.location = 0;
                    }
                }
                // Enti
                if (!emergency) {
                    axes.agencies = 20;
                    notes.push({ key: 'db.note_transferred_improper' });
                } else {
                    const ag = agencyCheck(truth, sent);
                    axes.agencies = ag.score;
                    if (ag.missing.length) notes.push({ key: 'db.note_missing_agency', vars: { list: ag.missing.join(', ') } });
                    if (ag.swapped.length) notes.push({ key: 'db.note_competence', vars: { required: ag.swapped[0].required, sent: ag.swapped[0].sent } });
                    if (ag.superfluous.length) notes.push({ key: 'db.note_superfluous', vars: { list: ag.superfluous.join(', ') } });
                    if (firstTransferMs.get(c.incidentKey) < c.closedMs) {
                        axes.agencies = Math.min(axes.agencies, 60);
                        notes.push({ key: 'db.note_duplicate_transfer' });
                    }
                }
                if (!form.location || !form.eventType) notes.push({ key: 'db.note_incomplete' });
            } else if (c.state === S.CLOSED) {
                if (emergency) {
                    axes.agencies = 0;
                    axes.location = 0;
                    notes.push({ key: 'db.note_closed_emergency' });
                } else {
                    axes.agencies = 100;
                }
            } else if (c.state === S.MERGED) {
                const target = engine.getCall(c.result.targetId);
                const ok = target && target.incidentKey === c.incidentKey;
                axes.agencies = ok ? 100 : 0;
                axes.classification = ok ? 100 : 0;
                if (!ok) notes.push({ key: 'db.note_wrong_merge' });
            } else if (c.state === S.DROPPED) {
                axes.agencies = emergency ? 0 : 100;
                axes.classification = emergency ? 0 : 70;
                if (emergency) notes.push({ key: 'db.note_dropped_emergency' });
            }

            // Classificazione
            if (axes.classification === null && (c.state === S.TRANSFERRED || c.state === S.CLOSED)) {
                const chosen = form.eventType || '';
                const expected = truth.event_type;
                const acceptable = truth.acceptable_event_types || [];
                if (chosen === expected) axes.classification = 100;
                else if (acceptable.includes(chosen)) axes.classification = 80;
                else if (chosen && chosen.split('.')[0] === expected.split('.')[0]) axes.classification = 50;
                else axes.classification = 0;
                if (axes.classification < 100 && chosen) notes.push({ key: 'db.note_classification' });
            }

            // Protocollo
            const critical = (truth.critical_facts || []).map((k) => {
                const f = c.facts[k];
                const reports = f ? f.reports : [];
                return {
                    key: k,
                    label: c.content.facts[k]?.label || null,
                    atSec: reports.length && answered ? Math.round((reports[0].ms - c.answeredMs) / 1000) : null,
                    wrong: reports.length > 0 && !reports[reports.length - 1].correct,
                    conflict: new Set(reports.map((r) => r.display)).size > 1,
                };
            });
            if (answered) {
                const ratio = c.state === S.MERGED || !critical.length ? 1 : critical.filter((k) => k.atSec !== null).length / critical.length;
                const formPart = c.state === S.TRANSFERRED ? (((form.location ? 1 : 0) + (form.eventType ? 1 : 0)) / 2) * 20 : 20;
                const calmPart = 20 * lin(c.panic, 50, 90) / 100;
                axes.protocol = 60 * ratio + formPart + calmPart;
                if (ratio < 1 && c.state !== S.MERGED) notes.push({ key: 'db.note_missing_facts' });
                if (c.panic >= 80) notes.push({ key: 'db.note_panic' });
            }

            for (const k of Object.keys(axes)) axes[k] = r0(axes[k]);

            const decisive = inc.decisiveId === c.id;
            const outcome = decisive ? inc.outcome : (inc.emergency && !inc.decisiveId && c.id === byIncident.get(c.incidentKey)[0].id ? 'negativo' : 'nessuno');
            const final = finalScore(axes, decisive ? OUTCOME_FACTOR[inc.outcome] : 100);
            const dw = difficultyWeight(c.content.difficulty);

            results.push({
                id: c.id,
                seq: c.id,
                templateId: c.content.templateId,
                templateVersion: c.content.version,
                code: c.content.code,
                title: c.content.title,
                difficulty: c.content.difficulty,
                variantIndex: c.variantIndex,
                incidentKey: c.incidentKey,
                isDuplicate: c.incidentKey !== c.id,
                isWitness: !!c.content.isWitness,
                isCallback: c.parentId !== null,
                state: c.state,
                arrivalSec: Math.round(c.arrivalMs / 1000),
                answeredSec: answered ? Math.round(c.answeredMs / 1000) : null,
                closedSec: c.closedMs !== null ? Math.round(c.closedMs / 1000) : null,
                waitSec: Math.round(waitSec),
                handleSec: handleSec === null ? null : Math.round(handleSec),
                emergency,
                truth: {
                    event: truth.event_type,
                    agencies: truth.agencies_required,
                    street: c.content.location.street,
                    number: c.content.location.number,
                    zone: c.content.location.zone,
                    zoneName: c.content.location.zone_name,
                },
                you: {
                    event: form.eventType || null,
                    agencies: sent,
                    street: form.location?.street || null,
                    number: form.location?.number ?? null,
                    errorM,
                },
                axes,
                final,
                points: idiv(final * dw * POINTS_FACTOR, 10000),
                weight: dw * (c.state === S.ABANDONED && !emergency ? 1 : 2),
                decisive,
                outcome,
                delaySec: decisive ? inc.delaySec : null,
                critical,
                notes,
                hint: truth.hint_debrief || '',
            });
        }

        // ---------- turno ----------
        let wsum = 0;
        let fsum = 0;
        let points = 0;
        const axesSum = { time: [0, 0], location: [0, 0], classification: [0, 0], agencies: [0, 0], protocol: [0, 0] };
        for (const r of results) {
            wsum += r.weight;
            fsum += r.final * r.weight;
            points += r.points;
            for (const [k, v] of Object.entries(r.axes)) {
                if (v !== null) { axesSum[k][0] += v; axesSum[k][1]++; }
            }
        }
        const percent = idiv(fsum, wsum);
        const outcomes = { positivo: 0, parziale: 0, negativo: 0 };
        for (const inc of incidents.values()) if (inc.emergency) outcomes[inc.outcome]++;
        const grade = capGrade(gradeFor(percent), outcomes);
        const axesAvg = Object.fromEntries(Object.entries(axesSum).map(([k, [s, n]]) => [k, n ? Math.round(s / n) : null]));

        return {
            calls: results,
            percent,
            grade,
            points,
            xp: idiv(points * GRADE_MULT[grade], 100) + COMPLETION_XP,
            axesAvg,
            outcomes,
            emergencies: [...incidents.values()].filter((i) => i.emergency).length,
        };
    }

    LL.Scoring = { evaluateShift, finalScore, idiv, gradeFor, capGrade, difficultyWeight, agencyCheck, WEIGHTS, OUTCOME_FACTOR, GRADE_MULT, POINTS_FACTOR, COMPLETION_XP };
})(globalThis.LL = globalThis.LL || {});
