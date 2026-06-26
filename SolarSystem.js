import * as THREE from 'three';
import { buildProceduralGeometry, clearNoiseCache } from './GeometryBuilder.js';
import { CONFIG } from '../config.js';
import { mulberry32 } from '../utils/math.js';

export class SolarSystem {
    constructor(scene, materials) {
        this.scene = scene;
        this.materials = materials;
        
        this.planetGroup = new THREE.Group();
        this.cloudGroupTropics = new THREE.Group();
        this.cloudGroupTemperate = new THREE.Group();
        this.cloudGroupPolar = new THREE.Group();
        this.sunGroup = new THREE.Group();
        this.moonGroup = new THREE.Group();
        
        this.scene.add(this.planetGroup);
        this.scene.add(this.cloudGroupTropics);
        this.scene.add(this.cloudGroupTemperate);
        this.scene.add(this.cloudGroupPolar);
        this.scene.add(this.sunGroup);
        this.scene.add(this.moonGroup);

        const shadowCfg = CONFIG.graphics.shadow;
        this.sunLight = new THREE.DirectionalLight(0xfff5e6, CONFIG.graphics.lighting.sun); 
        this.sunLight.castShadow = true;
        this.setupShadowCamera(this.sunLight, shadowCfg.mapSize, shadowCfg.bias, shadowCfg.normalBias);
        this.scene.add(this.sunLight); 
        
        this.moonLight = new THREE.DirectionalLight(0x88aaff, CONFIG.graphics.lighting.moon);
        this.moonLight.castShadow = true;
        this.setupShadowCamera(this.moonLight, 1024, shadowCfg.bias * 2, shadowCfg.normalBias);
        this.scene.add(this.moonLight); 
        
        this.ambientLight = new THREE.AmbientLight(0xffffff, CONFIG.graphics.lighting.ambient); 
        this.scene.add(this.ambientLight);

        this.allSolidMeshes = [];
        this.allWireMeshes = [];
        this.allAtmosMeshes = [];
        this.allTreeMeshes = [];
        this.allCityMeshes = [];
        this.allSuburbMeshes = [];
        this.allRoadMeshes = [];
        this.cloudMeshes = { tropics: {}, temperate: {}, polar: {} };
        
        this.planetLOD = null;
        this.cloudLODTropics = null;
        this.cloudLODTemperate = null;
        this.cloudLODPolar = null;
        this.moonLOD = null;
        this.sunLOD = null;
        
        this.atmosScale = 1.25;

        const pineGeo = new THREE.ConeGeometry(0.6, 2.5, 4);
        pineGeo.rotateY(Math.PI / 4); 
        pineGeo.translate(0, 1.25, 0); 
        const decGeo = new THREE.IcosahedronGeometry(1.0, 1);
        decGeo.translate(0, 0.8, 0); 

        const boxGeo = new THREE.BoxGeometry(0.8, 1.0, 0.8);
        boxGeo.translate(0, 0.5, 0);
        const pyrGeo = new THREE.ConeGeometry(0.7, 1.0, 4);
        pyrGeo.rotateY(Math.PI / 4);
        pyrGeo.translate(0, 0.5, 0);

        this.sharedGeos = { pine: pineGeo, dec: decGeo, box: boxGeo, pyr: pyrGeo };

        this.createStars();
        
        this.isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    }

    setupShadowCamera(light, resolution, bias, normalBias) {
        const rad = CONFIG.radius.planet;
        const shadowCfg = CONFIG.graphics.shadow;
        light.shadow.camera.near = rad * shadowCfg.near;
        light.shadow.camera.far = rad * shadowCfg.far;
        const d = rad * shadowCfg.frustumSize;
        light.shadow.camera.left = -d;
        light.shadow.camera.right = d;
        light.shadow.camera.top = d;
        light.shadow.camera.bottom = -d;
        light.shadow.mapSize.width = resolution;
        light.shadow.mapSize.height = resolution;
        light.shadow.bias = bias;
        light.shadow.normalBias = normalBias;
    }

    createStars() {
        const count = CONFIG.graphics.stars.count;
        const distance = CONFIG.graphics.stars.distance;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const color = new THREE.Color();
        const starPrng = mulberry32(CONFIG.defaultSeed ^ 0xDEADBEEF);

        for (let i = 0; i < count; i++) {
            const theta = Math.acos(2 * starPrng() - 1);
            const phi = 2 * Math.PI * starPrng();
            positions[i * 3] = distance * Math.sin(theta) * Math.cos(phi);
            positions[i * 3 + 1] = distance * Math.sin(theta) * Math.sin(phi);
            positions[i * 3 + 2] = distance * Math.cos(theta);
            
            const temp = starPrng();
            if (temp < 0.1) color.setHex(0xaabfff); 
            else if (temp < 0.2) color.setHex(0xffddaa); 
            else if (temp < 0.3) color.setHex(0xffaaaa); 
            else color.setHex(0xffffff);                 
            
            const intensity = 0.5 + starPrng() * 0.5;
            colors[i * 3] = color.r * intensity; colors[i * 3 + 1] = color.g * intensity; colors[i * 3 + 2] = color.b * intensity;
        }
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        this.stars = new THREE.Points(geometry, this.materials.starsMaterial);
        this.stars.renderOrder = -10; 
        this.scene.add(this.stars);
    }

    disposeLOD(lod) {
        if (!lod) return;
        const levels = lod.levels;
        if (levels) {
            for (let level of levels) {
                if (level.object && level.object.isGroup) {
                    while (level.object.children.length) {
                        const child = level.object.children[0];
                        if (child.isMesh) {
                            if (child.geometry) child.geometry.dispose();
                        }
                        level.object.remove(child);
                    }
                }
            }
        }
        lod.dispose?.();
    }

    dispose() {
        const disposeGeometry = (mesh) => {
            if (mesh.geometry) mesh.geometry.dispose();
        };
        
        this.allSolidMeshes.forEach(disposeGeometry);
        this.allWireMeshes.forEach(disposeGeometry);
        this.allAtmosMeshes.forEach(disposeGeometry);
        this.allTreeMeshes.forEach(disposeGeometry);
        this.allCityMeshes.forEach(disposeGeometry);
        this.allSuburbMeshes.forEach(disposeGeometry);
        this.allRoadMeshes.forEach(disposeGeometry);
        
        for (let zone of ['tropics', 'temperate', 'polar']) {
            for (let type of ['cumulus', 'rain', 'cirrus']) {
                const arr = this.cloudMeshes[zone][type];
                if (arr) arr.forEach(disposeGeometry);
            }
        }
        
        const clearGroup = (group) => {
            while(group.children.length) {
                const child = group.children[0];
                if (child.isMesh) disposeGeometry(child);
                group.remove(child);
            }
        };
        
        clearGroup(this.planetGroup);
        clearGroup(this.cloudGroupTropics);
        clearGroup(this.cloudGroupTemperate);
        clearGroup(this.cloudGroupPolar);
        clearGroup(this.moonGroup);
        clearGroup(this.sunGroup);
        
        this.disposeLOD(this.planetLOD);
        this.disposeLOD(this.cloudLODTropics);
        this.disposeLOD(this.cloudLODTemperate);
        this.disposeLOD(this.cloudLODPolar);
        this.disposeLOD(this.moonLOD);
        this.disposeLOD(this.sunLOD);
        
        this.allSolidMeshes = [];
        this.allWireMeshes = [];
        this.allAtmosMeshes = [];
        this.allTreeMeshes = [];
        this.allCityMeshes = [];
        this.allSuburbMeshes = [];
        this.allRoadMeshes = [];
        this.cloudMeshes = { tropics: {}, temperate: {}, polar: {} };
        this.planetLOD = null;
        this.cloudLODTropics = null;
        this.cloudLODTemperate = null;
        this.cloudLODPolar = null;
        this.moonLOD = null;
        this.sunLOD = null;
    }

    createLODBody(radius, levels, matteMat, iceMat, wireMat, atmosMat, seed, isMoon, genParams) {
        const lod = new THREE.LOD();
        levels.forEach(level => {
            const group = new THREE.Group();
            let geoData = seed !== null ? buildProceduralGeometry(radius, level.detail, seed, isMoon, genParams) : { matte: new THREE.IcosahedronGeometry(radius, level.detail) };
            
            if (geoData.matte) {
                const mesh = new THREE.Mesh(geoData.matte, matteMat);
                const wire = new THREE.Mesh(geoData.matte, wireMat);
                wire.renderOrder = 3; 
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                this.allSolidMeshes.push(mesh); this.allWireMeshes.push(wire); group.add(mesh, wire);
            }
            if (geoData.ice && iceMat) {
                const mesh = new THREE.Mesh(geoData.ice, iceMat);
                const wire = new THREE.Mesh(geoData.ice, wireMat);
                wire.renderOrder = 3;
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                this.allSolidMeshes.push(mesh); this.allWireMeshes.push(wire); group.add(mesh, wire);
            }
            if (geoData.cityGround) {
                const mesh = new THREE.Mesh(geoData.cityGround, this.materials.cityGroundMaterial);
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                this.allSolidMeshes.push(mesh); 
                group.add(mesh);
            }
            if (geoData.water) {
                const mesh = new THREE.Mesh(geoData.water, this.materials.planetWater);
                mesh.castShadow = false;
                mesh.receiveShadow = true;
                mesh.renderOrder = 1; 
                this.allSolidMeshes.push(mesh); group.add(mesh);
            }
            if (geoData.seaIce && this.materials.planetSeaIce) {
                const seaIceMesh = new THREE.Mesh(geoData.seaIce, this.materials.planetSeaIce);
                seaIceMesh.renderOrder = 2;
                seaIceMesh.receiveShadow = true;
                this.allSolidMeshes.push(seaIceMesh);
                group.add(seaIceMesh);
            }
            if (geoData.seaIceSkirt && this.materials.planetSeaIceSkirt) {
                const skirtMesh = new THREE.Mesh(geoData.seaIceSkirt, this.materials.planetSeaIceSkirt);
                skirtMesh.renderOrder = 1;
                skirtMesh.castShadow = true;
                skirtMesh.receiveShadow = true;
                this.allSolidMeshes.push(skirtMesh);
                group.add(skirtMesh);
            }

            const createInstancedProps = (data, geometry, material, scaleMult = 15.0, hasRotData = false) => {
                if (!data || data.length === 0) return null;
                const stride = hasRotData ? 5 : 4;
                const count = data.length / stride;
                const im = new THREE.InstancedMesh(geometry, material, count);
                
                const dummy = new THREE.Object3D();
                const upVec = new THREE.Vector3();
                const colorObj = new THREE.Color();
                const baseColor = material.color;
                
                for (let i = 0; i < count; i++) {
                    let px = data[i*stride], py = data[i*stride+1], pz = data[i*stride+2], s = data[i*stride+3];
                    let rot = hasRotData ? data[i*stride+4] : px * 100;
                    
                    dummy.position.set(px, py, pz);
                    upVec.set(px, py, pz).normalize();
                    
                    dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), upVec);
                    dummy.rotateY(rot); 
                    
                    if (hasRotData) dummy.scale.set(s * scaleMult * 0.5, s * scaleMult, s * scaleMult * 0.5);
                    else dummy.scale.setScalar(s * scaleMult); 
                    
                    dummy.updateMatrix();
                    im.setMatrixAt(i, dummy.matrix);
                    
                    let vary = 0.85 + (Math.abs(px + pz) % 0.3); 
                    colorObj.copy(baseColor).multiplyScalar(vary);
                    im.setColorAt(i, colorObj);
                }
                im.instanceMatrix.needsUpdate = true;
                if (im.instanceColor) im.instanceColor.needsUpdate = true;
                im.castShadow = true;
                im.receiveShadow = true;
                return im;
            };

            if (geoData.trees) {
                const pineMesh = createInstancedProps(geoData.trees.pine, this.sharedGeos.pine, this.materials.pineMaterial);
                if (pineMesh) { this.allTreeMeshes.push(pineMesh); group.add(pineMesh); }
                
                const decMesh = createInstancedProps(geoData.trees.deciduous, this.sharedGeos.dec, this.materials.deciduousMaterial);
                if (decMesh) { this.allTreeMeshes.push(decMesh); group.add(decMesh); }
            }

            if (geoData.buildings) {
                const boxMesh = createInstancedProps(geoData.buildings.boxes, this.sharedGeos.box, this.materials.cityMaterial, 20.0, true);
                if (boxMesh) { this.allCityMeshes.push(boxMesh); group.add(boxMesh); }
                
                const pyrMesh = createInstancedProps(geoData.buildings.pyramids, this.sharedGeos.pyr, this.materials.cityMaterial, 20.0, true);
                if (pyrMesh) { this.allCityMeshes.push(pyrMesh); group.add(pyrMesh); }
            }

            if (geoData.suburbs) {
                const suburbMesh = createInstancedProps(geoData.suburbs.boxes, this.sharedGeos.box, this.materials.suburbMaterial, 20.0, true);
                if (suburbMesh) { this.allSuburbMeshes.push(suburbMesh); group.add(suburbMesh); }
            }

            if (geoData.rivers) {
                const mesh = new THREE.Mesh(geoData.rivers, this.materials.planetRiver);
                mesh.receiveShadow = true;
                this.allSolidMeshes.push(mesh);
                group.add(mesh);
            }

            if (geoData.roads) {
                const mesh = new THREE.Mesh(geoData.roads, this.materials.planetRoad);
                mesh.receiveShadow = true;
                this.allRoadMeshes.push(mesh);
                group.add(mesh);
            }

            // --- Генерация машинок (Traffic) ---
            if (geoData.cars && geoData.cars.length > 0) {
                const count = geoData.cars.length;
                const carGeo = new THREE.BoxGeometry(1.5, 1.5, 3.0);
                carGeo.translate(0, 0.75, 0); 
                const im = new THREE.InstancedMesh(carGeo, this.materials.carMaterial, count);

                const aDistance = new Float32Array(count);
                const aOffset = new Float32Array(count);
                const aSpeed = new Float32Array(count);

                const m = new THREE.Matrix4();
                const right = new THREE.Vector3();
                const up = new THREE.Vector3();
                const forward = new THREE.Vector3();

                const cObj = new THREE.Color();

                for (let i = 0; i < count; i++) {
                    const c = geoData.cars[i];
                    let startP = c.speed > 0 ? c.pA : c.pB;
                    let endP = c.speed > 0 ? c.pB : c.pA;
                    
                    up.copy(startP).normalize();
                    forward.subVectors(endP, startP).normalize();
                    right.crossVectors(forward, up).normalize();
                    const orthoUp = new THREE.Vector3().crossVectors(right, forward).normalize();

                    // Локальная ось Z смотрит вперед:
                    m.makeBasis(right, orthoUp, forward.clone().negate());
                    
                    // Смещение на нужную (правую) полосу движения
                    const laneOffset = right.clone().multiplyScalar(2.0);
                    m.setPosition(startP.clone().add(laneOffset));

                    im.setMatrixAt(i, m);

                    aDistance[i] = c.dist;
                    aOffset[i] = c.offset;
                    aSpeed[i] = Math.abs(c.speed);

                    cObj.setHSL(Math.random(), 0.7, 0.5 + Math.random() * 0.4);
                    im.setColorAt(i, cObj);
                }

                carGeo.setAttribute('aDistance', new THREE.InstancedBufferAttribute(aDistance, 1));
                carGeo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(aOffset, 1));
                carGeo.setAttribute('aSpeed', new THREE.InstancedBufferAttribute(aSpeed, 1));

                im.receiveShadow = true;
                im.castShadow = true;
                this.allCityMeshes.push(im); 
                group.add(im);
            }

            if (atmosMat && level.atmosDetail !== undefined) {
                const atmosGeo = new THREE.IcosahedronGeometry(radius, level.atmosDetail);
                const atmos = new THREE.Mesh(atmosGeo, atmosMat);
                atmos.scale.setScalar(this.atmosScale);
                atmos.renderOrder = -5;
                this.allAtmosMeshes.push(atmos);
                group.add(atmos);
            }
            lod.addLevel(group, level.distance);
        });
        return lod;
    }

    async generate(state, onProgress = null, abortSignal = null) {
        this.dispose();
        clearNoiseCache();
        
        if (abortSignal && abortSignal.aborted) return;
        
        if (onProgress) onProgress('planet', 0);
        await this._generateBody('planet', state, onProgress, abortSignal);
        if (abortSignal && abortSignal.aborted) return;
        if (onProgress) onProgress('planet', 100);
        
        if (CONFIG.generation.clouds.enabled) {
            if (onProgress) onProgress('clouds', 0);
            await this._generateClouds(state, abortSignal);
            if (abortSignal && abortSignal.aborted) return;
            if (onProgress) onProgress('clouds', 100);
        }
        
        await this.delay(50, abortSignal);
        if (abortSignal && abortSignal.aborted) return;
        if (onProgress) onProgress('moon', 0);
        await this._generateBody('moon', state, onProgress, abortSignal);
        if (abortSignal && abortSignal.aborted) return;
        if (onProgress) onProgress('moon', 100);
        
        await this.delay(50, abortSignal);
        if (abortSignal && abortSignal.aborted) return;
        if (onProgress) onProgress('sun', 0);
        await this._generateBody('sun', state, onProgress, abortSignal);
        if (abortSignal && abortSignal.aborted) return;
        if (onProgress) onProgress('sun', 100);
        
        this.planetGroup.updateMatrixWorld(true);
        this.cloudGroupTropics.updateMatrixWorld(true);
        this.cloudGroupTemperate.updateMatrixWorld(true);
        this.cloudGroupPolar.updateMatrixWorld(true);
    }
    
    async _generateBody(body, state, onProgress, abortSignal) {
        return new Promise((resolve, reject) => {
            if (abortSignal && abortSignal.aborted) return reject(new Error('aborted'));
            setTimeout(() => {
                if (abortSignal && abortSignal.aborted) return reject(new Error('aborted'));
                try {
                    let currentLodCfg = CONFIG.lod[body];
                    if (this.isMobile && CONFIG.performance.mobileReduction) {
                        currentLodCfg = currentLodCfg.map(l => ({
                            ...l,
                            detail: Math.max(2, Math.floor(l.detail * CONFIG.performance.mobileLodFactor))
                        }));
                    }

                    if (body === 'planet') {
                        this.planetLOD = this.createLODBody(
                            CONFIG.radius.planet, currentLodCfg,
                            this.materials.planetMatte, this.materials.planetIce,
                            this.materials.planetWire, this.materials.atmosphereMaterial,
                            state.seed, false, state
                        );
                        this.planetGroup.add(this.planetLOD);
                    } else if (body === 'moon') {
                        this.moonLOD = this.createLODBody(
                            CONFIG.radius.moon, currentLodCfg,
                            this.materials.moonSolid, null, this.materials.moonWire, null,
                            state.seed + 999, true, state
                        );
                        this.moonGroup.add(this.moonLOD);
                    } else if (body === 'sun') {
                        this.sunLOD = this.createLODBody(
                            CONFIG.radius.sun, currentLodCfg,
                            this.materials.sunSolid, null, this.materials.sunWire, null,
                            null, false, state
                        );
                        this.sunGroup.add(this.sunLOD);
                    }
                    resolve();
                } catch (err) {
                    reject(err);
                }
            }, 0);
        });
    }
    
    async _generateClouds(state, abortSignal) {
        return new Promise((resolve, reject) => {
            if (abortSignal && abortSignal.aborted) return reject(new Error('aborted'));
            setTimeout(() => {
                if (abortSignal && abortSignal.aborted) return reject(new Error('aborted'));
                try {
                    let cloudLodCfg = CONFIG.lod.planet;
                    if (this.isMobile && CONFIG.performance.mobileReduction) {
                        cloudLodCfg = cloudLodCfg.map(l => ({
                            ...l,
                            cloudDetail: l.cloudDetail !== undefined ? Math.max(2, Math.floor(l.cloudDetail * CONFIG.performance.mobileLodFactor)) : undefined
                        }));
                    }

                    const zoneLods = { tropics: new THREE.LOD(), temperate: new THREE.LOD(), polar: new THREE.LOD() };
                    
                    for (const level of cloudLodCfg) {
                        if (level.cloudDetail === undefined) continue;
                        
                        const geoData = buildProceduralGeometry(
                            CONFIG.radius.planet, level.cloudDetail, state.seed, false, state
                        );
                        const cloudsByZone = geoData.cloudsByZone;
                        
                        for (const zone of ['tropics', 'temperate', 'polar']) {
                            const group = new THREE.Group();
                            if (cloudsByZone && cloudsByZone[zone]) {
                                for (const type of ['cumulus', 'rain', 'cirrus']) {
                                    const cloudGeo = cloudsByZone[zone][type];
                                    if (!cloudGeo) continue;
                                    
                                    const mat = type === 'cumulus' ? this.materials.cloudCumulus
                                              : type === 'rain' ? this.materials.cloudRain
                                              : this.materials.cloudCirrus;
                                              
                                    const mesh = new THREE.Mesh(cloudGeo, mat);
                                    mesh.castShadow = type !== 'cirrus' && CONFIG.generation.clouds.castShadow;
                                    mesh.receiveShadow = false;
                                    mesh.renderOrder = type === 'cirrus' ? 5 : 4;
                                    
                                    if (!this.cloudMeshes[zone][type]) this.cloudMeshes[zone][type] = [];
                                    this.cloudMeshes[zone][type].push(mesh);
                                    group.add(mesh);
                                }
                            }
                            zoneLods[zone].addLevel(group, level.distance);
                        }
                    }
                    
                    const zoneMap = {
                        tropics:   { lodProp: 'cloudLODTropics',   group: this.cloudGroupTropics },
                        temperate: { lodProp: 'cloudLODTemperate', group: this.cloudGroupTemperate },
                        polar:     { lodProp: 'cloudLODPolar',     group: this.cloudGroupPolar }
                    };
                    
                    for (const [zone, { lodProp, group }] of Object.entries(zoneMap)) {
                        this[lodProp] = zoneLods[zone];
                        group.add(zoneLods[zone]);
                    }
                    
                    resolve();
                } catch (err) {
                    reject(err);
                }
            }, 0);
        });
    }
    
    delay(ms, abortSignal) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(resolve, ms);
            if (abortSignal) {
                abortSignal.addEventListener('abort', () => {
                    clearTimeout(timeout);
                    reject(new Error('aborted'));
                }, { once: true });
            }
        });
    }

    setAtmosScale(scale) {
        this.atmosScale = scale;
        this.allAtmosMeshes.forEach(m => m.scale.setScalar(scale));
    }

    setVisibility(solid, wire, atmos) {
        this.allSolidMeshes.forEach(m => m.visible = solid);
        this.allTreeMeshes.forEach(m => m.visible = solid);
        this.allCityMeshes.forEach(m => m.visible = solid);
        this.allSuburbMeshes.forEach(m => m.visible = solid);
        this.allRoadMeshes.forEach(m => m.visible = solid);
        this.allWireMeshes.forEach(m => m.visible = wire);
        this.allAtmosMeshes.forEach(m => m.visible = atmos);

        for (let zone of ['tropics', 'temperate', 'polar']) {
            for (let type of ['cumulus', 'rain', 'cirrus']) {
                const arr = this.cloudMeshes[zone][type];
                if (arr) arr.forEach(m => m.visible = solid);
            }
        }
    }
    
    updateLightTargets(cameraPosition) {
        const planetPos = new THREE.Vector3(0, 0, 0);
        const moonPos = this.moonGroup.position;
        const sunPos = this.sunGroup.position;
        
        const distToPlanet = cameraPosition.length();
        const distToMoon = cameraPosition.clone().sub(moonPos).length();
        const distToSun = cameraPosition.clone().sub(sunPos).length();
        
        let targetPos = planetPos;
        if (distToMoon < distToPlanet && distToMoon < distToSun) targetPos = moonPos;
        else if (distToSun < distToPlanet && distToSun < distToMoon) targetPos = sunPos;
        
        this.sunLight.target.position.copy(targetPos);
        this.moonLight.target.position.copy(targetPos);
        this.sunLight.target.updateMatrixWorld();
        this.moonLight.target.updateMatrixWorld();
    }

    update(delta, camera, playerPosition, state) {
        this.planetGroup.rotation.y += CONFIG.physics.rotationSpeedPlanet * delta;
        
        const hadley = CONFIG.generation.clouds.hadleyCells;
        this.cloudGroupTropics.rotation.y += hadley.tropics.speed * delta;
        this.cloudGroupTemperate.rotation.y += hadley.temperate.speed * delta;
        this.cloudGroupPolar.rotation.y += hadley.polar.speed * delta;
        
        this.moonGroup.rotation.y += CONFIG.physics.rotationSpeedMoon * delta;
        
        if(this.planetLOD) this.planetLOD.update(camera);
        if(this.cloudLODTropics) this.cloudLODTropics.update(camera);
        if(this.cloudLODTemperate) this.cloudLODTemperate.update(camera);
        if(this.cloudLODPolar) this.cloudLODPolar.update(camera);
        if(this.moonLOD) this.moonLOD.update(camera);
        if(this.sunLOD) this.sunLOD.update(camera);
        
        this.updateLightTargets(camera.position);

        this.materials.nightLightUniforms.uSunPos.value.copy(this.sunGroup.position);
    }
}