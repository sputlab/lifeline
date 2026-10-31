/**
 * LifeLine - «Voce HD»: voce neurale italiana (Piper) nel browser, solo su richiesta del giocatore
 *
 * Caricato con import() da voice.js SOLO se il giocatore sceglie «Voce HD» nelle impostazioni.
 * Nulla viene scaricato finché il giocatore non preme «Scarica» (circa 120 MB, una volta sola).
 *
 * Componenti (versioni esatte, da CDN pubblici, salvati in Cache Storage 'll-tts-v1'):
 *   onnxruntime-web@1.18.0         motore di inferenza ONNX in WebAssembly (MIT, Microsoft)
 *   @diffusionstudio/piper-wasm@1.0.0  fonemizzatore piper-phonemize + dati espeak-ng in WebAssembly
 *                                  (pacchetto MIT; contiene espeak-ng, GPL-3.0)
 *   rhasspy/piper-voices           voci it_IT-paola-medium (femminile, dataset CC0-1.0) e
 *                                  it_IT-riccardo-x_low (maschile, dataset M-AILABS), repository MIT,
 *                                  scaricate da una revisione fissata su Hugging Face
 *
 * La sintesi gira in un Worker (fuori dal thread principale): testo -> fonemi (espeak) -> VITS (ONNX)
 * -> PCM. Il PCM diventa un AudioBuffer che LL.Sound suona attraverso il filtro telefonico.
 * Qualunque errore viene propagato come promessa rifiutata: voice.js passa alla voce del browser.
 *
 * La cache non inizia con 'lifeline-', così il service worker non la cancella agli aggiornamenti.
 */
(function (LL) {
    'use strict';

    const CACHE = 'll-tts-v1';
    const ORT = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/';
    const PHON = 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize';
    const HF = 'https://huggingface.co/rhasspy/piper-voices/resolve/b4e358ffcb232591bf73a540e70f7de528e4174a/it/it_IT/';

    const MODELS = {
        paola:    { id: 'it_IT-paola-medium',   gender: 'f', path: 'paola/medium/it_IT-paola-medium',     bytes: 63511038 },
        riccardo: { id: 'it_IT-riccardo-x_low', gender: 'm', path: 'riccardo/x_low/it_IT-riccardo-x_low', bytes: 28130791 },
    };

    const RUNTIME = {
        ortJs:    { url: ORT + 'ort.wasm.min.js',      bytes: 142930,   type: 'text/javascript' },
        ortWasm:  { url: ORT + 'ort-wasm-simd.wasm',   bytes: 10595041, type: 'application/wasm' },
        phonJs:   { url: PHON + '.js',                 bytes: 120714,   type: 'text/javascript' },
        phonWasm: { url: PHON + '.wasm',               bytes: 635212,   type: 'application/wasm' },
        phonData: { url: PHON + '.data',               bytes: 18077249, type: 'application/octet-stream' },
    };

    /** Crediti e licenze mostrati nelle impostazioni. */
    const CREDITS = [
        'Piper (rhasspy/piper-voices, MIT): it_IT-paola-medium (dataset paolapersico1/Voice-Dataset-Italian, CC0-1.0), it_IT-riccardo-x_low (dataset M-AILABS)',
        'onnxruntime-web 1.18.0 (MIT, Microsoft)',
        'piper-phonemize / espeak-ng (@diffusionstudio/piper-wasm 1.0.0; espeak-ng GPL-3.0)',
    ];

    function allFiles() {
        const list = Object.entries(RUNTIME).map(([key, f]) => ({ key, url: f.url, bytes: f.bytes, type: f.type }));
        for (const [name, m] of Object.entries(MODELS)) {
            list.push({ key: name + 'Model', url: HF + m.path + '.onnx', bytes: m.bytes, type: 'application/octet-stream' });
            list.push({ key: name + 'Config', url: HF + m.path + '.onnx.json', bytes: 8000, type: 'application/json' });
        }
        return list;
    }

    const TOTAL_BYTES = allFiles().reduce((s, f) => s + f.bytes, 0);

    /* ---------------- Worker (testo -> PCM) ----------------
     * Funzione serializzata in un Blob: non vede nulla di questo file. Legge i file solo dalla cache:
     * se ne manca uno fallisce, non scarica mai di sua iniziativa. */
    function workerMain() {
        'use strict';
        let cfg = null;
        let phonModule = null;     // WebAssembly.Module del fonemizzatore, compilato una volta
        let phonData = null;       // dati espeak-ng (ArrayBuffer)
        const sessions = {};       // modello -> Promise<{ session, config }>
        const queue = [];
        let busy = false;
        let floor = 0;             // i lavori con gen < floor sono annullati

        async function cached(url) {
            const c = await caches.open(cfg.cache);
            const r = await c.match(url);
            if (!r) throw new Error('file Voce HD mancante: ' + url);
            return r;
        }
        async function blobUrl(url, type) {
            const b = await (await cached(url)).blob();
            return URL.createObjectURL(new Blob([b], { type }));
        }

        async function init(c) {
            cfg = c;
            importScripts(await blobUrl(c.files.ortJs, 'text/javascript'));
            self.onmessage = onMessage;      // per sicurezza: le librerie non devono rubare i messaggi
            /* global ort, createPiperPhonemize */
            const wasmUrl = await blobUrl(c.files.ortWasm, 'application/wasm');
            ort.env.wasm.numThreads = 1;
            ort.env.wasm.proxy = false;
            ort.env.wasm.wasmPaths = { 'ort-wasm-simd.wasm': wasmUrl, 'ort-wasm.wasm': wasmUrl };
            importScripts(await blobUrl(c.files.phonJs, 'text/javascript'));
            self.onmessage = onMessage;
            phonModule = await WebAssembly.compile(await (await cached(c.files.phonWasm)).arrayBuffer());
            phonData = await (await cached(c.files.phonData)).arrayBuffer();
        }

        function session(model) {
            if (!sessions[model]) {
                const m = cfg.models[model];
                if (!m) throw new Error('modello sconosciuto ' + model);
                sessions[model] = (async () => {
                    const config = await (await cached(m.config)).json();
                    const bytes = await (await cached(m.onnx)).arrayBuffer();
                    const s = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
                    return { session: s, config };
                })();
                sessions[model].catch(() => { delete sessions[model]; });
            }
            return sessions[model];
        }

        async function phonemize(text, voice) {
            const lines = [];
            const mod = await createPiperPhonemize({
                print: (s) => lines.push(s),
                printErr: () => {},
                noInitialRun: true,
                locateFile: (u) => u,
                getPreloadedPackage: () => phonData.slice(0),
                instantiateWasm: (imports, receive) => {
                    WebAssembly.instantiate(phonModule, imports).then((inst) => receive(inst, phonModule));
                    return {};
                },
            });
            mod.callMain(['-l', voice, '--input', JSON.stringify([{ text }]), '--espeak_data', '/espeak-ng-data']);
            const ids = [];
            for (const l of lines) {
                try { const j = JSON.parse(l); if (Array.isArray(j.phoneme_ids)) ids.push(...j.phoneme_ids); } catch (_) { /* riga non JSON */ }
            }
            if (!ids.length) throw new Error('nessun fonema');
            return ids;
        }

        async function synth(job) {
            const { session: s, config } = await session(job.model);
            const ids = await phonemize(job.text, (config.espeak && config.espeak.voice) || 'it');
            const inf = config.inference || {};
            const i64 = (arr) => BigInt64Array.from(arr, (x) => BigInt(x));
            const feeds = {
                input: new ort.Tensor('int64', i64(ids), [1, ids.length]),
                input_lengths: new ort.Tensor('int64', i64([ids.length]), [1]),
                scales: new ort.Tensor('float32', Float32Array.from([
                    inf.noise_scale ?? 0.667, (inf.length_scale ?? 1) * (job.lengthScale || 1), inf.noise_w ?? 0.8]), [3]),
                sid: new ort.Tensor('int64', i64([0]), [1]),
            };
            const names = s.inputNames || Object.keys(feeds);
            const used = {};
            for (const n of names) if (feeds[n]) used[n] = feeds[n];
            const out = await s.run(used);
            const t = out.output || out[s.outputNames[0]];
            const pcm = new Float32Array(t.data);
            return { pcm, sampleRate: (config.audio && config.audio.sample_rate) || 22050 };
        }

        async function pump() {
            if (busy) return;
            busy = true;
            while (queue.length) {
                // prima le frasi da dire subito, poi i pre-riscaldamenti
                let at = queue.findIndex((q) => !q.keep);
                if (at < 0) at = 0;
                const job = queue.splice(at, 1)[0];
                if (job.gen < floor && !job.keep) { postMessage({ id: job.id, ok: false, error: 'annullato' }); continue; }
                try {
                    const r = await synth(job);
                    postMessage({ id: job.id, ok: true, pcm: r.pcm, sampleRate: r.sampleRate }, [r.pcm.buffer]);
                } catch (e) {
                    postMessage({ id: job.id, ok: false, error: String((e && e.message) || e) });
                }
            }
            busy = false;
        }

        async function onMessage(e) {
            const m = e.data || {};
            if (m.type === 'init') {
                try { await init(m.cfg); postMessage({ id: m.id, ok: true }); } catch (err) { postMessage({ id: m.id, ok: false, error: String((err && err.message) || err) }); }
            } else if (m.type === 'synth') {
                queue.push(m);
                pump();
            } else if (m.type === 'cancel') {
                floor = m.gen;
            } else if (m.type === 'load') {
                try { await session(m.model); postMessage({ id: m.id, ok: true }); } catch (err) { postMessage({ id: m.id, ok: false, error: String((err && err.message) || err) }); }
            }
        }
        self.onmessage = onMessage;
    }

    /* ---------------- Thread principale ---------------- */

    const LRU_MAX = 12;

    const VoiceNeural = {
        CACHE,
        MODELS,
        RUNTIME,
        CREDITS,
        TOTAL_BYTES,
        _worker: null,
        _init: null,
        _ready: false,
        _id: 0,
        _gen: 1,
        _pending: new Map(),       // id -> { resolve, reject, gen, keep }
        _lru: new Map(),           // chiave -> AudioBuffer
        _inflight: new Map(),      // chiave -> Promise<AudioBuffer>
        _downloading: null,
        lastError: '',             // ultimo errore di avvio (mostrato nelle impostazioni)
        stats: { n: 0, ema: 0, last: 0 },   // tempo di sintesi di un pezzo (ms): serve a regolare l'attesa prima di passare alla voce del browser
        _warmPending: 0,           // pre-riscaldamenti in coda

        supported() {
            try {
                return typeof Worker === 'function' && typeof caches !== 'undefined' && typeof WebAssembly === 'object'
                    && typeof BigInt64Array === 'function' && (typeof isSecureContext === 'undefined' || isSecureContext);
            } catch (_) { return false; }
        },

        isReady() { return this._ready; },

        /** Velocità -> length_scale di Piper (arrotondata per riusare la cache delle frasi). */
        lengthScaleFor(rate) {
            const r = Math.max(0.6, Math.min(1.6, Number(rate) || 1));
            return Math.round((1 / r) * 20) / 20;
        },

        /** @returns {Promise<{installed: boolean, bytes: number, missing: string[]}>} senza creare la cache se non c'è */
        async status() {
            const files = allFiles();
            if (!this.supported() || !(await caches.has(CACHE))) return { installed: false, bytes: 0, missing: files.map((f) => f.url) };
            const c = await caches.open(CACHE);
            const missing = [];
            let bytes = 0;
            for (const f of files) {
                const r = await c.match(f.url);
                if (r) bytes += f.bytes; else missing.push(f.url);
            }
            return { installed: missing.length === 0, bytes, missing };
        },

        /**
         * Scarica i file mancanti nella cache. Solo su richiesta esplicita del giocatore.
         * @param {function} [onProgress]  (loaded, total) in byte
         * @param {AbortSignal} [signal]
         */
        download(onProgress, signal) {
            if (this._downloading) return this._downloading;
            this._downloading = (async () => {
                if (!this.supported()) throw new Error('browser non compatibile');
                try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (_) { /* facoltativo */ }
                const files = allFiles();
                const c = await caches.open(CACHE);
                let loaded = 0;
                const report = () => { try { onProgress && onProgress(Math.min(loaded, TOTAL_BYTES), TOTAL_BYTES); } catch (_) { /* */ } };
                for (const f of files) {
                    if (await c.match(f.url)) { loaded += f.bytes; report(); continue; }
                    const res = await fetch(f.url, { mode: 'cors', credentials: 'omit', signal });
                    if (!res.ok) throw new Error(`download ${res.status}: ${f.url}`);
                    let blob;
                    if (res.body && res.body.getReader) {
                        const reader = res.body.getReader();
                        const chunks = [];
                        let got = 0;
                        for (;;) {
                            const { done, value } = await reader.read();
                            if (done) break;
                            chunks.push(value);
                            got += value.byteLength;
                            loaded += value.byteLength;
                            report();
                        }
                        loaded += Math.max(0, f.bytes - got);   // le dimensioni note sono solo stime
                        blob = new Blob(chunks, { type: f.type });
                    } else {
                        blob = await res.blob();
                        loaded += f.bytes;
                    }
                    await c.put(f.url, new Response(blob, { headers: { 'Content-Type': f.type, 'Content-Length': String(blob.size) } }));
                    report();
                }
                loaded = TOTAL_BYTES; report();
            })();
            const p = this._downloading;
            p.finally(() => { if (this._downloading === p) this._downloading = null; }).catch(() => {});
            return p;
        },

        /** Elimina il download e libera la memoria. */
        async remove() {
            this._shutdown();
            this.lastError = '';
            try { await caches.delete(CACHE); } catch (_) { /* */ }
        },

        _shutdown() {
            if (this._worker) { try { this._worker.terminate(); } catch (_) { /* */ } }
            this._worker = null;
            this._init = null;
            this._ready = false;
            for (const p of this._pending.values()) p.reject(new Error('Voce HD chiusa'));
            this._pending.clear();
            this._lru.clear();
            this._inflight.clear();
        },

        _call(msg, extra = {}) {
            return new Promise((resolve, reject) => {
                const id = ++this._id;
                this._pending.set(id, Object.assign({ resolve, reject, gen: this._gen }, extra));
                try { this._worker.postMessage(Object.assign({ id, gen: this._gen }, msg, extra)); } catch (e) { this._pending.delete(id); reject(e); }
            });
        },

        /** Avvia il worker se i file sono in cache. Non scarica nulla. */
        init() {
            if (this._init) return this._init;
            this._init = (async () => {
                if (!this.supported()) throw new Error('browser non compatibile');
                const st = await this.status();
                if (!st.installed) throw new Error('Voce HD non scaricata');
                const src = `(${workerMain.toString()})();`;
                const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
                const w = new Worker(url);
                this._worker = w;
                w.onmessage = (e) => {
                    const m = e.data || {};
                    const p = this._pending.get(m.id);
                    if (!p) return;
                    this._pending.delete(m.id);
                    if (m.ok) p.resolve(m); else p.reject(new Error(m.error || 'errore Voce HD'));
                };
                w.onerror = (e) => { console.warn('Voce HD: errore del worker', e && e.message); this._shutdown(); };
                const models = {};
                for (const [name, m] of Object.entries(MODELS)) models[name] = { onnx: HF + m.path + '.onnx', config: HF + m.path + '.onnx.json' };
                const files = {};
                for (const [k, f] of Object.entries(RUNTIME)) files[k] = f.url;
                await this._call({ type: 'init', cfg: { cache: CACHE, files, models } });
                // carica subito le due voci (qualche secondo, nel worker)
                await Promise.all(Object.keys(MODELS).map((model) => this._call({ type: 'load', model })));
                this._ready = true;
                this.lastError = '';
            })();
            this._init.catch((e) => { this._shutdown(); this.lastError = String((e && e.message) || e); });
            return this._init;
        },

        _toBuffer(pcm, sampleRate) {
            let buf;
            try { buf = new AudioBuffer({ numberOfChannels: 1, length: pcm.length, sampleRate }); } catch (_) {
                if (!LL.Sound || !LL.Sound.ctx) throw new Error('audio non disponibile');
                buf = LL.Sound.ctx.createBuffer(1, pcm.length, sampleRate);
            }
            // brevi sfumature agli estremi per evitare clic
            const fade = Math.min(pcm.length >> 1, Math.round(sampleRate * 0.006));
            for (let i = 0; i < fade; i++) { const k = i / fade; pcm[i] *= k; pcm[pcm.length - 1 - i] *= k; }
            if (buf.copyToChannel) buf.copyToChannel(pcm, 0); else buf.getChannelData(0).set(pcm);
            return buf;
        },

        /**
         * Sintetizza una frase.
         * @param {string} text
         * @param {object} o  { model: 'paola'|'riccardo', lengthScale, keep: true per il pre-riscaldamento }
         * @returns {Promise<AudioBuffer>}
         */
        synth(text, { model = 'paola', lengthScale = 1, keep = false } = {}) {
            if (!this._ready) return Promise.reject(new Error('Voce HD non pronta'));
            const key = `${model}|${lengthScale}|${text}`;
            const hit = this._lru.get(key);
            if (hit) { this._lru.delete(key); this._lru.set(key, hit); return Promise.resolve(hit); }
            if (this._inflight.has(key)) return this._inflight.get(key);
            const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
            const p = this._call({ type: 'synth', text, model, lengthScale }, { keep }).then((m) => {
                const dt = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
                const st = this.stats;
                st.last = dt;
                st.ema = st.n ? st.ema * 0.7 + dt * 0.3 : dt;
                st.n++;
                const buf = this._toBuffer(m.pcm, m.sampleRate);
                this._lru.set(key, buf);
                while (this._lru.size > LRU_MAX) this._lru.delete(this._lru.keys().next().value);
                return buf;
            });
            this._inflight.set(key, p);
            p.then(() => this._inflight.delete(key), () => this._inflight.delete(key));
            return p;
        },

        /** Pre-riscalda una frase (es. l'apertura mentre la linea squilla). Non viene annullata da cancelAll(). */
        prewarm(text, opts) {
            if (!this._ready || !text || this._warmPending >= 3) return;   // niente code lunghe: si perderebbe tempo per le frasi vere
            this._warmPending++;
            this.synth(text, Object.assign({}, opts, { keep: true })).catch(() => {}).finally(() => { this._warmPending--; });
        },

        /** Annulla le frasi in attesa (non il pre-riscaldamento). */
        cancelAll() {
            if (!this._worker) return;
            // il worker risponde 'annullato' ai lavori in coda con gen precedente (le promesse vengono rifiutate)
            this._gen++;
            try { this._worker.postMessage({ type: 'cancel', gen: this._gen }); } catch (_) { /* */ }
        },
    };

    LL.VoiceNeural = VoiceNeural;
})(globalThis.LL = globalThis.LL || {});
