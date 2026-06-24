import * as THREE from 'three';
import { getElevationAt, computeWaterOffset } from '../world/GeometryBuilder.js';
import { CONFIG } from '../config.js';
import { BODY_TYPES } from '../world/BodyRegistry.js';

// ─── Компоненты ───────────────────────────────────────────────────────────────

export const Components = {
    Transform: class {
        constructor(pos = new THREE.Vector3(0, 1, 0)) {
            this.position = pos;
            this.forward  = new THREE.Vector3(0, 0, 1);
            this.up       = pos.clone().normalize();
        }
    },
    Renderable: class {
        constructor(mesh) { this.mesh = mesh; }
    },
    PlayerControlled: class {
        constructor(speed = 400) {
            this.speed       = speed;
            this.currentBody = 'planet';
        }
    },
    Vehicle: class {
        constructor() {
            this.thrust      = 0;
            this.maxThrust   = CONFIG.physics.vehicle.maxThrust;
            this.pilot       = null;
            this.currentBody = 'planet';
        }
    },
    Physics: class {
        constructor(gravity, jumpSpeed) {
            this.velocity      = new THREE.Vector3();
            this.isGrounded    = false;
            this.isUnderwater  = false;
            this.gravity       = gravity;
            this.jumpSpeed     = jumpSpeed;
            this.stepHeight    = CONFIG.physics.player.stepHeight;
            this.waterDrag     = CONFIG.physics.player.waterDrag;
            this.waterBuoyancy = CONFIG.physics.player.waterBuoyancy;
            this.visualHeight  = undefined;
        }
    }
};

// ─── Вспомогательные утилиты ──────────────────────────────────────────────────

/** Возвращает конфиг тела и параметры поверхности для сущности. */
function resolveBodyContext(entity, engine) {
    const bodyName = entity.PlayerControlled
        ? entity.PlayerControlled.currentBody
        : (entity.Vehicle?.currentBody ?? 'planet');

    const bodyDef = BODY_TYPES[bodyName];
    if (!bodyDef) return null;

    const radius   = bodyDef.radius(CONFIG);
    const isMoon   = bodyDef.isMoon;
    const seed     = bodyDef.getSeed(engine.state);
    const hasWater = bodyDef.hasWater;
    const waterOffset = hasWater
        ? computeWaterOffset(radius, engine.state.waterLevel ?? 0.4)
        : 0;

    return { bodyName, bodyDef, radius, isMoon, seed, hasWater, waterOffset };
}

// ─── ECS ──────────────────────────────────────────────────────────────────────

export class ECS {
    constructor(engine) {
        this.engine   = engine;
        this.entities = [];
        this.keys     = { w: false, a: false, s: false, d: false, space: false, control: false, q: false, e: false, f: false };
        this._fPressed = false;

        // Переиспользуемые THREE-объекты (избегаем аллокаций в hot path)
        this._tempVec      = new THREE.Vector3();
        this._right        = new THREE.Vector3();
        this._renderMatrix = new THREE.Matrix4();
        this._renderRight  = new THREE.Vector3();
        this._nextEntityId = 0;

        window.addEventListener('keydown', e => {
            if (e.target.tagName.toLowerCase() === 'input') return;
            const k = e.key.toLowerCase();
            if (k in this.keys) this.keys[k] = true;
            if (k === ' ') { e.preventDefault(); this.keys.space = true; }
            if (k === 'control') this.keys.control = true;
        });

        window.addEventListener('keyup', e => {
            if (e.target.tagName.toLowerCase() === 'input') return;
            const k = e.key.toLowerCase();
            if (k in this.keys) this.keys[k] = false;
            if (k === ' ') this.keys.space = false;
            if (k === 'control') this.keys.control = false;
        });
    }

    createEntity(components) {
        const entity = { id: ++this._nextEntityId, ...components };
        this.entities.push(entity);
        return entity;
    }

    getSurfaceData(dir, bodyConfig) {
        const { radius, isMoon, seed, hasWater, waterOffset } = bodyConfig;
        const terrainHeight = seed !== null
            ? getElevationAt(dir, radius, isMoon, seed, this.engine.state)
            : radius;
        const waterHeight = hasWater ? radius + waterOffset : -Infinity;
        return { terrainHeight, waterHeight };
    }

    getActualTerrainHeight(tr, bodyDef, fallbackHeight) {
        if (!this.engine._solidTerrainTargets?.length) return fallbackHeight;
        if (!this._raycaster) this._raycaster = new THREE.Raycaster();

        const group = bodyDef.getGroup(this.engine.solarSystem);
        if (!group) return fallbackHeight;

        const worldPos    = tr.position.clone().applyMatrix4(group.matrixWorld);
        const originPoint = new THREE.Vector3().applyMatrix4(group.matrixWorld);
        const worldDir    = worldPos.clone().sub(originPoint).normalize();

        const maxRadius = bodyDef.radius(CONFIG) * 2.0;
        const rayOrigin = originPoint.clone().add(worldDir.clone().multiplyScalar(maxRadius));
        this._raycaster.set(rayOrigin, worldDir.clone().negate());

        const hits = this._raycaster.intersectObjects(this.engine._solidTerrainTargets, false);
        for (const hit of hits) {
            let parent = hit.object.parent;
            while (parent && parent !== group && parent.parent) parent = parent.parent;
            if (parent === group) return group.worldToLocal(hit.point.clone()).length();
        }
        return fallbackHeight;
    }

    updatePhysicsForBody(entity, bodyName) {
        const physCfg = BODY_TYPES[bodyName].physics(CONFIG);
        entity.Physics.gravity   = physCfg.gravity;
        entity.Physics.jumpSpeed = physCfg.jumpSpeed;
    }

    // ─── Главный цикл ──────────────────────────────────────────────────────────

    update(delta) {
        delta = Math.min(delta, 0.033);
        this._runInputSystem(delta);
        this._runPhysicsSystem(delta);
        this._runRenderSyncSystem();
    }

    // ─── InputSystem ───────────────────────────────────────────────────────────
    // Обрабатывает посадку/высадку из транспорта (клавиша F).
    // Не трогает физику — только перемещает компонент PlayerControlled.

    _runInputSystem(_delta) {
        if (!this.keys.f) { this._fPressed = false; return; }
        if (this._fPressed) return;
        this._fPressed = true;

        const walkingPlayer = this.entities.find(e => e.PlayerControlled && !e.Vehicle);
        const flyingPlayer  = this.entities.find(e => e.PlayerControlled && e.Vehicle);

        if (walkingPlayer) {
            const emptyVehicle = this.entities.find(e => e.Vehicle && !e.Vehicle.pilot);
            const inRange = emptyVehicle &&
                walkingPlayer.Transform.position.distanceTo(emptyVehicle.Transform.position)
                    < CONFIG.physics.vehicle.boardingRadius;

            if (inRange) {
                emptyVehicle.Vehicle.pilot       = walkingPlayer;
                emptyVehicle.PlayerControlled    = walkingPlayer.PlayerControlled;
                delete walkingPlayer.PlayerControlled;
                walkingPlayer.Renderable.mesh.visible = false;

                if (!emptyVehicle.Physics.velocity3D)
                    emptyVehicle.Physics.velocity3D = new THREE.Vector3();

                this.engine.playerEntity = emptyVehicle;
                this.engine.ui.logToConsole(
                    '[SYS] Перехватчик: Системы запущены. Пробел - тангаж вверх, Ctrl - тангаж вниз, W/S - тяга, A/D - крен, Q/E - рысканье.',
                    'log-sys'
                );
            }

        } else if (flyingPlayer) {
            const pilot = flyingPlayer.Vehicle.pilot;
            pilot.PlayerControlled    = flyingPlayer.PlayerControlled;
            delete flyingPlayer.PlayerControlled;

            pilot.Transform.position.copy(flyingPlayer.Transform.position)
                .add(flyingPlayer.Transform.up.clone().multiplyScalar(30));
            pilot.Transform.up.copy(flyingPlayer.Transform.position).normalize();
            pilot.Transform.forward.copy(flyingPlayer.Transform.forward);

            pilot.Renderable.mesh.visible = true;
            pilot.Physics.velocity.set(0, 0, 0);
            flyingPlayer.Vehicle.pilot  = null;
            flyingPlayer.Vehicle.thrust = 0;

            this.engine.playerEntity = pilot;
            this.engine.ui.logToConsole('[SYS] Перехватчик: Пилот покинул кабину.', 'log-sys');
        }
    }

    // ─── PhysicsSystem ─────────────────────────────────────────────────────────
    // Единственное место, где обновляются Transform и Physics.
    // Внутри делегирует в VehicleSystem или WalkerSystem по типу сущности.

    _runPhysicsSystem(delta) {
        for (const e of this.entities) {
            if (!e.Transform || !e.Physics) continue;

            const isWalkingPlayer = !!e.PlayerControlled && !e.Vehicle;
            const isVehicle       = !!e.Vehicle;
            if (!isWalkingPlayer && !isVehicle) continue;

            const ctx = resolveBodyContext(e, this.engine);
            if (!ctx) continue;

            const bodyConfig = {
                radius:      ctx.radius,
                isMoon:      ctx.isMoon,
                seed:        ctx.seed,
                hasWater:    ctx.hasWater,
                waterOffset: ctx.waterOffset
            };

            const dir = e.Transform.position.clone().normalize();
            const { terrainHeight, waterHeight } = this.getSurfaceData(dir, bodyConfig);

            if (isWalkingPlayer) {
                this._updateWalker(e, delta, dir, terrainHeight, waterHeight, ctx.bodyDef, bodyConfig);
            } else {
                this._updateVehicle(e, delta, dir, terrainHeight, waterHeight, ctx.hasWater);
            }
        }
    }

    // ─── WalkerSystem ──────────────────────────────────────────────────────────

    _updateWalker(e, delta, dir, terrainHeight, waterHeight, bodyDef, bodyConfig) {
        const tr   = e.Transform;
        const phys = e.Physics;
        const speed  = e.PlayerControlled.speed;
        const radius = bodyDef.radius(CONFIG);

        // Кэш высоты рельефа — обновляем только при движении
        if (!e._lastPosition) e._lastPosition = new THREE.Vector3();
        const hasMoved = e._lastPosition.distanceToSquared(tr.position) > 0.01;
        if (hasMoved || phys.visualHeight === undefined) {
            phys.visualHeight = this.getActualTerrainHeight(tr, bodyDef, terrainHeight);
            e._lastPosition.copy(tr.position);
        }

        const visualTerrainHeight = phys.visualHeight;
        const currentAltitude     = tr.position.length();

        phys.isUnderwater = bodyConfig.hasWater && (currentAltitude < waterHeight);

        // Вертикальная физика
        if (phys.isUnderwater) {
            phys.velocity.y += (phys.waterBuoyancy - phys.gravity * 0.7) * delta;
            phys.velocity.multiplyScalar(phys.waterDrag);
        } else {
            phys.velocity.y -= phys.gravity * delta;
        }

        const distToGround = currentAltitude - visualTerrainHeight;
        if (distToGround < -1.0) {
            tr.position.copy(dir).multiplyScalar(visualTerrainHeight + CONFIG.physics.player.collisionRadius);
            if (phys.velocity.y < 0) phys.velocity.y = 0;
            phys.isGrounded = true;
        } else {
            phys.isGrounded = !phys.isUnderwater && distToGround <= CONFIG.physics.player.collisionRadius;
            if (phys.isGrounded && phys.velocity.y < 0) {
                phys.velocity.y = 0;
                if (distToGround < 1.0)
                    tr.position.copy(dir).multiplyScalar(visualTerrainHeight + CONFIG.physics.player.collisionRadius);
            }
        }

        // Прыжок
        if (this.keys.space && phys.isGrounded && !phys.isUnderwater && phys.jumpSpeed > 0) {
            phys.velocity.y = phys.jumpSpeed;
            phys.isGrounded = false;
            this.keys.space = false;
        }

        // Поворот
        const turnSpeed = 2.5 * delta;
        if (this.keys.a) tr.forward.applyAxisAngle(tr.up,  turnSpeed);
        if (this.keys.d) tr.forward.applyAxisAngle(tr.up, -turnSpeed);
        tr.forward.normalize();

        // Горизонтальное движение
        const moveSpeed    = phys.isUnderwater ? speed * 0.6 : speed;
        const angularSpeed = (moveSpeed * delta) / radius;
        let moveDir = 0;
        if (this.keys.w) moveDir += 1;
        if (this.keys.s) moveDir -= 1;

        let positionChanged = false;

        if (moveDir !== 0) {
            const direction     = moveDir > 0 ? tr.forward : tr.forward.clone().negate();
            const rotationAxis  = this._tempVec.crossVectors(tr.up, direction).normalize();
            tr.position.applyAxisAngle(rotationAxis, angularSpeed * Math.abs(moveDir));
            tr.up.copy(tr.position).normalize();
            tr.forward.sub(tr.up.clone().multiplyScalar(tr.forward.dot(tr.up))).normalize();
            positionChanged = true;
        }

        if (phys.velocity.y !== 0) {
            tr.position.add(tr.up.clone().multiplyScalar(phys.velocity.y * delta));
            tr.up.copy(tr.position).normalize();
            tr.forward.sub(tr.up.clone().multiplyScalar(tr.forward.dot(tr.up))).normalize();
            positionChanged = true;
        }

        // Финальная коррекция позиции
        const finalDir = positionChanged ? tr.position.clone().normalize() : dir;
        let finalVisualHeight = visualTerrainHeight;

        if (positionChanged) {
            const finalMathHeight = this.getSurfaceData(finalDir, bodyConfig).terrainHeight;
            finalVisualHeight     = this.getActualTerrainHeight(tr, bodyDef, finalMathHeight);
            phys.visualHeight     = finalVisualHeight;
        }

        const finalAlt    = tr.position.length();
        const minGroundAlt = finalVisualHeight + CONFIG.physics.player.collisionRadius;

        if (finalAlt < minGroundAlt) {
            tr.position.add(finalDir.clone().multiplyScalar(minGroundAlt - finalAlt));
            phys.velocity.y = 0;
            phys.isGrounded = true;
            tr.up.copy(tr.position).normalize();
            tr.forward.sub(tr.up.clone().multiplyScalar(tr.forward.dot(tr.up))).normalize();
        }

        if (bodyConfig.hasWater && finalAlt < waterHeight) {
            const maxDepth = waterHeight - 200;
            if (finalAlt < maxDepth)
                tr.position.copy(finalDir).multiplyScalar(maxDepth);
        }

        this.engine.ui.updatePlayerStats(tr, finalAlt - finalVisualHeight);
    }

    // ─── VehicleSystem ─────────────────────────────────────────────────────────

    _updateVehicle(e, delta, dir, terrainHeight, waterHeight, hasWater) {
        const tr   = e.Transform;
        const phys = e.Physics;
        const v    = e.Vehicle;
        const vc   = CONFIG.physics.vehicle;

        if (!phys.velocity3D) phys.velocity3D = new THREE.Vector3();

        if (e.PlayerControlled) {
            // Управление тягой
            if (this.keys.w) v.thrust = Math.min(v.thrust + vc.thrustAcceleration * delta, vc.maxThrust);
            if (this.keys.s) v.thrust = Math.max(v.thrust - vc.thrustAcceleration * delta, 0);

            const right = new THREE.Vector3().crossVectors(tr.up, tr.forward).normalize();

            // Тангаж
            let pitch = 0;
            if (this.keys.space)   pitch -= vc.pitchRate * delta;
            if (this.keys.control) pitch += vc.pitchRate * delta;
            if (pitch !== 0) {
                tr.forward.applyAxisAngle(right, pitch);
                tr.up.applyAxisAngle(right, pitch);
            }

            // Рысканье
            let yaw = 0;
            if (this.keys.q) yaw += vc.yawRate * delta;
            if (this.keys.e) yaw -= vc.yawRate * delta;
            if (yaw !== 0) {
                tr.forward.applyAxisAngle(tr.up, yaw);
                right.crossVectors(tr.up, tr.forward).normalize();
            }

            // Крен
            let roll = 0;
            if (this.keys.a) roll -= vc.rollRate * delta;
            if (this.keys.d) roll += vc.rollRate * delta;
            if (roll !== 0) tr.up.applyAxisAngle(tr.forward, roll);

            tr.forward.normalize();
            tr.up.normalize();
            v.currentBody = e.PlayerControlled.currentBody;

        } else {
            // Глушение двигателя при пустой кабине
            v.thrust = Math.max(0, v.thrust - vc.thrustAcceleration * delta);
        }

        // Инертная 6-DOF физика
        phys.velocity3D.add(tr.forward.clone().multiplyScalar(v.thrust * delta));     // Тяга
        phys.velocity3D.add(dir.clone().multiplyScalar(-phys.gravity * delta));        // Гравитация
        phys.velocity3D.multiplyScalar(vc.atmosphericDrag);                            // Сопротивление

        tr.position.add(phys.velocity3D.clone().multiplyScalar(delta));

        // Кэш высоты рельефа
        if (!e._lastPosition) e._lastPosition = new THREE.Vector3();
        if (e._lastPosition.distanceToSquared(tr.position) > 0.01 || phys.visualHeight === undefined) {
            const bodyDef = BODY_TYPES[v.currentBody];
            if (bodyDef) phys.visualHeight = this.getActualTerrainHeight(tr, bodyDef, terrainHeight);
            e._lastPosition.copy(tr.position);
        }

        const visualTerrainHeight = phys.visualHeight ?? terrainHeight;
        const finalAlt            = tr.position.length();
        const colRadius           = vc.collisionRadius;

        // Коллизия с рельефом
        if (finalAlt < visualTerrainHeight + colRadius) {
            tr.position.copy(dir).multiplyScalar(visualTerrainHeight + colRadius);
            const velIntoGround = phys.velocity3D.dot(dir);
            if (velIntoGround < 0) {
                phys.velocity3D.sub(dir.clone().multiplyScalar(velIntoGround));
                phys.velocity3D.multiplyScalar(vc.groundFriction);
            }
        } else if (hasWater && finalAlt < waterHeight + colRadius) {
            tr.position.copy(dir).multiplyScalar(waterHeight + colRadius);
            const velIntoWater = phys.velocity3D.dot(dir);
            if (velIntoWater < 0) {
                phys.velocity3D.sub(dir.clone().multiplyScalar(velIntoWater));
                phys.velocity3D.multiplyScalar(vc.waterFriction);
            }
        }

        if (e.PlayerControlled) {
            this.engine.ui.updatePlayerStats(tr, finalAlt - visualTerrainHeight);
        }
    }

    // ─── RenderSyncSystem ──────────────────────────────────────────────────────
    // Синхронизирует Three.js-меши с данными Transform.
    // Запускается строго после всех физических систем.

    _runRenderSyncSystem() {
        for (const e of this.entities) {
            if (!e.Transform || !e.Renderable) continue;

            // Поддержание иерархии сцены для наследования орбит
            if (e.PlayerControlled) {
                const bodyDef = BODY_TYPES[e.PlayerControlled.currentBody];
                if (bodyDef) {
                    const targetGroup = bodyDef.getGroup(this.engine.solarSystem);
                    if (targetGroup && e.Renderable.mesh.parent !== targetGroup)
                        targetGroup.add(e.Renderable.mesh);
                }
            }

            e.Renderable.mesh.position.copy(e.Transform.position);
            this._renderRight.crossVectors(e.Transform.up, e.Transform.forward).normalize();
            this._renderMatrix.makeBasis(this._renderRight, e.Transform.up, e.Transform.forward);
            e.Renderable.mesh.quaternion.setFromRotationMatrix(this._renderMatrix);
        }
    }
}
