/**
 * Scheda contatto: missing() restituisce le chiavi dei dati minimi mancanti
 * ('place', 'event', 'agency') e missingLabels() le traduce come il vecchio testo di stato.
 * Uso: node tests/form_missing.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeChecker } = require('./_load');

const ROOT = path.join(__dirname, '..');
const it = JSON.parse(fs.readFileSync(path.join(ROOT, 'lang/it.json'), 'utf8'));
const lookup = (k) => k.split('.').reduce((o, p) => (o && o[p] !== undefined ? o[p] : undefined), it);
const I18n = { t: (k) => (typeof lookup(k) === 'string' ? lookup(k) : k) };

const ctx = vm.createContext({ console, I18n, LL: { CallState: {} } });
ctx.globalThis = ctx;
vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js/ui/form.js'), 'utf8'), ctx, { filename: 'form.js' });
const proto = ctx.LL.ContactForm.prototype;

const { check, done } = makeChecker();
const draft = (o) => Object.assign({ point: null, eventType: '', agencies: [] }, o);

check(JSON.stringify(proto.missing(draft({}))) === '["place","event","agency"]', 'scheda vuota: mancano luogo, evento ed ente, in quest\'ordine');
check(JSON.stringify(proto.missing(draft({ point: [10, 20] }))) === '["event","agency"]', 'con il luogo mancano evento ed ente');
check(JSON.stringify(proto.missing(draft({ eventType: 'sanitaria.malore', agencies: ['118'] }))) === '["place"]', 'manca solo il luogo');
check(proto.missing(draft({ point: [1, 2], eventType: 'sanitaria.malore', agencies: ['118'] })).length === 0, 'scheda completa: nessuna chiave');
const labels = proto.missingLabels(['place', 'event', 'agency']);
check(labels.join(', ') === [it.form.miss_location, it.form.miss_event, it.form.miss_agency].join(', '), 'le etichette restano quelle del testo di stato 1.1');

done();
