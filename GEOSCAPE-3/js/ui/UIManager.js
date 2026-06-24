// UIManager.js
import { CONFIG } from '../config.js';

export class UIManager {
    constructor(gameEngine) {
        this.engine = gameEngine;
        this.debounceTimeout = null;
        this.bindEvents();
        this.bindConsole();
    }

    bindConsole() {
        const input = document.getElementById('console-input');
        input?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const commandString = input.value.trim();
                if (!commandString) return;
                this.logToConsole(`> ${commandString}`, 'log-user');
                input.value = '';
                this.engine.executeCommand(commandString);
            }
        });
        this.logToConsole('Терминал отладки инициализирован. Введите /help для списка команд.', 'log-sys');
    }

    logToConsole(text, className = 'log-sys') {
        const output = document.getElementById('console-output');
        if (!output) return;
        const line = document.createElement('div');
        line.className = `log-entry ${className}`;
        line.textContent = text;
        output.appendChild(line);
        output.scrollTop = output.scrollHeight;
    }

    clearConsole() {
        const output = document.getElementById('console-output');
        if (output) output.innerHTML = '';
    }

    getVisibilitySettings() {
        return {
            solid: document.getElementById('show-solid')?.checked ?? true,
            wire: document.getElementById('show-wire')?.checked ?? false,
            atmos: document.getElementById('show-atmos')?.checked ?? true
        };
    }

    setCameraFocusUI(mode) {
        const focusIds = ['free', 'player', 'sun', 'planet', 'moon'];
        focusIds.forEach(fid => {
            document.getElementById(`focus-${fid}`)?.classList.remove('active');
        });
        document.getElementById(`focus-${mode}`)?.classList.add('active');
        
        const rightPanel = document.getElementById('ui-panel-right');
        if (rightPanel) rightPanel.style.display = (mode === 'player') ? 'block' : 'none';
    }

    updatePlayerStats(transform, altitude) {
        const lat = Math.asin(transform.up.y) * (180 / Math.PI);
        const lon = Math.atan2(transform.up.z, transform.up.x) * (180 / Math.PI);
        
        const elLat = document.getElementById('hud-lat');
        const elLon = document.getElementById('hud-lon');
        const elAlt = document.getElementById('hud-alt');
        
        if (elLat) elLat.textContent = lat.toFixed(2) + '°';
        if (elLon) elLon.textContent = lon.toFixed(2) + '°';
        if (elAlt) elAlt.textContent = Math.round(altitude) + ' м';
    }

    showTargetCoords(targetName, lat, lon) {
        const panel = document.getElementById('coord-panel');
        if (!panel) return;
        
        panel.style.display = 'block';
        
        const elTitle = document.getElementById('coord-title');
        const elLat = document.getElementById('coord-lat');
        const elLon = document.getElementById('coord-lon');
        
        if (elTitle) elTitle.textContent = targetName;
        if (elLat) elLat.textContent = lat.toFixed(2);
        if (elLon) elLon.textContent = lon.toFixed(2);

        const typeMap = { 'Планета': 'planet', 'Луна': 'moon', 'Солнце': 'sun' };
        const bodyType = typeMap[targetName] || 'planet';
        
        panel.className = `coord-panel--${bodyType}`;
    }

    hideTargetCoords() {
        const panel = document.getElementById('coord-panel');
        if (panel) panel.style.display = 'none';
    }
    
    showLoadingIndicator(show) {
        let el = document.getElementById('loading-indicator');
        if (!el && show) {
            el = document.createElement('div');
            el.id = 'loading-indicator';
            el.style.position = 'absolute';
            el.style.bottom = '80px';
            el.style.left = '50%';
            el.style.transform = 'translateX(-50%)';
            el.style.background = 'rgba(0,0,0,0.7)';
            el.style.color = '#fff';
            el.style.padding = '8px 16px';
            el.style.borderRadius = '8px';
            el.style.fontFamily = 'monospace';
            el.style.zIndex = '200';
            el.style.fontSize = '12px';
            el.style.border = '1px solid #4488ff';
            document.body.appendChild(el);
        }
        if (el) el.style.display = show ? 'block' : 'none';
    }
    
    updateLoadingProgress(body, progress) {
        const el = document.getElementById('loading-indicator');
        if (el) el.textContent = `Генерация ${body}... ${progress}%`;
    }

    scheduleGenerate() {
        if (this.debounceTimeout) clearTimeout(this.debounceTimeout);
        this.debounceTimeout = setTimeout(() => {
            this.engine.generateSystem();
        }, CONFIG.generationDebounceMs);
    }

    // Синхронизация значений стейта обратно в UI элементы после десериализации
    syncStateToUI() {
        const updateUI = (id, key, isP) => {
            const el = document.getElementById(id);
            if(el && this.engine.state[key] !== undefined) {
                el.value = this.engine.state[key];
                const valEl = document.getElementById(`val-${id}`);
                if (valEl) {
                    valEl.textContent = isP ? Math.round(this.engine.state[key] * 100) + '%' : this.engine.state[key].toFixed(2);
                }
            }
        };
        const seedInput = document.getElementById('seed-input');
        if (seedInput) seedInput.value = this.engine.state.seed;
        
        updateUI('gen-water', 'waterLevel', true); 
        updateUI('gen-cont', 'continents', false); 
        updateUI('gen-isl', 'islands', false);
        updateUI('gen-elev', 'elevationSpread', false); 
        updateUI('gen-temp', 'globalTemp', false); 
        updateUI('gen-moist', 'globalMoisture', false);
        updateUI('gen-c-std', 'cloudStandard', true); 
        updateUI('gen-c-rain', 'cloudRain', true); 
        updateUI('gen-c-cirrus', 'cloudCirrus', true);
    }

    bindEvents() {
        document.getElementById('btn-randomize')?.addEventListener('click', () => {
            this.engine.state.seed = Math.floor(Math.random() * 999999);
            const seedInput = document.getElementById('seed-input');
            if (seedInput) seedInput.value = this.engine.state.seed;
            this.scheduleGenerate();
        });

        document.getElementById('btn-generate')?.addEventListener('click', () => {
            const seedInput = document.getElementById('seed-input');
            this.engine.state.seed = parseInt(seedInput?.value) || 0;
            this.engine.generateSystem();
        });

        const bindGenSlider = (id, stateKey, isPercent = false) => {
            const el = document.getElementById(id);
            const valEl = document.getElementById(`val-${id}`);
            if(!el || !valEl) return;
            el.addEventListener('input', (e) => {
                const val = Number(e.target.value);
                this.engine.state[stateKey] = val;
                valEl.textContent = isPercent ? Math.round(val * 100) + '%' : val.toFixed(2);
            });
            el.addEventListener('change', () => this.scheduleGenerate());
        };

        bindGenSlider('gen-water', 'waterLevel', true);
        bindGenSlider('gen-cont', 'continents');
        bindGenSlider('gen-isl', 'islands');
        bindGenSlider('gen-elev', 'elevationSpread');
        bindGenSlider('gen-temp', 'globalTemp');
        bindGenSlider('gen-moist', 'globalMoisture');
        bindGenSlider('gen-c-std', 'cloudStandard', true);
        bindGenSlider('gen-c-rain', 'cloudRain', true);
        bindGenSlider('gen-c-cirrus', 'cloudCirrus', true);

        // Использование глобальной сериализации для JSON
        document.getElementById('btn-export')?.addEventListener('click', () => {
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(this.engine.serialize());
            const dl = document.createElement('a');
            dl.setAttribute("href", dataStr);
            dl.setAttribute("download", `geoscape_save_${this.engine.state.seed}.json`);
            dl.click();
        });

        // Быстрые сохранения в localStorage
        document.getElementById('btn-save')?.addEventListener('click', () => {
            localStorage.setItem('geoscape_quicksave', this.engine.serialize());
            this.logToConsole('[SYS] Быстрое сохранение выполнено в LocalStorage.', 'log-sys');
        });

        document.getElementById('btn-load')?.addEventListener('click', () => {
            const data = localStorage.getItem('geoscape_quicksave');
            if (data) {
                this.engine.deserialize(data);
            } else {
                this.logToConsole('[WARN] Быстрое сохранение не найдено.', 'log-warn');
            }
        });

        document.getElementById('btn-import')?.addEventListener('click', () => document.getElementById('file-input')?.click());
        document.getElementById('file-input')?.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (event) => {
                this.engine.deserialize(event.target.result);
                // Сброс input, чтобы можно было загрузить тот же файл снова
                e.target.value = ''; 
            };
            reader.readAsText(file);
        });

        const updateVis = () => {
            const vis = this.getVisibilitySettings();
            this.engine.solarSystem.setVisibility(vis.solid, vis.wire, vis.atmos);
        };
        ['show-solid', 'show-wire', 'show-atmos'].forEach(id => document.getElementById(id)?.addEventListener('change', updateVis));

        document.getElementById('bloom-strength')?.addEventListener('input', (e) => {
            this.engine.renderer.setBloomStrength(Number(e.target.value));
            const valEl = document.getElementById('val-bloom-strength');
            if (valEl) valEl.textContent = e.target.value;
        });

        document.getElementById('bloom-threshold')?.addEventListener('input', (e) => {
            this.engine.renderer.setBloomThreshold(Number(e.target.value));
            const valEl = document.getElementById('val-bloom-threshold');
            if (valEl) valEl.textContent = e.target.value;
        });

        document.getElementById('atmos-scale')?.addEventListener('input', (e) => {
            const val = Number(e.target.value);
            this.engine.solarSystem.setAtmosScale(val);
            const valEl = document.getElementById('val-atmos-scale');
            if (valEl) valEl.textContent = val.toFixed(2);
        });

        document.getElementById('atmos-int')?.addEventListener('input', (e) => {
            const val = Number(e.target.value);
            this.engine.materials.atmosphereUniforms.uIntensity.value = val;
            const valEl = document.getElementById('val-atmos-int');
            if (valEl) valEl.textContent = val.toFixed(1);
        });

        document.getElementById('light-sun')?.addEventListener('input', (e) => {
            const val = Number(e.target.value);
            this.engine.solarSystem.sunLight.intensity = val;
            const valEl = document.getElementById('val-light-sun');
            if (valEl) valEl.textContent = val.toFixed(1);
        });

        document.getElementById('light-amb')?.addEventListener('input', (e) => {
            const val = Number(e.target.value);
            this.engine.solarSystem.ambientLight.intensity = val;
            const valEl = document.getElementById('val-light-amb');
            if (valEl) valEl.textContent = val.toFixed(2);
        });

        const timeOptions = [ { label: '||', val: 0 }, { label: 'x1/4', val: 0.25 }, { label: 'x1/2', val: 0.5 }, { label: 'x1', val: 1 }, { label: 'x2', val: 2 }, { label: 'x4', val: 4 }, { label: 'x8', val: 8 }, { label: 'x16', val: 16 } ];
        const timeContainer = document.getElementById('time-controls');
        let activeTimeBtn = null;
        if (timeContainer) {
            timeOptions.forEach(opt => {
                const btn = document.createElement('button');
                btn.textContent = opt.label;
                if (opt.val === 1) { btn.classList.add('active'); activeTimeBtn = btn; }
                btn.addEventListener('click', () => {
                    this.engine.state.timeMultiplier = opt.val;
                    if (activeTimeBtn) activeTimeBtn.classList.remove('active');
                    btn.classList.add('active'); activeTimeBtn = btn;
                });
                timeContainer.appendChild(btn);
            });
        }

        const focusIds = ['free', 'player', 'sun', 'planet', 'moon'];
        focusIds.forEach(id => {
            document.getElementById(`focus-${id}`)?.addEventListener('click', () => {
                this.setCameraFocusUI(id);
                this.engine.setCameraFocus(id);
            });
        });
    }
}