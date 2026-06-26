export class EventEmitter {
    constructor() {
        this._handlers = {};
    }

    on(event, fn) {
        (this._handlers[event] ??= []).push(fn);
        return this;
    }

    off(event, fn) {
        this._handlers[event] = (this._handlers[event] ?? []).filter(h => h !== fn);
        return this;
    }

    emit(event, ...args) {
        (this._handlers[event] ?? []).forEach(fn => fn(...args));
        return this;
    }
}