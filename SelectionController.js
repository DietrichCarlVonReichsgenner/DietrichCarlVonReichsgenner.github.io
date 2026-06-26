import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { BODY_TYPES } from '../world/BodyRegistry.js';
import { getElevationAt } from '../world/GeometryBuilder.js';

export class SelectionController {
    constructor(engine) {
        this.engine = engine;
        this.selectedDirection = null;
        this.selectedGroup = null;
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        
        this.highlightMesh = new THREE.LineSegments(
            new THREE.BufferGeometry(),
            new THREE.LineBasicMaterial({ depthTest: true, transparent: true, opacity: 1.0 })
        );
        this.highlightMesh.renderOrder = 999;
        this.highlightMesh.frustumCulled = false;
        this.engine.scene.add(this.highlightMesh);

        this._onContextMenu = this._onContextMenu.bind(this);
        window.addEventListener('contextmenu', this._onContextMenu);
    }

    _onContextMenu(e) {
        e.preventDefault(); 
        this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
        
        this.raycaster.setFromCamera(this.mouse, this.engine.camera);
        const intersects = this.raycaster.intersectObjects(this.engine._surfaceTargets, false);

        if (intersects.length > 0) {
            const hit = intersects[0];
            let group = hit.object.parent;
            
            while (group && group !== this.engine.solarSystem.planetGroup && group !== this.engine.solarSystem.moonGroup && group !== this.engine.solarSystem.sunGroup) {
                group = group.parent;
            }

            const localPt = group.worldToLocal(hit.point.clone());
            const localNorm = hit.face.normal.clone();
            let probeDir = localPt.clone().normalize();
            
            if (localNorm.dot(probeDir) < 0.5) {
                let shiftRadius = group === this.engine.solarSystem.moonGroup ? CONFIG.radius.moon * 0.02 : CONFIG.radius.planet * 0.02;
                const inwardShift = localNorm.clone().multiplyScalar(-shiftRadius);
                probeDir = localPt.clone().add(inwardShift).normalize();
            }

            this.selectedDirection = probeDir;
            this.selectedGroup = group;
            this.updateHighlight();
        } else {
            this.clearSelection();
        }
    }

    updateHighlight() {
        if (!this.selectedDirection || !this.selectedGroup) return;

        let maxRad = this.selectedGroup === this.engine.solarSystem.sunGroup ? CONFIG.radius.sun * 2 : CONFIG.radius.planet * 2;
        const worldDir = this.selectedDirection.clone().applyQuaternion(this.selectedGroup.quaternion).normalize();
        const rayOrigin = this.selectedGroup.position.clone().add(worldDir.clone().multiplyScalar(maxRad));
        const rayDir = worldDir.clone().negate();
        
        this.raycaster.set(rayOrigin, rayDir);
        const intersects = this.raycaster.intersectObjects(this.engine._surfaceTargets, false);
        
        let topHit = null;
        for (let hit of intersects) {
            const hitLocalNorm = hit.face.normal.clone();
            const hitLocalPt = this.selectedGroup.worldToLocal(hit.point.clone()).normalize();
            if (hitLocalNorm.dot(hitLocalPt) > 0.5) { topHit = hit; break; }
        }

        if (topHit) {
            const pos = topHit.object.geometry.attributes.position;
            const vA = new THREE.Vector3().fromBufferAttribute(pos, topHit.face.a).multiplyScalar(1.0005);
            const vB = new THREE.Vector3().fromBufferAttribute(pos, topHit.face.b).multiplyScalar(1.0005);
            const vC = new THREE.Vector3().fromBufferAttribute(pos, topHit.face.c).multiplyScalar(1.0005);
            
            const edges = new Float32Array([
                vA.x, vA.y, vA.z, vB.x, vB.y, vB.z,
                vB.x, vB.y, vB.z, vC.x, vC.y, vC.z,
                vC.x, vC.y, vC.z, vA.x, vA.y, vA.z
            ]);
            
            this.highlightMesh.geometry.setAttribute('position', new THREE.BufferAttribute(edges, 3));
            this.highlightMesh.geometry.computeBoundingSphere(); 
            
            if (this.highlightMesh.parent !== this.selectedGroup) {
                this.selectedGroup.add(this.highlightMesh);
            }
            
            this.highlightMesh.position.set(0, 0, 0);
            this.highlightMesh.rotation.set(0, 0, 0);
            this.highlightMesh.scale.set(1, 1, 1);
            this.highlightMesh.visible = true;

            const { targetName, colorHex } = this._getTargetInfo(this.selectedGroup);
            this.highlightMesh.material.color.setHex(colorHex).multiplyScalar(5.0);

            const lat = Math.asin(this.selectedDirection.y) * (180 / Math.PI);
            const lon = Math.atan2(this.selectedDirection.z, this.selectedDirection.x) * (180 / Math.PI);
            this.engine.ui.showTargetCoords(targetName, lat, lon);
        }
    }

    _getTargetInfo(group) {
        if (group === this.engine.solarSystem.sunGroup) return { bodyName: 'sun', targetName: 'Солнце', colorHex: 0xffaa00 };
        if (group === this.engine.solarSystem.moonGroup) return { bodyName: 'moon', targetName: 'Луна', colorHex: 0xffffff };
        return { bodyName: 'planet', targetName: 'Планета', colorHex: 0x00aaff };
    }

    teleportPlayer(playerEntity) {
        if (!this.selectedDirection || !this.selectedGroup) {
            this.engine.ui.logToConsole('[ERR] Ошибка: тайл не выбран. Кликните ПКМ по поверхности.', 'log-err');
            return;
        }

        const info = this._getTargetInfo(this.selectedGroup);
        const bodyDef = BODY_TYPES[info.bodyName];
        const radius = bodyDef.radius(CONFIG);
        const seed = bodyDef.getSeed(this.engine.state);

        this.selectedGroup.add(playerEntity.Renderable.mesh);
        playerEntity.PlayerControlled.currentBody = info.bodyName;
        
        playerEntity.Transform.up.copy(this.selectedDirection);
        playerEntity.Transform.position.copy(this.selectedDirection);
        
        let newForward = new THREE.Vector3(0, 1, 0);
        if (Math.abs(this.selectedDirection.y) > 0.99) newForward.set(1, 0, 0);
        newForward.sub(this.selectedDirection.clone().multiplyScalar(newForward.dot(this.selectedDirection))).normalize();
        playerEntity.Transform.forward.copy(newForward);

        let terrainHeight = radius;
        if (seed !== null) {
            terrainHeight = getElevationAt(this.selectedDirection, radius, bodyDef.isMoon, seed, this.engine.state);
        }
        playerEntity.Transform.position.copy(this.selectedDirection).multiplyScalar(terrainHeight + 10);
        
        this.engine.ecs.updatePhysicsForBody(playerEntity, info.bodyName);
        this.engine.ui.logToConsole(`[SYS] Игрок телепортирован на объект: ${info.targetName}. Высота над поверхностью: ${Math.round(terrainHeight - radius)} м`, 'log-sys');
        
        this.engine.ui.setCameraFocusUI('player');
        this.engine.setCameraFocus('player');
    }

    clearSelection() {
        this.selectedDirection = null;
        this.highlightMesh.visible = false;
        this.engine.ui.hideTargetCoords();
    }

    resetHighlightParent() {
        if (this.highlightMesh.parent) {
            this.highlightMesh.parent.remove(this.highlightMesh);
        }
        this.clearSelection();
    }

    dispose() {
        window.removeEventListener('contextmenu', this._onContextMenu);
    }
}