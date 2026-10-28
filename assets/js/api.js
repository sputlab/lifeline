/**
 * LifeLine - Client API
 * Gestisce il token CSRF e riprova una volta se il token è scaduto.
 */
'use strict';

class ApiError extends Error {
    constructor(code, status = 0, message = '', vars = {}) {
        super(message || code);
        this.code = code;
        this.status = status;
        this.vars = vars;
    }
}

const Api = (() => {
    let csrf = null;

    async function raw(endpoint, action, { method = 'GET', body } = {}) {
        const headers = { Accept: 'application/json' };
        if (method !== 'GET') {
            headers['Content-Type'] = 'application/json';
            if (csrf) headers['X-CSRF-Token'] = csrf;
        }
        let res;
        try {
            res = await fetch(`api/${endpoint}.php?action=${encodeURIComponent(action)}`, {
                method,
                headers,
                credentials: 'same-origin',
                body: body !== undefined ? JSON.stringify(body) : undefined,
            });
        } catch (_) {
            throw new ApiError('network');
        }
        let json;
        try {
            json = await res.json();
        } catch (_) {
            throw new ApiError('bad_response', res.status);
        }
        if (json?.data?.csrf) csrf = json.data.csrf;
        if (!json.ok) {
            throw new ApiError(json.error?.code || 'server_error', res.status, json.error?.message, json.error || {});
        }
        return json.data;
    }

    async function request(endpoint, action, opts = {}) {
        try {
            return await raw(endpoint, action, opts);
        } catch (err) {
            if (err.code === 'csrf_invalid' && opts.method && opts.method !== 'GET') {
                await raw('auth', 'csrf');
                return raw(endpoint, action, opts);
            }
            throw err;
        }
    }

    return {
        me:             ()     => request('auth', 'me'),
        login:          (data) => request('auth', 'login', { method: 'POST', body: data }),
        register:       (data) => request('auth', 'register', { method: 'POST', body: data }),
        logout:         ()     => request('auth', 'logout', { method: 'POST', body: {} }),
        profile:        ()     => request('profile', 'get'),
        updateProfile:  (data) => request('profile', 'update', { method: 'POST', body: data }),
        changePassword: (data) => request('profile', 'change_password', { method: 'POST', body: data }),
        startShift:     (mode) => request('shift', 'start', { method: 'POST', body: { mode } }),
        finishShift:    (data) => request('shift', 'finish', { method: 'POST', body: data }),
        abandonShift:   (id)   => request('shift', 'abandon', { method: 'POST', body: { shift_id: id } }),
    };
})();
