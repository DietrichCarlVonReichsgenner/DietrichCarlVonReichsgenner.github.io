import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CONFIG } from '../config.js';
import { getElevationAt } from '../world/GeometryBuilder.js';

export class CameraController {
    constructor(camera, domElement) {
        this.camera = camera;
        this.controls = new OrbitControls(camera, domElement);
        this.controls.enableDamping = true; 
        this.controls.dampingFactor = 0.05; 
        this.controls.maxDistance = 200000000;
        
        this.mode = 'free';
        this.previousTargetPosition = new THREE.Vector3(0, 0, 0);
        this.previousPlayerQuat = null;
    }

    setFocus(mode, target, offsetVector = new THREE.Vector3(0,0,0)) {
        this.mode = mode;
        if (mode !== 'free') {
            const targetPos = target.isVector3 ? target : target.position;
            this.controls.target.copy(targetPos);
            this.camera.position.copy(targetPos).add(offsetVector);
            this.previousTargetPosition.copy(targetPos);
            this.previousPlayerQuat = null; 
        }
    }

    updateTracking(currentTargetPosition, playerEntity = null, gameState = null) {
        if (this.mode === 'player' && playerEntity) {
            const mesh = playerEntity.Renderable.mesh;
            const currentPos = new THREE.Vector3();
            mesh.getWorldPosition(currentPos);
            
            const currentQuat = new THREE.Quaternion();
            mesh.getWorldQuaternion(currentQuat);

            const up = playerEntity.Transform.up;
            const targetPos = currentPos.clone().add(up.clone().multiplyScalar(20));

            if (!this.previousPlayerQuat) {
                this.previousPlayerQuat = currentQuat.clone();
                this.previousTargetPosition.copy(targetPos);
            }

            const deltaQuat = currentQuat.clone().multiply(this.previousPlayerQuat.clone().invert());
            const offset = this.camera.position.clone().sub(this.previousTargetPosition);
            
            offset.applyQuaternion(deltaQuat);
            
            this.camera.position.copy(targetPos).add(offset);
            this.controls.target.copy(targetPos);
            
            this.camera.up.copy(targetPos).normalize();

            if (gameState) {
                const camDir = this.camera.position.clone().normalize();
                const terrainHeightAtCam = getElevationAt(camDir, CONFIG.radius.planet, false, gameState.seed, gameState);
                const minSafeRadius = terrainHeightAtCam + 40; 

                if (this.camera.position.length() < minSafeRadius) {
                    this.camera.position.copy(camDir).multiplyScalar(minSafeRadius);
                }
            }

            this.previousPlayerQuat.copy(currentQuat);
            this.previousTargetPosition.copy(targetPos);

        } else if (this.mode !== 'free') {
            this.previousPlayerQuat = null;
            let deltaTarget = currentTargetPosition.clone().sub(this.previousTargetPosition);
            this.camera.position.add(deltaTarget);
            this.controls.target.copy(currentTargetPosition);
            this.previousTargetPosition.copy(currentTargetPosition);
        } else {
            this.previousPlayerQuat = null;
        }
        
        this.controls.update();
    }
}