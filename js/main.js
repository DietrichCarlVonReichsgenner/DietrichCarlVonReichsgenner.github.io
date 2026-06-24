import * as THREE from 'three';
import { Renderer } from './graphics/Renderer.js';
import { CameraController } from './graphics/CameraController.js';
import { MaterialFactory } from './graphics/Materials.js';
import { SolarSystem } from './world/SolarSystem.js';
import { UIManager } from './ui/UIManager.js';
import { CONFIG } from './config.js';
import { ECS, Components } from './game/ECS.js';
import { clearNoiseCache } from './world/GeometryBuilder.js';
import { SelectionController } from './game/SelectionController.js';
import { EventEmitter } from './utils/EventEmitter.js';
import { BODY_TYPES } from './world/BodyRegistry.js';

// ─── SaveSystem ───────────────────────────────────────────────────────────────
// Отвечает исключительно за сериализацию/десериализацию состояния игры.
// Не знает о рендеринге, физике или UI-разметке.

class SaveSystem {
    constructor(engine) {
        this.engine = engine;
    }

    serialize() {
        const e = this.engine;
        return JSON.stringify({
            version: 1,
            state: e.state,
            player: {
                body:     e.playerEntity.PlayerControlled.currentBody,
                position: e.playerEntity.Transform.position.toArray(),
                forward:  e.playerEntity.Transform.forward.toArray()
            }
        });
    }

    async deserialize(json) {
        const e = this.engine;
        try {
            const data = JSON.parse(json);
            if (data.state) {
                Object.assign(e.state, data.state);
                e.ui.syncStateToUI();
            }

            e._isRestoringSave = true;
            await e.generateSystem();
            e._isRestoringSave = false;

            if (data.player) {
                const p = e.playerEntity;
                p.PlayerControlled.currentBody = data.player.body;
                p.Transform.position.fromArray(data.player.position);
                p.Transform.forward.fromArray(data.player.forward);
                p.Transform.up.copy(p.Transform.position).normalize();

                e.ecs.updatePhysicsForBody(p, data.player.body);
                e.ui.setCameraFocusUI('player');
                e.setCameraFocus('player');
            }

            e.ui.logToConsole('[SYS] Состояние успешно загружено.', 'log-sys');
        } catch (err) {
            console.error(err);
            e.ui.logToConsole('[ERR] Ошибка загрузки сохранения. Неверный формат JSON.', 'log-err');
        }
    }
}

// ─── CommandSystem ────────────────────────────────────────────────────────────
// Разбирает строки команд и делегирует выполнение engine/подсистемам.
// GameEngine не содержит switch-логику напрямую.

class CommandSystem {
    constructor(engine) {
        this.engine = engine;
        this._handlers = this._buildHandlers();
    }

    execute(cmdString) {
        const args = cmdString.trim().split(/\s+/);
        const cmd  = args[0].toLowerCase();
        const handler = this._handlers[cmd];
        if (handler) {
            handler(args);
        } else {
            this.engine.ui.logToConsole(`[WARN] Неизвестная команда: ${cmd}. Введите /help для справки.`, 'log-warn');
        }
    }

    _buildHandlers() {
        const e  = this.engine;
        const ui = () => e.ui;

        return {
            '/help': () => {
                ui().logToConsole('Доступные команды:', 'log-sys');
                [
                    '/help — Список команд',
                    '/clear — Очистить консоль',
                    '/seed [num] — Установить сид',
                    '/time [num] — Изменить скорость времени',
                    '/lod — Показать уровни детализации',
                    '/teleport — Переместиться на выбранный тайл',
                    '/spawn — Переместиться на высочайшую гору',
                    '/interceptor — Создать перехватчик рядом с игроком',
                    '/ping — Проверка отклика'
                ].forEach(line => ui().logToConsole(`  ${line}`, 'log-sys'));
            },

            '/clear': () => ui().clearConsole(),

            '/seed': (args) => {
                if (!args[1]) {
                    ui().logToConsole(`[SYS] Текущий сид: ${e.state.seed}`, 'log-sys');
                    return;
                }
                const newSeed = parseInt(args[1], 10);
                if (isNaN(newSeed)) {
                    ui().logToConsole('[ERR] Значение сида должно быть целым числом.', 'log-err');
                    return;
                }
                e.state.seed = newSeed;
                if (e.ui.setSeedValue) e.ui.setSeedValue(newSeed);
                e.generateSystem();
                ui().logToConsole(`[SYS] Сид изменен на ${newSeed}. Мир пересоздан.`, 'log-sys');
            },

            '/time': (args) => {
                if (!args[1]) {
                    ui().logToConsole(`[SYS] Текущий множитель: x${e.state.timeMultiplier}`, 'log-sys');
                    return;
                }
                const newTime = parseFloat(args[1]);
                if (isNaN(newTime)) {
                    ui().logToConsole('[ERR] Ожидается число (например, 1.5).', 'log-err');
                    return;
                }
                e.state.timeMultiplier = newTime;
                ui().logToConsole(`[SYS] Множитель времени установлен на: x${newTime}`, 'log-sys');
            },

            '/lod': () => {
                const l = e.lodLevels;
                ui().logToConsole(`[SYS] LOD — планета: ${l.planet}, луна: ${l.moon}, звезда: ${l.sun}`, 'log-sys');
            },

            '/teleport': () => e.selectionController.teleportPlayer(e.playerEntity),

            '/spawn': () => e.spawnPlayerAtHighestPoint(),

            '/ping': () => ui().logToConsole('Pong! Движок функционирует нормально.', 'log-sys'),

            '/interceptor': () => {
                const intGeo = new THREE.ConeGeometry(8, 30, 4);
                intGeo.rotateX(Math.PI / 2);
                intGeo.rotateZ(Math.PI / 4);

                const intMat = new THREE.MeshStandardMaterial({
                    color: 0x222222, metalness: 0.8, roughness: 0.2,
                    emissive: 0x223344, emissiveIntensity: 1.0
                });

                const intMesh = new THREE.Mesh(intGeo, intMat);
                intMesh.castShadow = intMesh.receiveShadow = true;

                const spawnPos = e.playerEntity.Transform.position.clone();
                const spawnDir = spawnPos.clone().normalize();
                const pForward = e.playerEntity.Transform.forward.clone();
                spawnPos.add(pForward.multiplyScalar(20)).add(spawnDir.multiplyScalar(10));

                const intEntity = e.ecs.createEntity({
                    Transform:  new Components.Transform(spawnPos),
                    Renderable: new Components.Renderable(intMesh),
                    Physics:    new Components.Physics(CONFIG.physics.planetGravity, 0),
                    Vehicle:    new Components.Vehicle()
                });

                intEntity.Vehicle.currentBody = e.playerEntity.PlayerControlled.currentBody;
                intEntity.Transform.up.copy(spawnDir);
                intEntity.Transform.forward.copy(pForward);

                const bDef = BODY_TYPES[intEntity.Vehicle.currentBody] ?? null;
                if (bDef) bDef.getGroup(e.solarSystem).add(intMesh);
                else e.solarSystem.planetGroup.add(intMesh);

                ui().logToConsole('[SYS] Перехватчик доставлен. Подойдите и нажмите F.', 'log-sys');
            }
        };
    }
}

// ─── GameEngine ───────────────────────────────────────────────────────────────
// Отвечает за: инициализацию подсистем, анимационный цикл, LOD-менеджмент,
// управление камерой и генерацию мира.
// Сериализация делегирована SaveSystem, команды — CommandSystem.

class GameEngine {
    constructor() {
        this.events = new EventEmitter();
        this._isRestoringSave  = false;
        this._generationPromise = null;

        this.state = {
            seed:             CONFIG.defaultSeed,
            timeMultiplier:   CONFIG.baseTimeMultiplier,
            waterLevel:       CONFIG.generation.waterLevel,
            continents:       CONFIG.generation.continents,
            islands:          CONFIG.generation.islands,
            elevationSpread:  CONFIG.generation.elevationSpread,
            globalTemp:       CONFIG.generation.globalTemp,
            globalMoisture:   CONFIG.generation.globalMoisture,
            cloudStandard:    CONFIG.generation.cloudStandard,
            cloudRain:        CONFIG.generation.cloudRain,
            cloudCirrus:      CONFIG.generation.cloudCirrus,
            cityCount:        CONFIG.generation.cityCount
        };

        this.clock        = new THREE.Clock();
        this.frameCount   = 0;
        this.lastFpsTime  = performance.now();
        this.isGenerating = false;
        this.abortController = null;

        this.scene  = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, CONFIG.camera.near, CONFIG.camera.far);

        const defFocus = CONFIG.camera.focusOffsets.planet;
        this.camera.position.set(defFocus.x, defFocus.y, defFocus.z);

        this.renderer         = new Renderer(this.scene, this.camera);
        this.cameraController = new CameraController(this.camera, this.renderer.webgl.domElement);
        this.materials        = new MaterialFactory();
        this.solarSystem      = new SolarSystem(this.scene, this.materials);
        this.ui               = new UIManager(this);
        this.config           = CONFIG;
        this.ecs              = new ECS(this);
        this.saveSystem       = new SaveSystem(this);
        this.commandSystem    = new CommandSystem(this);

        const playerMesh = new THREE.Mesh(
            new THREE.BoxGeometry(20, 20, 20),
            new THREE.MeshStandardMaterial({
                color: 0xff0000, roughness: 0.3, metalness: 0.8,
                emissive: 0xaa0000, emissiveIntensity: 0.8
            })
        );
        playerMesh.castShadow = playerMesh.receiveShadow = true;

        this.playerEntity = this.ecs.createEntity({
            Transform:       new Components.Transform(new THREE.Vector3(1, 0, 0)),
            Renderable:      new Components.Renderable(playerMesh),
            PlayerControlled: new Components.PlayerControlled(800),
            Physics:         new Components.Physics(CONFIG.physics.planetGravity, CONFIG.physics.planetJumpSpeed)
        });

        this.lodLevels = { planet: -1, moon: -1, sun: -1 };
        this._surfaceTargets      = [];
        this._solidTerrainTargets = [];

        this.selectionController = new SelectionController(this);
        this.angleSun  = 0;
        this.angleMoon = 0;

        window.addEventListener('resize', () => this.renderer.resize(this.camera));

        this.events.on('world:generated', (data) => {
            console.log(`[Event] World generated with seed: ${data.seed}`);
        });

        this.generateSystem();
        this.animate();
    }

    // ─── Публичные делегаты (сохраняют внешний API) ───────────────────────────

    serialize()              { return this.saveSystem.serialize(); }
    deserialize(json)        { return this.saveSystem.deserialize(json); }
    executeCommand(cmdStr)   { this.commandSystem.execute(cmdStr); }

    // ─── Спавн игрока ─────────────────────────────────────────────────────────

    spawnPlayerAtHighestPoint() {
        let maxElev = 0;
        let bestPos = new THREE.Vector3(0, CONFIG.radius.planet, 0);
        let found   = false;

        for (const mesh of this.solarSystem.allSolidMeshes) {
            if (mesh.material === this.materials.planetMatte || mesh.material === this.materials.planetIce) {
                const posAttr = mesh.geometry.attributes.position;
                if (posAttr) {
                    const v = new THREE.Vector3();
                    for (let i = 0; i < posAttr.count; i += 3) {
                        v.fromBufferAttribute(posAttr, i);
                        const dist = v.length();
                        if (dist > maxElev) { maxElev = dist; bestPos.copy(v); }
                    }
                    found = true;
                }
            }
        }

        const dir         = found ? bestPos.clone().normalize() : new THREE.Vector3(0, 1, 0);
        const finalHeight = found ? maxElev : CONFIG.radius.planet;

        this.playerEntity.PlayerControlled.currentBody = 'planet';
        this.playerEntity.Transform.up.copy(dir);
        this.playerEntity.Transform.position.copy(dir)
            .multiplyScalar(finalHeight + CONFIG.physics.spawnDropHeight);

        let newForward = new THREE.Vector3(0, 1, 0);
        if (Math.abs(dir.y) > 0.99) newForward.set(1, 0, 0);
        newForward.sub(dir.clone().multiplyScalar(newForward.dot(dir))).normalize();
        this.playerEntity.Transform.forward.copy(newForward);

        this.playerEntity.Physics.velocity.set(0, 0, 0);
        this.ecs.updatePhysicsForBody(this.playerEntity, 'planet');

        if (this.cameraController.mode === 'player') this.setCameraFocus('player');

        this.ui.logToConsole('[SYS] Игрок десантирован на координатах высочайшего пика.', 'log-sys');
    }

    // ─── Кэш поверхностей ─────────────────────────────────────────────────────

    updateSurfaceTargetsCache() {
        this._surfaceTargets = this.solarSystem.allSolidMeshes.filter(m => {
            const isVisible = m.visible && m.parent?.visible;
            const isSurface = [
                this.materials.planetMatte, this.materials.planetIce,
                this.materials.planetSeaIce, this.materials.planetWater,
                this.materials.moonSolid, this.materials.sunSolid
            ].includes(m.material);
            return isVisible && isSurface;
        });
        this._solidTerrainTargets = this._surfaceTargets.filter(
            m => m.material !== this.materials.planetWater
        );
    }

    // ─── Генерация мира ───────────────────────────────────────────────────────

    async generateSystem() {
        if (this._generationPromise && this.abortController) {
            this.abortController.abort();
            try { await this._generationPromise; } catch {}
        }

        clearNoiseCache();
        this.abortController = new AbortController();
        this.isGenerating    = true;
        this.ui.showLoadingIndicator(true);
        this.selectionController.resetHighlightParent();

        this._generationPromise = (async () => {
            try {
                await this.solarSystem.generate(this.state, (body, progress) => {
                    if (!this.abortController.signal.aborted)
                        this.ui.updateLoadingProgress(body, progress);
                }, this.abortController.signal);

                const vis = this.ui.getVisibilitySettings();
                this.solarSystem.setVisibility(vis.solid, vis.wire, vis.atmos);

                this.updateSurfaceTargetsCache();
                this.ui.logToConsole('[SYS] Генерация мира завершена.', 'log-sys');

                if (!this._isRestoringSave) this.spawnPlayerAtHighestPoint();

                this.events.emit('world:generated', { seed: this.state.seed });

            } catch (err) {
                if (err.message === 'aborted') {
                    this.ui.logToConsole('[SYS] Генерация мира отменена.', 'log-warn');
                } else {
                    console.error(err);
                    this.ui.logToConsole('[ERR] Ошибка при генерации мира.', 'log-err');
                }
            } finally {
                this.isGenerating    = false;
                this.abortController = null;
                this._generationPromise = null;
                this.ui.showLoadingIndicator(false);
            }
        })();

        return this._generationPromise;
    }

    // ─── Камера ───────────────────────────────────────────────────────────────

    setCameraFocus(mode) {
        const off = CONFIG.camera.focusOffsets;
        const camCfg = CONFIG.physics.camera;

        if (mode === 'sun') {
            this.cameraController.setFocus('sun', this.solarSystem.sunGroup,
                new THREE.Vector3(off.sun.x, off.sun.y, off.sun.z));
        } else if (mode === 'planet') {
            this.cameraController.setFocus('planet', this.solarSystem.planetGroup,
                new THREE.Vector3(off.planet.x, off.planet.y, off.planet.z));
        } else if (mode === 'moon') {
            this.cameraController.setFocus('moon', this.solarSystem.moonGroup,
                new THREE.Vector3(off.moon.x, off.moon.y, off.moon.z));
        } else if (mode === 'player') {
            const mesh     = this.playerEntity.Renderable.mesh;
            const worldPos = new THREE.Vector3(); mesh.getWorldPosition(worldPos);
            const worldQuat = new THREE.Quaternion(); mesh.getWorldQuaternion(worldQuat);
            const up      = new THREE.Vector3(0, 1, 0).applyQuaternion(worldQuat).normalize();
            const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(worldQuat).normalize();
            const offset  = up.clone().multiplyScalar(camCfg.playerFollowUp)
                              .add(forward.clone().multiplyScalar(-camCfg.playerFollowBack));
            this.cameraController.setFocus('player',
                worldPos.clone().add(up.clone().multiplyScalar(20)), offset);
        } else {
            this.cameraController.mode = 'free';
        }
    }

    // ─── Анимационный цикл ────────────────────────────────────────────────────

    animate() {
        requestAnimationFrame(() => this.animate());
        const delta    = this.clock.getDelta();
        const simDelta = delta * this.state.timeMultiplier;

        this.ecs.update(delta);
        this.materials.updateTime(this.clock.getElapsedTime());

        // Орбиты
        this.angleSun += CONFIG.physics.orbitSpeedSun * simDelta;
        this.solarSystem.sunGroup.position.set(
            Math.cos(this.angleSun) * CONFIG.physics.orbitRadiusSun,
            0,
            Math.sin(this.angleSun) * CONFIG.physics.orbitRadiusSun
        );
        this.materials.updateSunPosition(this.solarSystem.sunGroup.position);

        const sunDir = this.solarSystem.sunGroup.position.clone().normalize();
        this.solarSystem.sunLight.position.copy(sunDir.multiplyScalar(CONFIG.radius.planet * 4.0));

        this.angleMoon += CONFIG.physics.orbitSpeedMoon * simDelta;
        this.solarSystem.moonGroup.position.set(
            Math.cos(this.angleMoon) * CONFIG.physics.orbitRadiusMoon,
            0,
            Math.sin(this.angleMoon) * CONFIG.physics.orbitRadiusMoon
        );

        const moonDir = this.solarSystem.moonGroup.position.clone().normalize();
        this.solarSystem.moonLight.position.copy(moonDir.multiplyScalar(CONFIG.radius.planet * 4.0));

        this.solarSystem.update(simDelta, this.camera, this.playerEntity.Transform.position, this.state);

        // LOD-отслеживание
        const pLevel = this.solarSystem.planetLOD?.getCurrentLevel() ?? -1;
        const mLevel = this.solarSystem.moonLOD?.getCurrentLevel()   ?? -1;
        const sLevel = this.solarSystem.sunLOD?.getCurrentLevel()    ?? -1;

        const lodChanged =
            pLevel !== this.lodLevels.planet ||
            mLevel !== this.lodLevels.moon   ||
            sLevel !== this.lodLevels.sun;

        if (lodChanged) {
            this.lodLevels.planet = pLevel;
            this.lodLevels.moon   = mLevel;
            this.lodLevels.sun    = sLevel;
            this.updateSurfaceTargetsCache();
            if (this.selectionController.highlightMesh.visible)
                this.selectionController.updateHighlight();
        }

        // Следование камеры
        const currentTargetPosition = new THREE.Vector3();
        const mode = this.cameraController.mode;
        if (mode === 'sun') {
            currentTargetPosition.copy(this.solarSystem.sunGroup.position);
        } else if (mode === 'moon') {
            currentTargetPosition.copy(this.solarSystem.moonGroup.position);
        } else if (mode === 'player') {
            const body = this.playerEntity.PlayerControlled.currentBody;
            if (body === 'sun')       currentTargetPosition.copy(this.solarSystem.sunGroup.position);
            else if (body === 'moon') currentTargetPosition.copy(this.solarSystem.moonGroup.position);
        }

        this.cameraController.updateTracking(currentTargetPosition, this.playerEntity, this.state);
        this.renderer.render();

        // FPS-счётчик
        this.frameCount++;
        const now = performance.now();
        if (now - this.lastFpsTime >= 500) {
            const fpsEl = document.getElementById('hud-fps');
            if (fpsEl) fpsEl.textContent = Math.round((this.frameCount * 1000) / (now - this.lastFpsTime));
            const trisEl = document.getElementById('hud-tris');
            if (trisEl) trisEl.textContent = this.renderer.webgl.info.render.triangles.toLocaleString('ru-RU');
            this.frameCount  = 0;
            this.lastFpsTime = now;
        }
    }
}

new GameEngine();
