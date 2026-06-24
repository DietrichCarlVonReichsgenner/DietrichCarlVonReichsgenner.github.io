import * as THREE from 'three';
import { createNoiseGenerator, mulberry32 } from '../utils/math.js';
import { CONFIG } from '../config.js';

class WorldGenerator {
    constructor() {
        this._cache = new Map();
    }

    getNoiseGenerators(seed) {
        if (!this._cache.has(seed)) {
            this._cache.set(seed, {
                noiseE: createNoiseGenerator(seed),
                noiseM: createNoiseGenerator(seed + 1),
                noiseT: createNoiseGenerator(seed + 2),
                noiseC: createNoiseGenerator(seed + 5),
                prng:   mulberry32(seed + 5)
            });
        }
        return this._cache.get(seed);
    }

    clearCache() {
        this._cache.clear();
    }
}

export const worldGenerator = new WorldGenerator();

export function getNoiseGenerators(seed)  { return worldGenerator.getNoiseGenerators(seed); }
export function clearNoiseCache()         { worldGenerator.clearCache(); }

export function computeWaterOffset(radius, waterLevelParam = 0.4) {
    const maxExtrusion    = radius * CONFIG.generation.maxExtrusionPlanet;
    const waterOffsetGeo  = CONFIG.generation.waterHeightOffset * maxExtrusion;
    const waterDelta      = (waterLevelParam - 0.4) * maxExtrusion;
    return waterOffsetGeo + waterDelta;
}

function getLatitudeZone(latDeg) {
    const absLat = Math.abs(latDeg);
    if (absLat <= 30) return 'tropics';
    if (absLat <= 60) return 'temperate';
    return 'polar';
}

function computeElevation(n1, n2, isMoon, waterOffset, elevSpread, steps) {
    let raw = n1 + n2;
    if (!isMoon) {
        raw += waterOffset;
        if (raw > CONFIG.generation.waterLevelThreshold) {
            raw = CONFIG.generation.waterLevelThreshold + (raw - CONFIG.generation.waterLevelThreshold) * elevSpread;
        }
    } else {
        raw *= elevSpread;
    }
    return Math.max(0.0, Math.min(1.0, Math.floor(raw * steps) / steps));
}

function computeTileData(baseGeo, noiseGens, radius, isMoon, genParams) {
    const { noiseE, noiseM, noiseT, noiseC, prng } = noiseGens;
    const pos = baseGeo.attributes.position.array;
    
    const contFreq = genParams?.continents ?? 2.5;
    const islandAmp = genParams?.islands ?? 0.25;
    const waterOffset = CONFIG.generation.waterLevelThreshold - (genParams?.waterLevel ?? CONFIG.generation.waterLevelThreshold);
    const elevSpread = genParams?.elevationSpread ?? 1.0;
    const globTemp = genParams?.globalTemp ?? 0.0;
    const globMoist = genParams?.globalMoisture ?? 0.0;
    const reqCityCount = genParams?.cityCount ?? CONFIG.generation.cityCount;
    
    const cloudStdMul = (genParams?.cloudStandard ?? CONFIG.generation.cloudStandard) * 1.5;
    const cloudRainMul = (genParams?.cloudRain ?? CONFIG.generation.cloudRain) * 1.8;
    const cloudCirrusMul = (genParams?.cloudCirrus ?? CONFIG.generation.cloudCirrus) * 1.2;
    
    const moistureFactor = Math.max(0.2, Math.min(2.0, 1.0 + globMoist));
    const tempFactor = Math.max(0.5, Math.min(1.8, 1.0 + globTemp * 0.6));
    const globalCloudFactor = moistureFactor * tempFactor;

    const maxExtrusion = isMoon ? radius * CONFIG.generation.maxExtrusionMoon : radius * CONFIG.generation.maxExtrusionPlanet;
    const steps = isMoon ? CONFIG.generation.stepsMoon : CONFIG.generation.stepsPlanet;
    
    const faceData = [];
    const edgeMap = new Map();
    const hashVec = (x, y, z) => `${Math.round(x*100)}_${Math.round(y*100)}_${Math.round(z*100)}`;

    const cloudFaces = { tropics: { cumulus: [], rain: [], cirrus: [] }, temperate: { cumulus: [], rain: [], cirrus: [] }, polar: { cumulus: [], rain: [], cirrus: [] } };
    const cloudEdgeMaps = { tropics: { cumulus: new Map(), rain: new Map(), cirrus: new Map() }, temperate: { cumulus: new Map(), rain: new Map(), cirrus: new Map() }, polar: { cumulus: new Map(), rain: new Map(), cirrus: new Map() } };

    const _vA = new THREE.Vector3();
    const _vB = new THREE.Vector3();
    const _vC = new THREE.Vector3();
    const _center = new THREE.Vector3();
    const _dir = new THREE.Vector3();
    const _colorObj = new THREE.Color();
    const _lerpColor = new THREE.Color(0x999988);

    const landCandidateIndices = [];

    // Карты графа вершин (для прокладки рек по рёбрам)
    const vertexMap = new Map();
    let vCount = 0;
    const getVIdx = (x, y, z) => {
        const h = `${x}_${y}_${z}`;
        let v = vertexMap.get(h);
        if (!v) {
            v = { id: vCount++, x, y, z, faces: [] };
            vertexMap.set(h, v);
        }
        return v;
    };

    const vEdges = new Map();
    const addVEdge = (u, v, fIdx) => {
        const key = u < v ? `${u}_${v}` : `${v}_${u}`;
        let e = vEdges.get(key);
        if (!e) {
            e = { u, v, faces: [] };
            vEdges.set(key, e);
        }
        e.faces.push(fIdx);
    };

    for (let i = 0; i < pos.length; i += 9) {
        _vA.set(pos[i], pos[i+1], pos[i+2]);
        _vB.set(pos[i+3], pos[i+4], pos[i+5]);
        _vC.set(pos[i+6], pos[i+7], pos[i+8]);

        _center.copy(_vA).add(_vB).add(_vC).divideScalar(3);
        _dir.copy(_center).normalize();

        let n1 = noiseE.noise3d(_dir.x * contFreq, _dir.y * contFreq, _dir.z * contFreq) * 0.5 + 0.5;
        let n2 = noiseE.noise3d(_dir.x * (contFreq * 2), _dir.y * (contFreq * 2), _dir.z * (contFreq * 2)) * islandAmp;
        
        let steppedElevation = computeElevation(n1, n2, isMoon, waterOffset, elevSpread, steps);
        
        let latitude = Math.asin(_dir.y) * (180 / Math.PI);
        let temp = Math.max(0.0, Math.min(1.0, (1.0 - Math.abs(_dir.y)) + (noiseT.noise3d(_dir.x * 2, _dir.y * 2, _dir.z * 2) * 0.2) + globTemp)); 
        let moisture = Math.max(0.0, Math.min(1.0, (noiseM.noise3d(_dir.x * 3, _dir.y * 3, _dir.z * 3) * 0.5 + 0.5) + globMoist));

        let isSubmerged = !isMoon && steppedElevation < CONFIG.generation.waterLevelThreshold;
        let isLandIce = false;
        let isSeaIce = false;

        if (isMoon) {
            let c = 0.3 + steppedElevation * 0.5;
            _colorObj.setRGB(c, c, c); 
        } else {
            if (steppedElevation > 0.85) { _colorObj.setHex(0xffffff); isLandIce = true; } 
            else if (temp < 0.25) { _colorObj.setHex(0xeeeeee); isLandIce = true; } 
            else if (temp < 0.4) { moisture < 0.5 ? _colorObj.setHex(0x8b9977) : _colorObj.setHex(0x2b4f3b); } 
            else if (temp < 0.7) { moisture < 0.3 ? _colorObj.setHex(0xc2b280) : moisture < 0.7 ? _colorObj.setHex(0x55aa55) : _colorObj.setHex(0x228b22); } 
            else { moisture < 0.35 ? _colorObj.setHex(0xedc9af) : moisture < 0.65 ? _colorObj.setHex(0x9acd32) : _colorObj.setHex(0x006400); }

            if (isSubmerged) {
                _colorObj.setHex(0x555544).lerp(_lerpColor, steppedElevation / CONFIG.generation.waterLevelThreshold);
                if (temp < CONFIG.generation.iceTempThreshold) { 
                    isSeaIce = true; 
                }
            }
        }

        let h = steppedElevation * maxExtrusion; 
        
        let hA = hashVec(_vA.x, _vA.y, _vA.z), hB = hashVec(_vB.x, _vB.y, _vB.z), hC = hashVec(_vC.x, _vC.y, _vC.z);
        let faceIndex = faceData.length;
        
        if (!isSubmerged && !isLandIce && temp > 0.3 && temp < 0.8 && steppedElevation < 0.7 && !isMoon) {
            landCandidateIndices.push(faceIndex);
        }
        
        faceData.push({
            hA, hB, hC,
            ax: _vA.x, ay: _vA.y, az: _vA.z,
            bx: _vB.x, by: _vB.y, bz: _vB.z,
            cx: _vC.x, cy: _vC.y, cz: _vC.z,
            midX: _center.x, midY: _center.y, midZ: _center.z,
            h, isLandIce, isSeaIce, isSubmerged, temp, moisture, steppedElevation,
            r: _colorObj.r, g: _colorObj.g, b: _colorObj.b,
            sr: _colorObj.r * 0.6, sg: _colorObj.g * 0.6, sb: _colorObj.b * 0.6,
            isCity: false
        });

        const addEdge = (h1, h2, fIdx, map) => {
            let key = h1 < h2 ? h1 + '|' + h2 : h2 + '|' + h1;
            let arr = map.get(key);
            if (!arr) { arr = []; map.set(key, arr); }
            arr.push(fIdx);
        };
        
        addEdge(hA, hB, faceIndex, edgeMap); addEdge(hB, hC, faceIndex, edgeMap); addEdge(hC, hA, faceIndex, edgeMap);

        // Интеграция вершин для рек
        let vA_node = getVIdx(_vA.x, _vA.y, _vA.z);
        let vB_node = getVIdx(_vB.x, _vB.y, _vB.z);
        let vC_node = getVIdx(_vC.x, _vC.y, _vC.z);

        vA_node.faces.push(faceIndex);
        vB_node.faces.push(faceIndex);
        vC_node.faces.push(faceIndex);

        addVEdge(vA_node.id, vB_node.id, faceIndex);
        addVEdge(vB_node.id, vC_node.id, faceIndex);
        addVEdge(vC_node.id, vA_node.id, faceIndex);

        if (CONFIG.generation.clouds.enabled && !isMoon) {
            let noiseVal = noiseC.noise3d(_dir.x * 2.0, _dir.y * 2.0, _dir.z * 2.0) * 0.5 + 0.5;
            let noiseVal2 = noiseC.noise3d(_dir.x * 4.0, _dir.y * 4.0, _dir.z * 4.0) * 0.5 + 0.5;
            let localCloudFactor = Math.min(1.2, moisture * 1.5) * Math.max(0.3, 1.0 - temp * 0.4) * globalCloudFactor;
            
            let probCumulus = noiseVal * CONFIG.generation.clouds.types.cumulus.density * cloudStdMul * localCloudFactor;
            let probRain = noiseVal2 * CONFIG.generation.clouds.types.rain.density * cloudRainMul * localCloudFactor;
            let probCirrus = (noiseVal * 0.6 + noiseVal2 * 0.4) * CONFIG.generation.clouds.types.cirrus.density * cloudCirrusMul * localCloudFactor;
            
            let cloudType = null;
            if (probRain > probCumulus && probRain > probCirrus && probRain > 0.2) cloudType = 'rain';
            else if (probCumulus > probCirrus && probCumulus > 0.25) cloudType = 'cumulus';
            else if (probCirrus > 0.18) cloudType = 'cirrus';
            
            if (cloudType) {
                let cloudZone = getLatitudeZone(latitude);
                let params = CONFIG.generation.clouds.types[cloudType];
                let cloudBase = radius + maxExtrusion * params.height + ((noiseVal - 0.5) * maxExtrusion * 0.2);
                let cloudTop = cloudBase + maxExtrusion * params.thickness;
                
                const cloudIdx = cloudFaces[cloudZone][cloudType].length;
                cloudFaces[cloudZone][cloudType].push({
                    hA, hB, hC,
                    ax: _vA.x, ay: _vA.y, az: _vA.z, bx: _vB.x, by: _vB.y, bz: _vB.z, cx: _vC.x, cy: _vC.y, cz: _vC.z,
                    cloudBase, cloudTop
                });
                const edgeMapZone = cloudEdgeMaps[cloudZone][cloudType];
                addEdge(hA, hB, cloudIdx, edgeMapZone); addEdge(hB, hC, cloudIdx, edgeMapZone); addEdge(hC, hA, cloudIdx, edgeMapZone);
            }
        }
    }

    const adjacency = Array(faceData.length).fill().map(() => []);
    for (let arr of edgeMap.values()) {
        if (arr.length === 2) {
            adjacency[arr[0]].push(arr[1]);
            adjacency[arr[1]].push(arr[0]);
        }
    }

    const citySeeds = [];
    if (!isMoon && landCandidateIndices.length > 0) {
        for (let i = landCandidateIndices.length - 1; i > 0; i--) {
            const j = Math.floor(prng() * (i + 1));
            [landCandidateIndices[i], landCandidateIndices[j]] = [landCandidateIndices[j], landCandidateIndices[i]];
        }
        
        let clustersPlaced = 0;
        for (let i = 0; i < landCandidateIndices.length && clustersPlaced < reqCityCount; i++) {
            const seedIdx = landCandidateIndices[i];
            if (faceData[seedIdx].isCity) continue;

            let clusterSize = 6 + Math.floor(prng() * 12);
            let cluster = [seedIdx];
            
            faceData[seedIdx].isCity = true;
            faceData[seedIdx].r = 0.45; faceData[seedIdx].g = 0.45; faceData[seedIdx].b = 0.45;
            
            let q = [seedIdx];
            while (q.length > 0 && cluster.length < clusterSize) {
                let curr = q.shift();
                let neighbors = adjacency[curr];
                if (neighbors) {
                    for (let n of neighbors) {
                        let nF = faceData[n];
                        if (!nF.isCity && !nF.isSubmerged && !nF.isLandIce && nF.temp > 0.2 && nF.steppedElevation < 0.75) {
                            nF.isCity = true;
                            nF.r = 0.45; nF.g = 0.45; nF.b = 0.45;
                            cluster.push(n);
                            q.push(n);
                            if (cluster.length >= clusterSize) break;
                        }
                    }
                }
            }
            citySeeds.push(seedIdx);
            clustersPlaced++;
        }
    }

    // ─── Прокладка рек строго по рёбрам (Vertices Graph) ──────────────────────
    const vertices = Array.from(vertexMap.values());
    for (let v of vertices) {
        v.minH = Math.min(...v.faces.map(fIdx => faceData[fIdx].h));
        v.isSubmerged = v.faces.every(fIdx => faceData[fIdx].isSubmerged);
    }
    for (let e of vEdges.values()) {
        e.h = Math.min(...e.faces.map(fIdx => faceData[fIdx].h));
    }

    const adj = Array.from({length: vCount}, () => []);
    for (let e of vEdges.values()) {
        adj[e.u].push({ v: e.v, edge: e });
        adj[e.v].push({ v: e.u, edge: e });
    }

    const riverPaths = [];
    if (!isMoon) {
        const mountainVerts = vertices.filter(v => !v.isSubmerged && v.minH > 0.55 * maxExtrusion);
        for (let i = mountainVerts.length - 1; i > 0; i--) {
            const j = Math.floor(prng() * (i + 1));
            [mountainVerts[i], mountainVerts[j]] = [mountainVerts[j], mountainVerts[i]];
        }

        const visitedVerts = new Set();
        const riverCount = Math.min(CONFIG.generation.riverCount, mountainVerts.length);

        for (let i = 0; i < riverCount; i++) {
            const startV = mountainVerts[i];
            if (visitedVerts.has(startV.id)) continue;

            let current = startV.id;
            const path = [current];

            while (path.length < 1200) {
                visitedVerts.add(current);
                const vData = vertices[current];
                if (vData.isSubmerged) break;

                const neighbors = adj[current];
                if (!neighbors || neighbors.length === 0) break;

                let best = null;
                let bestH = Infinity;

                // Река течет в низину по градиенту минимальной высоты смежных тайлов
                for (const n of neighbors) {
                    if (n.edge.h < bestH) {
                        bestH = n.edge.h;
                        best = n.v;
                    }
                }

                if (best === null || visitedVerts.has(best)) {
                    best = null;
                    for (const n of neighbors) {
                        if (!visitedVerts.has(n.v)) { best = n.v; break; }
                    }
                }

                if (best === null) break;
                current = best;
                path.push(current);
            }
            if (path.length > 2) riverPaths.push(path);
        }
    }

    return { faceData, edgeMap, cloudFaces, cloudEdgeMaps, maxExtrusion, riverPaths, vertices, vEdges };
}

function buildLandGeometry(tileData, radius, isMoon, prngSeed) {
    const mattePositions = [], matteColors = [];
    const cityGroundPositions = [], cityGroundColors = []; 
    const icePositions = [], iceColors = [];
    const waterPositions = [], waterColors = [], waterIsFrozen = [];
    const seaIcePositions = [], seaIceColors = [];
    const seaIceSkirtPositions = [], seaIceSkirtColors = [];
    
    const pinePositions = [];
    const decPositions = [];
    const cityBoxPositions = [];
    const cityPyrPositions = [];
    
    const prng = mulberry32(prngSeed !== null ? prngSeed + 777 : 12345);

    const _wA = new THREE.Vector3(), _wB = new THREE.Vector3(), _wC = new THREE.Vector3();
    const _iA = new THREE.Vector3(), _iB = new THREE.Vector3(), _iC = new THREE.Vector3();
    const _eA = new THREE.Vector3(), _eB = new THREE.Vector3(), _eC = new THREE.Vector3();
    const _bot1 = new THREE.Vector3(), _bot2 = new THREE.Vector3();

    for (let fIdx = 0; fIdx < tileData.faceData.length; fIdx++) {
        const f = tileData.faceData[fIdx];
        
        if (f.isSubmerged && !isMoon) {
            let wh = CONFIG.generation.waterHeightOffset * tileData.maxExtrusion; 
            _wA.set(f.ax, f.ay, f.az).normalize().multiplyScalar(radius + wh);
            _wB.set(f.bx, f.by, f.bz).normalize().multiplyScalar(radius + wh);
            _wC.set(f.cx, f.cy, f.cz).normalize().multiplyScalar(radius + wh);
            
            waterPositions.push(_wA.x, _wA.y, _wA.z, _wB.x, _wB.y, _wB.z, _wC.x, _wC.y, _wC.z);
            let wr = f.temp > 0.7 ? 0.0 : 0.066;
            let wg = f.temp > 0.7 ? 0.666 : 0.466;
            let wb = 1.0;
            waterColors.push(wr, wg, wb, wr, wg, wb, wr, wg, wb);
            
            let frozenVal = f.isSeaIce ? 1.0 : 0.0;
            waterIsFrozen.push(frozenVal, frozenVal, frozenVal);

            if (f.isSeaIce) {
                const iceRaise = tileData.maxExtrusion * 0.04;
                const ih = wh + iceRaise;

                _iA.set(f.ax, f.ay, f.az).normalize().multiplyScalar(radius + ih);
                _iB.set(f.bx, f.by, f.bz).normalize().multiplyScalar(radius + ih);
                _iC.set(f.cx, f.cy, f.cz).normalize().multiplyScalar(radius + ih);
                seaIcePositions.push(_iA.x, _iA.y, _iA.z, _iB.x, _iB.y, _iB.z, _iC.x, _iC.y, _iC.z);
                seaIceColors.push(0.85, 0.95, 1.0,  0.85, 0.95, 1.0,  0.85, 0.95, 1.0);

                const skirtBot = radius + wh - iceRaise;
                const skirtColor = [0.72, 0.85, 0.95];

                const iceEdges = [
                    [f.hA, f.hB, f.ax, f.ay, f.az, f.bx, f.by, f.bz, _iA, _iB],
                    [f.hB, f.hC, f.bx, f.by, f.bz, f.cx, f.cy, f.cz, _iB, _iC],
                    [f.hC, f.hA, f.cx, f.cy, f.cz, f.ax, f.ay, f.az, _iC, _iA],
                ];

                for (const [h1, h2, v1x, v1y, v1z, v2x, v2y, v2z, top1, top2] of iceEdges) {
                    const key = h1 < h2 ? h1 + '|' + h2 : h2 + '|' + h1;
                    const neighbors = tileData.edgeMap.get(key);

                    const neighbor = neighbors
                        ? tileData.faceData[neighbors[0] === fIdx ? neighbors[1] : neighbors[0]]
                        : null;
                    const needsSkirt = neighbor && neighbor.isSubmerged && !neighbor.isSeaIce;

                    if (needsSkirt) {
                        const bot1 = new THREE.Vector3(v1x, v1y, v1z).normalize().multiplyScalar(skirtBot);
                        const bot2 = new THREE.Vector3(v2x, v2y, v2z).normalize().multiplyScalar(skirtBot);

                        for (let k = 0; k < 6; k++) seaIceSkirtColors.push(...skirtColor);
                        seaIceSkirtPositions.push(
                            top1.x, top1.y, top1.z,
                            top2.x, top2.y, top2.z,
                            bot1.x, bot1.y, bot1.z,
                            top2.x, top2.y, top2.z,
                            bot2.x, bot2.y, bot2.z,
                            bot1.x, bot1.y, bot1.z
                        );
                    }
                }
            }
        }

        _eA.set(f.ax, f.ay, f.az).normalize().multiplyScalar(radius + f.h);
        _eB.set(f.bx, f.by, f.bz).normalize().multiplyScalar(radius + f.h);
        _eC.set(f.cx, f.cy, f.cz).normalize().multiplyScalar(radius + f.h);

        if (!f.isSubmerged && !f.isLandIce && !isMoon) {
            if (f.isCity) {
                let buildingCount = 10 + Math.floor(prng() * 8); 
                for (let i = 0; i < buildingCount; i++) {
                    let r1 = prng(), r2 = prng();
                    if (r1 + r2 > 1) { r1 = 1 - r1; r2 = 1 - r2; }
                    let r3 = 1 - r1 - r2;
                    let tx = _eA.x * r1 + _eB.x * r2 + _eC.x * r3;
                    let ty = _eA.y * r1 + _eB.y * r2 + _eC.y * r3;
                    let tz = _eA.z * r1 + _eB.z * r2 + _eC.z * r3;
                    
                    let scaleHeight = 0.8 + prng() * 3.5;
                    let rot = prng() * Math.PI;
                    
                    if (prng() > 0.3) {
                        cityBoxPositions.push(tx, ty, tz, scaleHeight, rot);
                    } else {
                        cityPyrPositions.push(tx, ty, tz, scaleHeight, rot);
                    }
                }
            } else if (f.moisture > 0.35 && f.temp < 0.85) {
                let treeDensity = (f.moisture - 0.35) * 6.0; 
                let count = Math.floor(treeDensity) + (prng() < (treeDensity % 1) ? 1 : 0);
                if (count > 0) {
                    let isTaiga = f.temp < 0.4;
                    let targetArr = isTaiga ? pinePositions : decPositions;
                    for (let i = 0; i < count; i++) {
                        let r1 = prng(), r2 = prng();
                        if (r1 + r2 > 1) { r1 = 1 - r1; r2 = 1 - r2; }
                        let r3 = 1 - r1 - r2;
                        let tx = _eA.x * r1 + _eB.x * r2 + _eC.x * r3;
                        let ty = _eA.y * r1 + _eB.y * r2 + _eC.y * r3;
                        let tz = _eA.z * r1 + _eB.z * r2 + _eC.z * r3;
                        let scale = 0.6 + prng() * 0.6;
                        targetArr.push(tx, ty, tz, scale);
                    }
                }
            }
        }

        let targetPos, targetCol;
        if (f.isCity) { targetPos = cityGroundPositions; targetCol = cityGroundColors; }
        else if (f.isLandIce) { targetPos = icePositions; targetCol = iceColors; }
        else { targetPos = mattePositions; targetCol = matteColors; }

        targetPos.push(_eA.x, _eA.y, _eA.z, _eB.x, _eB.y, _eB.z, _eC.x, _eC.y, _eC.z);
        targetCol.push(f.r, f.g, f.b, f.r, f.g, f.b, f.r, f.g, f.b);

        const landEdges = [
            [f.hA, f.hB, f.ax, f.ay, f.az, f.bx, f.by, f.bz, _eA.x, _eA.y, _eA.z, _eB.x, _eB.y, _eB.z],
            [f.hB, f.hC, f.bx, f.by, f.bz, f.cx, f.cy, f.cz, _eB.x, _eB.y, _eB.z, _eC.x, _eC.y, _eC.z],
            [f.hC, f.hA, f.cx, f.cy, f.cz, f.ax, f.ay, f.az, _eC.x, _eC.y, _eC.z, _eA.x, _eA.y, _eA.z]
        ];

        for (let edge of landEdges) {
            let [h1, h2, v1x, v1y, v1z, v2x, v2y, v2z, t1x, t1y, t1z, t2x, t2y, t2z] = edge;
            let key = h1 < h2 ? h1 + '|' + h2 : h2 + '|' + h1;
            let neighbors = tileData.edgeMap.get(key);
            let nH = 0;
            if (neighbors) {
                let neighborIdx = neighbors[0] === fIdx ? neighbors[1] : neighbors[0];
                if (neighborIdx !== undefined) nH = tileData.faceData[neighborIdx].h;
            }
            if (f.h > nH) {
                _bot1.set(v1x, v1y, v1z).normalize().multiplyScalar(radius + nH);
                _bot2.set(v2x, v2y, v2z).normalize().multiplyScalar(radius + nH);
                targetPos.push(
                    _bot1.x, _bot1.y, _bot1.z, _bot2.x, _bot2.y, _bot2.z, t1x, t1y, t1z,
                    _bot2.x, _bot2.y, _bot2.z, t2x, t2y, t2z, t1x, t1y, t1z
                );
                for(let k=0; k<6; k++) targetCol.push(f.sr, f.sg, f.sb);
            }
        }
    }
    
    // ─── Построение геометрии рек: фаски (quads) и водопады (pillars) ─────────
    const riverPositions = [];
    const riverWidth = radius * 0.0035; 
    const riverRaise = tileData.maxExtrusion * 0.005;

    // Сборка полигона русла (Quad) с соблюдением обхода для корректных нормалей
    const addQuad = (l1, r1, r2, l2) => {
        riverPositions.push(
            l1.x, l1.y, l1.z, r1.x, r1.y, r1.z, r2.x, r2.y, r2.z,
            r2.x, r2.y, r2.z, l2.x, l2.y, l2.z, l1.x, l1.y, l1.z
        );
    };

    for (const path of tileData.riverPaths) {
        if (path.length < 2) continue;

        const pathData = [];
        for (let i = 0; i < path.length; i++) {
            const vId = path[i];
            const v = tileData.vertices[vId];
            const pos = new THREE.Vector3(v.x, v.y, v.z).normalize();

            let e_in = null, e_out = null;
            if (i > 0) {
                const prevId = path[i-1];
                e_in = tileData.vEdges.get(prevId < vId ? `${prevId}_${vId}` : `${vId}_${prevId}`);
            }
            if (i < path.length - 1) {
                const nextId = path[i+1];
                e_out = tileData.vEdges.get(vId < nextId ? `${vId}_${nextId}` : `${nextId}_${vId}`);
            }

            const h_in = e_in ? e_in.h : (e_out ? e_out.h : v.minH);
            const h_out = e_out ? e_out.h : h_in;

            let d_in = i > 0 ? pos.clone().sub(new THREE.Vector3(tileData.vertices[path[i-1]].x, tileData.vertices[path[i-1]].y, tileData.vertices[path[i-1]].z).normalize()).normalize() : null;
            let d_out = i < path.length - 1 ? new THREE.Vector3(tileData.vertices[path[i+1]].x, tileData.vertices[path[i+1]].y, tileData.vertices[path[i+1]].z).normalize().sub(pos).normalize() : null;

            let tangent = new THREE.Vector3();
            if (d_in && d_out) tangent.addVectors(d_in, d_out).normalize();
            else if (d_in) tangent.copy(d_in);
            else if (d_out) tangent.copy(d_out);

            const right = tangent.cross(pos).normalize();
            pathData.push({ pos, right, h_in, h_out });
        }

        for (let i = 0; i < pathData.length - 1; i++) {
            const pA = pathData[i];
            const pB = pathData[i+1];

            const H_seg = pA.h_out;
            const rad = radius + H_seg + riverRaise;

            const wRightA = pA.right.clone().multiplyScalar(riverWidth);
            const wRightB = pB.right.clone().multiplyScalar(riverWidth);

            const lA = pA.pos.clone().multiplyScalar(rad).sub(wRightA);
            const rA = pA.pos.clone().multiplyScalar(rad).add(wRightA);
            
            const lB = pB.pos.clone().multiplyScalar(rad).sub(wRightB);
            const rB = pB.pos.clone().multiplyScalar(rad).add(wRightB);

            // Поверхность русла (фаска на стыке двух тайлов)
            addQuad(lA, rA, rB, lB);

            // Вертикальный водопад "столбик" в случае перепада высот
            if (i < pathData.length - 2) {
                const pC = pathData[i+1];
                if (pC.h_in > pC.h_out) {
                    const radLow = radius + pC.h_out + riverRaise;
                    const wRightLow = pC.right.clone().multiplyScalar(riverWidth);

                    const lLow = pC.pos.clone().multiplyScalar(radLow).sub(wRightLow);
                    const rLow = pC.pos.clone().multiplyScalar(radLow).add(wRightLow);
                    
                    // Формируем вертикальную плоскость, смотрящую по течению
                    addQuad(lB, lLow, rLow, rB);
                }
            }
        }
    }

    return { 
        matte: { pos: mattePositions, col: matteColors }, 
        ice: { pos: icePositions, col: iceColors }, 
        cityGround: { pos: cityGroundPositions, col: cityGroundColors },
        water: { pos: waterPositions, col: waterColors, isFrozen: waterIsFrozen },
        seaIce: { pos: seaIcePositions, col: seaIceColors },
        seaIceSkirt: { pos: seaIceSkirtPositions, col: seaIceSkirtColors },
        trees: { pine: pinePositions, deciduous: decPositions },
        buildings: { boxes: cityBoxPositions, pyramids: cityPyrPositions },
        rivers: { pos: riverPositions } 
    };
}

function buildCloudData(cloudFaces, cloudEdgeMaps) {
    const cloudsByZone = { tropics: {}, temperate: {}, polar: {} };
    
    const _topA = new THREE.Vector3(), _topB = new THREE.Vector3(), _topC = new THREE.Vector3();
    const _botA = new THREE.Vector3(), _botB = new THREE.Vector3(), _botC = new THREE.Vector3();
    const _nTop1 = new THREE.Vector3(), _nTop2 = new THREE.Vector3();
    const _nBot1 = new THREE.Vector3(), _nBot2 = new THREE.Vector3();

    for (const zone of ['tropics', 'temperate', 'polar']) {
        for (const type of ['cumulus', 'rain', 'cirrus']) {
            const faces = cloudFaces[zone][type];
            const edgeMap = cloudEdgeMaps[zone][type];
            if (!faces || faces.length === 0) continue;
            
            const positions = [];
            for (let cIdx = 0; cIdx < faces.length; cIdx++) {
                const c = faces[cIdx];
                
                _topA.set(c.ax, c.ay, c.az).normalize().multiplyScalar(c.cloudTop);
                _topB.set(c.bx, c.by, c.bz).normalize().multiplyScalar(c.cloudTop);
                _topC.set(c.cx, c.cy, c.cz).normalize().multiplyScalar(c.cloudTop);
                
                _botA.set(c.ax, c.ay, c.az).normalize().multiplyScalar(c.cloudBase);
                _botB.set(c.bx, c.by, c.bz).normalize().multiplyScalar(c.cloudBase);
                _botC.set(c.cx, c.cy, c.cz).normalize().multiplyScalar(c.cloudBase);
                
                positions.push(_topA.x, _topA.y, _topA.z, _topB.x, _topB.y, _topB.z, _topC.x, _topC.y, _topC.z);
                positions.push(_botC.x, _botC.y, _botC.z, _botB.x, _botB.y, _botB.z, _botA.x, _botA.y, _botA.z);
                
                const edges = [
                    [c.hA, c.hB, c.ax, c.ay, c.az, c.bx, c.by, c.bz, _topA.x, _topA.y, _topA.z, _topB.x, _topB.y, _topB.z, _botA.x, _botA.y, _botA.z, _botB.x, _botB.y, _botB.z], 
                    [c.hB, c.hC, c.bx, c.by, c.bz, c.cx, c.cy, c.cz, _topB.x, _topB.y, _topB.z, _topC.x, _topC.y, _topC.z, _botB.x, _botB.y, _botB.z, _botC.x, _botC.y, _botC.z], 
                    [c.hC, c.hA, c.cx, c.cy, c.cz, c.ax, c.ay, c.az, _topC.x, _topC.y, _topC.z, _topA.x, _topA.y, _topA.z, _botC.x, _botC.y, _botC.z, _botA.x, _botA.y, _botA.z]
                ];
                
                for (let edge of edges) {
                    let [h1, h2, v1x, v1y, v1z, v2x, v2y, v2z, t1x, t1y, t1z, t2x, t2y, t2z, b1x, b1y, b1z, b2x, b2y, b2z] = edge;
                    let key = h1 < h2 ? h1 + '|' + h2 : h2 + '|' + h1;
                    let neighbors = edgeMap.get(key);
                    
                    let hasNeighbor = false;
                    let nTop = c.cloudTop;
                    let nBot = c.cloudBase;

                    if (neighbors && neighbors.length >= 2) {
                        let nIdx = neighbors[0] === cIdx ? neighbors[1] : neighbors[0];
                        if (nIdx !== undefined) {
                            hasNeighbor = true;
                            nTop = faces[nIdx].cloudTop;
                            nBot = faces[nIdx].cloudBase;
                        }
                    }

                    if (!hasNeighbor) {
                        positions.push(
                            b1x, b1y, b1z, b2x, b2y, b2z, t1x, t1y, t1z,
                            b2x, b2y, b2z, t2x, t2y, t2z, t1x, t1y, t1z
                        );
                    } else {
                        if (c.cloudTop > nTop) {
                            _nTop1.set(v1x, v1y, v1z).normalize().multiplyScalar(nTop);
                            _nTop2.set(v2x, v2y, v2z).normalize().multiplyScalar(nTop);
                            positions.push(
                                _nTop1.x, _nTop1.y, _nTop1.z, _nTop2.x, _nTop2.y, _nTop2.z, t1x, t1y, t1z,
                                _nTop2.x, _nTop2.y, _nTop2.z, t2x, t2y, t2z, t1x, t1y, t1z
                            );
                        }
                        if (c.cloudBase < nBot) {
                            _nBot1.set(v1x, v1y, v1z).normalize().multiplyScalar(nBot);
                            _nBot2.set(v2x, v2y, v2z).normalize().multiplyScalar(nBot);
                            positions.push(
                                b1x, b1y, b1z, b2x, b2y, b2z, _nBot1.x, _nBot1.y, _nBot1.z,
                                b2x, b2y, b2z, _nBot2.x, _nBot2.y, _nBot2.z, _nBot1.x, _nBot1.y, _nBot1.z
                            );
                        }
                    }
                }
            }
            if (positions.length > 0) {
                let geo = new THREE.BufferGeometry();
                geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
                geo.computeVertexNormals();
                cloudsByZone[zone][type] = geo;
            }
        }
    }
    return cloudsByZone;
}

const buildGeo = (posArr, colArr, isSphericalNormal = false, extraAttribName = null, extraAttribData = null) => {
    if (posArr.length === 0) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
    if (colArr) geo.setAttribute('color', new THREE.Float32BufferAttribute(colArr, 3));
    if (extraAttribName && extraAttribData) geo.setAttribute(extraAttribName, new THREE.Float32BufferAttribute(extraAttribData, 1));
    
    if (isSphericalNormal) {
        const sphericalNormals = [];
        for (let k = 0; k < posArr.length; k += 3) {
            let nx = posArr[k], ny = posArr[k+1], nz = posArr[k+2];
            let len = Math.sqrt(nx*nx + ny*ny + nz*nz);
            sphericalNormals.push(nx / len, ny / len, nz / len);
        }
        geo.setAttribute('normal', new THREE.Float32BufferAttribute(sphericalNormals, 3));
    } else {
        geo.computeVertexNormals();
    }
    return geo;
};

export function buildProceduralGeometry(radius, detail, prngSeed, isMoon, genParams) {
    const baseGeo = new THREE.IcosahedronGeometry(radius, detail).toNonIndexed();
    const noiseGens = getNoiseGenerators(prngSeed);
    
    const tileData = computeTileData(baseGeo, noiseGens, radius, isMoon, genParams);
    const landData = buildLandGeometry(tileData, radius, isMoon, prngSeed);
    const cloudsByZone = buildCloudData(tileData.cloudFaces, tileData.cloudEdgeMaps);

    return { 
        matte: buildGeo(landData.matte.pos, landData.matte.col, false), 
        ice: buildGeo(landData.ice.pos, landData.ice.col, false), 
        cityGround: buildGeo(landData.cityGround.pos, landData.cityGround.col, false), 
        water: buildGeo(landData.water.pos, landData.water.col, true, 'aFrozen', landData.water.isFrozen),
        seaIce: buildGeo(landData.seaIce.pos, landData.seaIce.col, true),
        seaIceSkirt: buildGeo(landData.seaIceSkirt.pos, landData.seaIceSkirt.col, false),
        trees: landData.trees,
        buildings: landData.buildings,
        rivers: buildGeo(landData.rivers.pos, null, false),
        cloudsByZone
    };
}

export function getElevationAt(dir, radius, isMoon, prngSeed, genParams) {
    if (prngSeed === null) return radius;
    const { noiseE } = getNoiseGenerators(prngSeed);
    
    const contFreq = genParams?.continents ?? 2.5;
    const islandAmp = genParams?.islands ?? 0.25;
    const waterOffset = CONFIG.generation.waterLevelThreshold - (genParams?.waterLevel ?? CONFIG.generation.waterLevelThreshold);
    const elevSpread = genParams?.elevationSpread ?? 1.0;

    let n1 = noiseE.noise3d(dir.x * contFreq, dir.y * contFreq, dir.z * contFreq) * 0.5 + 0.5;
    let n2 = noiseE.noise3d(dir.x * (contFreq * 2), dir.y * (contFreq * 2), dir.z * (contFreq * 2)) * islandAmp;

    const steps = isMoon ? CONFIG.generation.stepsMoon : CONFIG.generation.stepsPlanet;
    let steppedElevation = computeElevation(n1, n2, isMoon, waterOffset, elevSpread, steps);
    let maxExtrusion = isMoon ? radius * CONFIG.generation.maxExtrusionMoon : radius * CONFIG.generation.maxExtrusionPlanet;

    return radius + steppedElevation * maxExtrusion; 
}