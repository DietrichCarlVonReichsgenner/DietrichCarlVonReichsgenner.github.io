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
    const reqRiverCount = genParams?.riverCount ?? CONFIG.generation.riverCount;
    
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

    const landCandidateIndices = [];

    const _vA = new THREE.Vector3();
    const _vB = new THREE.Vector3();
    const _vC = new THREE.Vector3();
    const _center = new THREE.Vector3();
    const _dir = new THREE.Vector3();
    const _colorObj = new THREE.Color();
    const _lerpColor = new THREE.Color(0x999988);

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
            ax: _vA.x, ay: _vA.y, az: _vA.z, bx: _vB.x, by: _vB.y, bz: _vB.z, cx: _vC.x, cy: _vC.y, cz: _vC.z,
            midX: _center.x, midY: _center.y, midZ: _center.z,
            h, isLandIce, isSeaIce, isSubmerged, temp, moisture, steppedElevation,
            r: _colorObj.r, g: _colorObj.g, b: _colorObj.b,
            sr: _colorObj.r * 0.6, sg: _colorObj.g * 0.6, sb: _colorObj.b * 0.6,
            isCity: false, isSuburb: false
        });

        const addEdge = (h1, h2, fIdx, map) => {
            let key = h1 < h2 ? h1 + '|' + h2 : h2 + '|' + h1;
            let arr = map.get(key);
            if (!arr) { arr = []; map.set(key, arr); }
            arr.push(fIdx);
        };
        
        addEdge(hA, hB, faceIndex, edgeMap); addEdge(hB, hC, faceIndex, edgeMap); addEdge(hC, hA, faceIndex, edgeMap);

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
            
            let suburbCandidates = [];
            for (let c of cluster) {
                for (let n of adjacency[c]) {
                    if (!faceData[n].isCity && !faceData[n].isSubmerged && faceData[n].steppedElevation < 0.75) {
                        suburbCandidates.push(n);
                    }
                }
            }
            for (let n of suburbCandidates) {
                if (prng() < 0.6 && !faceData[n].isSuburb) {
                    faceData[n].isSuburb = true;
                    faceData[n].r = 0.55; faceData[n].g = 0.55; faceData[n].b = 0.55;
                }
            }
            
            citySeeds.push(seedIdx);
            clustersPlaced++;
        }

        let numVillages = reqCityCount * 2;
        for(let i=0; i<numVillages; i++) {
            let idx = landCandidateIndices[Math.floor(prng() * landCandidateIndices.length)];
            if(!faceData[idx].isCity && !faceData[idx].isSuburb) {
                faceData[idx].isSuburb = true;
                faceData[idx].r = 0.55; faceData[idx].g = 0.55; faceData[idx].b = 0.55;
            }
        }
    }

    const riverPaths = [];
    if (!isMoon && reqRiverCount > 0) {
        const mountainTiles = [];
        for (let i = 0; i < faceData.length; i++) {
            if (!faceData[i].isSubmerged && faceData[i].steppedElevation > 0.55) {
                mountainTiles.push(i);
            }
        }
        
        for (let i = mountainTiles.length - 1; i > 0; i--) {
            const j = Math.floor(prng() * (i + 1));
            [mountainTiles[i], mountainTiles[j]] = [mountainTiles[j], mountainTiles[i]];
        }

        const visitedTiles = new Set();
        const maxRivers = Math.min(reqRiverCount, mountainTiles.length);

        for (let i = 0; i < maxRivers; i++) {
            let curr = mountainTiles[i];
            if (visitedTiles.has(curr)) continue;
            
            let path = [curr];
            let reachedSea = false;
            
            while (path.length < 300) {
                visitedTiles.add(curr);
                
                let neighbors = adjacency[curr];
                let bestNeighbor = -1;
                let minH = faceData[curr].h;
                
                for (let n of neighbors) {
                    if (!visitedTiles.has(n) && faceData[n].h < minH) {
                        minH = faceData[n].h;
                        bestNeighbor = n;
                    }
                }
                
                if (bestNeighbor === -1) {
                    let equalNeighbors = neighbors.filter(n => !visitedTiles.has(n) && Math.abs(faceData[n].h - faceData[curr].h) < 0.0001);
                    if (equalNeighbors.length > 0) {
                        bestNeighbor = equalNeighbors[Math.floor(prng() * equalNeighbors.length)];
                    }
                }

                if (bestNeighbor === -1) {
                    break; 
                }
                
                curr = bestNeighbor;
                path.push(curr);
                
                if (faceData[curr].isSubmerged) {
                    reachedSea = true;
                    break; 
                }
            }
            
            if (reachedSea && path.length > 2) {
                riverPaths.push(path);
            }
        }
    }

    const roadPaths = [];
    if (!isMoon && citySeeds.length > 1) {
        for (let i = 0; i < citySeeds.length; i++) {
            let start = citySeeds[i];
            let targets = [citySeeds[(i + 1) % citySeeds.length]];
            if (citySeeds.length > 3 && prng() > 0.5) {
                targets.push(citySeeds[(i + Math.floor(prng()*(citySeeds.length-1)) + 1) % citySeeds.length]);
            }
            
            for (let target of targets) {
                let q = [start];
                let cameFrom = new Map();
                cameFrom.set(start, null);
                let found = false;
                while(q.length > 0) {
                    let curr = q.shift();
                    if(curr === target) { found = true; break; }
                    for(let n of adjacency[curr]) {
                        if(!cameFrom.has(n) && !faceData[n].isSubmerged && faceData[n].steppedElevation < 0.8) {
                            cameFrom.set(n, curr);
                            q.push(n);
                        }
                    }
                }
                if(found) {
                    let path = [];
                    let curr = target;
                    while(curr !== null) {
                        path.push(curr);
                        curr = cameFrom.get(curr);
                    }
                    path.reverse();
                    roadPaths.push(path);
                }
            }
        }
    }

    return { faceData, edgeMap, cloudFaces, cloudEdgeMaps, maxExtrusion, riverPaths, roadPaths };
}

function buildStripGeometry(pathsArr, width, raiseOffset, radius) {
    const positions = [];
    const addQuad = (l1, r1, r2, l2) => {
        positions.push(
            l1.x, l1.y, l1.z, r1.x, r1.y, r1.z, r2.x, r2.y, r2.z,
            r2.x, r2.y, r2.z, l2.x, l2.y, l2.z, l1.x, l1.y, l1.z
        );
    };
    for (const path of pathsArr) {
        if (path.length < 2) continue;
        let pathData = [];
        for (let i = 0; i < path.length; i++) {
            let node = path[i];
            let pos = node.pos.clone().normalize();
            
            let d_in = i > 0 ? pos.clone().sub(path[i-1].pos.clone().normalize()).normalize() : null;
            let d_out = i < path.length - 1 ? path[i+1].pos.clone().normalize().sub(pos).normalize() : null;
            
            let tangent = new THREE.Vector3();
            if (d_in && d_out) {
                tangent.addVectors(d_in, d_out);
                if (tangent.lengthSq() < 0.0001) tangent.copy(d_in);
                tangent.normalize();
            } else if (d_in) tangent.copy(d_in);
            else if (d_out) tangent.copy(d_out);
            else tangent.set(1, 0, 0);

            let right = new THREE.Vector3().crossVectors(tangent, pos);
            if (right.lengthSq() < 0.0001) right.set(0, 1, 0).cross(pos);
            right.normalize();
            
            pathData.push({ pos, right, h: node.h });
        }
        
        for (let i = 0; i < pathData.length - 1; i++) {
            let pA = pathData[i], pB = pathData[i+1];
            let radA = radius + pA.h + raiseOffset;
            let radB = radius + pB.h + raiseOffset;
            
            let wA = pA.right.clone().multiplyScalar(width);
            let wB = pB.right.clone().multiplyScalar(width);
            
            addQuad(
                pA.pos.clone().multiplyScalar(radA).sub(wA),
                pA.pos.clone().multiplyScalar(radA).add(wA),
                pB.pos.clone().multiplyScalar(radB).add(wB),
                pB.pos.clone().multiplyScalar(radB).sub(wB)
            );
        }
    }
    return positions;
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
    const suburbBoxPositions = [];
    
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
                    const neighbor = neighbors ? tileData.faceData[neighbors[0] === fIdx ? neighbors[1] : neighbors[0]] : null;
                    
                    if (neighbor && neighbor.isSubmerged && !neighbor.isSeaIce) {
                        const bot1 = new THREE.Vector3(v1x, v1y, v1z).normalize().multiplyScalar(skirtBot);
                        const bot2 = new THREE.Vector3(v2x, v2y, v2z).normalize().multiplyScalar(skirtBot);

                        for (let k = 0; k < 6; k++) seaIceSkirtColors.push(...skirtColor);
                        seaIceSkirtPositions.push(
                            top1.x, top1.y, top1.z, top2.x, top2.y, top2.z, bot1.x, bot1.y, bot1.z,
                            top2.x, top2.y, top2.z, bot2.x, bot2.y, bot2.z, bot1.x, bot1.y, bot1.z
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
                let buildingCount = 8 + Math.floor(prng() * 8); 
                for (let i = 0; i < buildingCount; i++) {
                    let r1 = prng(), r2 = prng();
                    if (r1 + r2 > 1) { r1 = 1 - r1; r2 = 1 - r2; }
                    let r3 = 1 - r1 - r2;
                    let tx = _eA.x * r1 + _eB.x * r2 + _eC.x * r3;
                    let ty = _eA.y * r1 + _eB.y * r2 + _eC.y * r3;
                    let tz = _eA.z * r1 + _eB.z * r2 + _eC.z * r3;
                    
                    let scaleHeight = 0.8 + prng() * 3.5;
                    let rot = prng() * Math.PI;
                    if (prng() > 0.3) cityBoxPositions.push(tx, ty, tz, scaleHeight, rot);
                    else cityPyrPositions.push(tx, ty, tz, scaleHeight, rot);
                }
            } else if (f.isSuburb) {
                let buildingCount = 3 + Math.floor(prng() * 4); 
                for (let i = 0; i < buildingCount; i++) {
                    let r1 = prng(), r2 = prng();
                    if (r1 + r2 > 1) { r1 = 1 - r1; r2 = 1 - r2; }
                    let r3 = 1 - r1 - r2;
                    let tx = _eA.x * r1 + _eB.x * r2 + _eC.x * r3;
                    let ty = _eA.y * r1 + _eB.y * r2 + _eC.y * r3;
                    let tz = _eA.z * r1 + _eB.z * r2 + _eC.z * r3;
                    
                    let scaleHeight = 0.5 + prng() * 1.0; 
                    let rot = prng() * Math.PI;
                    suburbBoxPositions.push(tx, ty, tz, scaleHeight, rot);
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
        if (f.isCity || f.isSuburb) { targetPos = cityGroundPositions; targetCol = cityGroundColors; }
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
                
                let sColorBase = new THREE.Color(f.sr, f.sg, f.sb);
                for(let k=0; k<6; k++) targetCol.push(sColorBase.r, sColorBase.g, sColorBase.b);
            }
        }
    }
    
    const getSharedEdgeMid = (f1, f2) => {
        const p1 = [{x:f1.ax, y:f1.ay, z:f1.az}, {x:f1.bx, y:f1.by, z:f1.bz}, {x:f1.cx, y:f1.cy, z:f1.cz}];
        const p2 = [{x:f2.ax, y:f2.ay, z:f2.az}, {x:f2.bx, y:f2.by, z:f2.bz}, {x:f2.cx, y:f2.cy, z:f2.cz}];
        const isSame = (v1, v2) => Math.abs(v1.x-v2.x)<0.001 && Math.abs(v1.y-v2.y)<0.001 && Math.abs(v1.z-v2.z)<0.001;
        let shared = [];
        for(let v1 of p1) {
            for(let v2 of p2) {
                if(isSame(v1, v2)) shared.push(v1);
            }
        }
        if(shared.length >= 2) {
            return new THREE.Vector3((shared[0].x + shared[1].x)*0.5, (shared[0].y + shared[1].y)*0.5, (shared[0].z + shared[1].z)*0.5);
        }
        return null;
    }

    const riverPathsNodes = [];
    if (tileData.riverPaths) {
        for (let path of tileData.riverPaths) {
            let nodes = [];
            for (let i = 0; i < path.length; i++) {
                let f = tileData.faceData[path[i]];
                nodes.push({ pos: new THREE.Vector3(f.midX, f.midY, f.midZ), h: f.h });
                if (i < path.length - 1) {
                    let fNext = tileData.faceData[path[i+1]];
                    let mid = getSharedEdgeMid(f, fNext);
                    if (mid) nodes.push({ pos: mid, h: Math.max(f.h, fNext.h) });
                }
            }
            riverPathsNodes.push(nodes);
        }
    }
    const riverPositions = buildStripGeometry(riverPathsNodes, radius * 0.0035, tileData.maxExtrusion * 0.005, radius);

    const roadPathsNodes = [];
    const carData = []; 

    if (tileData.roadPaths) {
        for (let path of tileData.roadPaths) {
            let nodes = [];
            for (let i = 0; i < path.length; i++) {
                let f = tileData.faceData[path[i]];
                nodes.push({ pos: new THREE.Vector3(f.midX, f.midY, f.midZ), h: f.h });
                if (i < path.length - 1) {
                    let fNext = tileData.faceData[path[i+1]];
                    let mid = getSharedEdgeMid(f, fNext);
                    if (mid) nodes.push({ pos: mid, h: Math.max(f.h, fNext.h) });
                }
            }
            roadPathsNodes.push(nodes);
        }

        for (let path of roadPathsNodes) {
            for (let i = 0; i < path.length - 1; i++) {
                let pA = path[i].pos.clone().normalize().multiplyScalar(radius + path[i].h + tileData.maxExtrusion * 0.015);
                let pB = path[i+1].pos.clone().normalize().multiplyScalar(radius + path[i+1].h + tileData.maxExtrusion * 0.015);
                
                let dist = pA.distanceTo(pB);
                let numCars = Math.floor(dist / 40) + (prng() < (dist/40 % 1) ? 1 : 0);
                
                for(let c = 0; c < numCars; c++) {
                    carData.push({
                        pA, pB, dist,
                        offset: prng(),
                        speed: (0.1 + prng() * 0.05) * (prng() > 0.5 ? 1 : -1)
                    });
                }
            }
        }
    }
    const roadPositions = buildStripGeometry(roadPathsNodes, radius * 0.0025, tileData.maxExtrusion * 0.015, radius);

    return { 
        matte: buildGeo(mattePositions, matteColors, false), 
        ice: buildGeo(icePositions, iceColors, false), 
        cityGround: buildGeo(cityGroundPositions, cityGroundColors, false), 
        water: buildGeo(waterPositions, waterColors, true, 'aFrozen', waterIsFrozen),
        seaIce: buildGeo(seaIcePositions, seaIceColors, true),
        seaIceSkirt: buildGeo(seaIceSkirtPositions, seaIceSkirtColors, false),
        trees: { pine: pinePositions, deciduous: decPositions },
        buildings: { boxes: cityBoxPositions, pyramids: cityPyrPositions },
        suburbs: { boxes: suburbBoxPositions },
        rivers: buildGeo(riverPositions, null, false),
        roads: buildGeo(roadPositions, null, false),
        cars: carData,
        cloudsByZone: buildCloudData(tileData.cloudFaces, tileData.cloudEdgeMaps)
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
    if (posArr === null || posArr.length === 0) return null;
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

    return { 
        matte: landData.matte, 
        ice: landData.ice, 
        cityGround: landData.cityGround, 
        water: landData.water,
        seaIce: landData.seaIce,
        seaIceSkirt: landData.seaIceSkirt,
        trees: landData.trees,
        buildings: landData.buildings,
        suburbs: landData.suburbs,
        rivers: landData.rivers,
        roads: landData.roads,
        cars: landData.cars,
        cloudsByZone: landData.cloudsByZone
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