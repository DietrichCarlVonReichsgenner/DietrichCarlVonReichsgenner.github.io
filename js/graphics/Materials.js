import * as THREE from 'three';
import { CONFIG } from '../config.js';

export class MaterialFactory {
    constructor() {
        const offsetSettings = { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 };
        const matCfg = CONFIG.graphics.materials || {};
        const cloudCfg = matCfg.cloud || { cumulus: {}, rain: {}, cirrus: {} };

        this.sunSolid = new THREE.MeshBasicMaterial({ color: 0xffaa00, ...offsetSettings });
        this.sunWire = new THREE.MeshBasicMaterial({ wireframe: true, color: 0xffcc00, transparent: true, opacity: 0.2 });
        
        this.planetMatte = new THREE.MeshStandardMaterial({ 
            vertexColors: true, flatShading: true, 
            roughness: 1.0, metalness: 0.0, ...offsetSettings 
        });

        this.landUniforms = {
            uTime: { value: 0 },
            uWaterRadius: { value: CONFIG.radius.planet + (CONFIG.radius.planet * CONFIG.generation.maxExtrusionPlanet * CONFIG.generation.waterHeightOffset) }
        };

        this.planetMatte.onBeforeCompile = (shader) => {
            shader.uniforms.uTime = this.landUniforms.uTime;
            shader.uniforms.uWaterRadius = this.landUniforms.uWaterRadius;
            
            shader.vertexShader = `
                varying vec3 vLocalPosLand;
                ${shader.vertexShader}
            `.replace(`#include <begin_vertex>`, `
                #include <begin_vertex>
                vLocalPosLand = position;
            `);

            shader.fragmentShader = `
                uniform float uTime;
                uniform float uWaterRadius;
                varying vec3 vLocalPosLand;
                
                float calcCaustic(vec3 p, float t) {
                    p *= 0.04;
                    float a = abs(sin(p.x + t) + cos(p.y - t) + sin(p.z + t));
                    float b = abs(sin(p.x * 1.5 - t * 1.2) + cos(p.y * 1.4 + t * 0.8) + sin(p.z * 1.6 - t * 1.1));
                    return pow(max(0.0, 1.0 - (a + b) * 0.25), 8.0);
                }
                ${shader.fragmentShader}
            `.replace(`#include <color_fragment>`, `
                #include <color_fragment>
                float distCenter = length(vLocalPosLand);
                if (distCenter < uWaterRadius) {
                    float depth = uWaterRadius - distCenter;
                    float fade = smoothstep(0.0, 15.0, depth) * clamp(1.0 - (depth / 200.0), 0.0, 1.0);
                    if (fade > 0.0) {
                        float c = calcCaustic(vLocalPosLand, uTime);
                        diffuseColor.rgb += vec3(0.35, 0.75, 0.95) * c * fade * 1.2;
                    }
                }
            `);
        };
        
        this.planetIce = new THREE.MeshStandardMaterial({ 
            vertexColors: true, flatShading: true, 
            roughness: 0.1, metalness: 0.2, ...offsetSettings 
        });

        this.planetSeaIce = new THREE.MeshStandardMaterial({
            vertexColors: true, transparent: true, opacity: 0.85,
            roughness: 0.8, metalness: 0.0, depthWrite: false, side: THREE.DoubleSide
        });

        this.planetSeaIceSkirt = new THREE.MeshStandardMaterial({
            vertexColors: true, transparent: false,
            roughness: 0.9, metalness: 0.0, side: THREE.DoubleSide
        });

        this.planetRiver = new THREE.MeshStandardMaterial({
            color: 0x3388cc, transparent: true,
            opacity: 0.85, roughness: 0.1, metalness: 0.6,
            depthWrite: false, side: THREE.DoubleSide,
            ...offsetSettings
        });

        this.planetRoad = new THREE.MeshStandardMaterial({
            color: 0x555555, roughness: 0.9, metalness: 0.0,
            depthWrite: false, side: THREE.DoubleSide,
            ...offsetSettings
        });

        this.planetWater = new THREE.MeshStandardMaterial({ 
            color: 0xffffff, vertexColors: true, transparent: true,        
            opacity: 0.75, roughness: 0.1, metalness: 0.6,           
            depthWrite: false, side: THREE.DoubleSide 
        });

        this.waterUniforms = { uTime: { value: 0 } };

        this.planetRiver.onBeforeCompile = (shader) => {
            shader.uniforms.uTime = this.waterUniforms.uTime;
            shader.vertexShader = `
                uniform float uTime;
                varying vec3 vLocalPos;
                ${shader.vertexShader}
            `.replace(`#include <begin_vertex>`, `
                #include <begin_vertex>
                vLocalPos = position;
                float wave = sin(position.x * 0.1 + uTime * 3.0) * cos(position.z * 0.1 + uTime * 3.0);
                transformed += normalize(position) * wave * 1.5;
            `);

            shader.fragmentShader = `
                uniform float uTime;
                varying vec3 vLocalPos;
                ${shader.fragmentShader}
            `.replace(`#include <normal_fragment_begin>`, `
                #include <normal_fragment_begin>
                float t = uTime * 2.0;
                vec3 p = vLocalPos * 0.1;
                vec3 ripple = vec3(sin(p.y + t) * 0.1, cos(p.x - t) * 0.1, sin(p.z + t) * 0.1);
                if (!gl_FrontFacing) ripple = -ripple;
                normal = normalize(normal + ripple);
            `);
        };

        this.planetWater.onBeforeCompile = (shader) => {
            shader.uniforms.uTime = this.waterUniforms.uTime;
            
            shader.vertexShader = `
                uniform float uTime;
                attribute float aFrozen;
                varying vec3 vLocalPos;
                varying float vFrozen;
                ${shader.vertexShader}
            `.replace(`#include <begin_vertex>`, `
                #include <begin_vertex>
                vLocalPos = position;
                vFrozen = aFrozen;
                
                float waveActive = 1.0 - vFrozen;
                float waveSpeed = uTime * 2.0;
                float wave = sin(position.x * 0.015 + waveSpeed) * cos(position.z * 0.015 + waveSpeed) * sin(position.y * 0.015 - waveSpeed);
                vec3 sphereNormal = normalize(position);
                transformed += sphereNormal * (wave * 12.0 + 8.0) * waveActive;
            `);

            shader.fragmentShader = `
                uniform float uTime;
                varying vec3 vLocalPos;
                varying float vFrozen;
                ${shader.fragmentShader}
            `.replace(`#include <normal_fragment_begin>`, `
                #include <normal_fragment_begin>
                float waveActive = 1.0 - vFrozen;
                float t = uTime * 1.5;
                vec3 p = vLocalPos * 0.05;
                vec3 ripple = vec3(sin(p.y + t) * 0.05, cos(p.x - t) * 0.05, sin(p.z + t) * 0.05) * waveActive;
                if (!gl_FrontFacing) ripple = -ripple;
                normal = normalize(normal + ripple);
            `);
        };

        const setupCloudWobble = (material) => {
            material.onBeforeCompile = (shader) => {
                shader.uniforms.uTime = this.waterUniforms.uTime;
                shader.vertexShader = `
                    uniform float uTime;
                    ${shader.vertexShader}
                `.replace(`#include <begin_vertex>`, `
                    #include <begin_vertex>
                    float t = uTime * 0.5;
                    float scale = 0.003;
                    vec3 wobble = vec3(
                        sin(position.x * scale + t) * cos(position.z * scale + t),
                        cos(position.x * scale - t) * sin(position.y * scale + t),
                        sin(position.y * scale + t) * cos(position.x * scale - t)
                    ) * 12.0; 
                    transformed += wobble;
                `);
            };
        };

        this.cloudCumulus = new THREE.MeshStandardMaterial({ color: cloudCfg.cumulus.color || 0xffffff, flatShading: true, transparent: true, opacity: cloudCfg.cumulus.opacity || 0.7, depthWrite: false });
        setupCloudWobble(this.cloudCumulus);
        this.cloudRain = new THREE.MeshStandardMaterial({ color: cloudCfg.rain.color || 0x888888, flatShading: true, transparent: true, opacity: cloudCfg.rain.opacity || 0.8, depthWrite: false });
        setupCloudWobble(this.cloudRain);
        this.cloudCirrus = new THREE.MeshStandardMaterial({ color: cloudCfg.cirrus.color || 0xcceeff, flatShading: true, transparent: true, opacity: cloudCfg.cirrus.opacity || 0.4, depthWrite: false });
        setupCloudWobble(this.cloudCirrus);

        this.pineMaterial = new THREE.MeshStandardMaterial({ color: 0x224422, roughness: 0.9, flatShading: true, ...offsetSettings });
        this.deciduousMaterial = new THREE.MeshStandardMaterial({ color: 0x3d6e24, roughness: 0.8, flatShading: true, ...offsetSettings });

        this.planetWire = new THREE.MeshBasicMaterial({ wireframe: true, color: 0x555555, transparent: true, opacity: 0.2 });
        this.moonWire = new THREE.MeshBasicMaterial({ wireframe: true, color: 0xaaaaaa, transparent: true, opacity: 0.2 });
        this.moonSolid = new THREE.MeshStandardMaterial({ color: matCfg.moon?.color || 0xffffff, flatShading: true, vertexColors: true, ...offsetSettings });
        this.starsMaterial = new THREE.PointsMaterial({ size: 1.5, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.9 });

        this.cityMaterial = new THREE.MeshStandardMaterial(CONFIG.graphics.materials.city);
        this.cityGroundMaterial = new THREE.MeshStandardMaterial(CONFIG.graphics.materials.cityGround);
        this.cityGroundMaterial.vertexColors = true; 

        this.suburbMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x999999, roughness: 0.9, metalness: 0.1, 
            emissive: 0xffdd88, emissiveIntensity: 0.6 
        });

        this.nightLightUniforms = { uSunPos: { value: new THREE.Vector3() } };
        const injectNightLights = (shader) => {
            shader.uniforms.uSunPos = this.nightLightUniforms.uSunPos;
            shader.vertexShader = `varying vec3 vWorldPosOut;\n` + shader.vertexShader;
            shader.vertexShader = shader.vertexShader.replace(
                '#include <worldpos_vertex>',
                `#include <worldpos_vertex>\n vWorldPosOut = worldPosition.xyz;`
            );
            shader.fragmentShader = `varying vec3 vWorldPosOut;\nuniform vec3 uSunPos;\n` + shader.fragmentShader;
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <emissivemap_fragment>',
                `#include <emissivemap_fragment>
                vec3 surfaceNormal = normalize(vWorldPosOut);
                vec3 sunDir = normalize(uSunPos);
                float nightMask = smoothstep(0.1, -0.2, dot(surfaceNormal, sunDir));
                totalEmissiveRadiance *= nightMask;`
            );
        };
        
        this.cityMaterial.onBeforeCompile = injectNightLights;
        this.suburbMaterial.onBeforeCompile = injectNightLights;

        this.carMaterial = new THREE.MeshStandardMaterial({
            color: 0xffffff, roughness: 0.4, metalness: 0.6,
            ...offsetSettings
        });

        this.carMaterial.onBeforeCompile = (shader) => {
            shader.uniforms.uTime = this.waterUniforms.uTime;
            shader.vertexShader = `
                uniform float uTime;
                attribute float aDistance;
                attribute float aOffset;
                attribute float aSpeed;
                ${shader.vertexShader}
            `.replace(`#include <begin_vertex>`, `
                #include <begin_vertex>
                float progress = fract(uTime * aSpeed + aOffset);
                transformed.z -= progress * aDistance;
            `);
            shader.fragmentShader = shader.fragmentShader.replace(
                `#include <emissivemap_fragment>`,
                `#include <emissivemap_fragment>
                #ifdef USE_INSTANCING
                    totalEmissiveRadiance += vColor.rgb * 2.0; 
                #endif
                `
            );
        };

        this.weatherUniforms = {
            uTime: { value: 0 },
            uCenter: { value: new THREE.Vector3() },
            uRadius: { value: 1500.0 },
            uOpacityRain: { value: 0.0 },
            uOpacitySnow: { value: 0.0 }
        };

        this.weatherRain = new THREE.ShaderMaterial({
            uniforms: this.weatherUniforms, transparent: true, depthWrite: false, blending: THREE.NormalBlending,
            vertexShader: `
                uniform float uTime; uniform vec3 uCenter; uniform float uRadius;
                vec3 boxWrap(vec3 p, float r) { vec3 size = vec3(r * 2.0); return p - size * floor((p + r) / size); }
                void main() {
                    vec3 localPos = position * uRadius * 2.0; vec3 up = normalize(uCenter); float speed = 2500.0;
                    vec3 offset = -up * (uTime * speed + localPos.y * 1000.0); vec3 finalPos = uCenter + boxWrap(localPos + offset, uRadius);
                    vec4 mvPosition = modelViewMatrix * vec4(finalPos, 1.0); gl_Position = projectionMatrix * mvPosition; 
                    gl_PointSize = 1500.0 / max(0.1, -mvPosition.z);
                }
            `,
            fragmentShader: `
                uniform float uOpacityRain;
                void main() {
                    if (uOpacityRain <= 0.01) discard; vec2 pt = gl_PointCoord - vec2(0.5);
                    if (abs(pt.x) > 0.08 || abs(pt.y) > 0.45) discard; gl_FragColor = vec4(0.7, 0.8, 1.0, uOpacityRain * 0.6);
                }
            `
        });

        this.weatherSnow = new THREE.ShaderMaterial({
            uniforms: this.weatherUniforms, transparent: true, depthWrite: false, blending: THREE.NormalBlending,
            vertexShader: `
                uniform float uTime; uniform vec3 uCenter; uniform float uRadius;
                vec3 boxWrap(vec3 p, float r) { vec3 size = vec3(r * 2.0); return p - size * floor((p + r) / size); }
                void main() {
                    vec3 localPos = position * uRadius * 2.0; vec3 up = normalize(uCenter); float speed = 400.0;
                    vec3 right = normalize(cross(up, vec3(0.0, 1.0, 0.0))); if (length(right) < 0.1) right = normalize(cross(up, vec3(1.0, 0.0, 0.0)));
                    vec3 forward = cross(right, up); vec3 drift = right * sin(uTime * 2.0 + localPos.x * 10.0) * 100.0 + forward * cos(uTime * 2.0 + localPos.z * 10.0) * 100.0;
                    vec3 offset = -up * (uTime * speed + localPos.y * 500.0) + drift; vec3 finalPos = uCenter + boxWrap(localPos + offset, uRadius);
                    vec4 mvPosition = modelViewMatrix * vec4(finalPos, 1.0); gl_Position = projectionMatrix * mvPosition; 
                    gl_PointSize = 2500.0 / max(0.1, -mvPosition.z);
                }
            `,
            fragmentShader: `
                uniform float uOpacitySnow;
                void main() {
                    if (uOpacitySnow <= 0.01) discard; vec2 pt = gl_PointCoord - vec2(0.5); float dist = length(pt); if (dist > 0.5) discard;
                    float alpha = smoothstep(0.5, 0.2, dist) * uOpacitySnow * 0.9; gl_FragColor = vec4(1.0, 1.0, 1.0, alpha);
                }
            `
        });

        this.atmosphereUniforms = {
            uSunDirection: { value: new THREE.Vector3(1, 0, 0) },
            uIntensity: { value: CONFIG.graphics.defaultAtmosInt || 1.2 },
            uPlanetRadius: { value: CONFIG.radius.planet },
            uAtmosRadius: { value: CONFIG.radius.planet * 1.25 } 
        };

        this.atmosphereMaterial = new THREE.ShaderMaterial({
            uniforms: this.atmosphereUniforms,
            transparent: true, side: THREE.BackSide, depthWrite: false,
            vertexShader: `
                varying vec3 vWorldPosition;
                void main() {
                    vec4 worldPos = modelMatrix * vec4(position, 1.0);
                    vWorldPosition = worldPos.xyz;
                    gl_Position = projectionMatrix * viewMatrix * worldPos;
                }
            `,
            fragmentShader: `
                uniform vec3 uSunDirection; uniform float uIntensity; uniform float uPlanetRadius; uniform float uAtmosRadius;
                varying vec3 vWorldPosition;

                vec2 raySphereIntersect(vec3 r0, vec3 rd, float radius) {
                    float b = dot(r0, rd); float c = dot(r0, r0) - radius * radius; float d = b * b - c;
                    if (d < 0.0) return vec2(-1.0); float sd = sqrt(d); return vec2(-b - sd, -b + sd);
                }

                void main() {
                    vec3 rayOrigin = cameraPosition; vec3 rayDir = normalize(vWorldPosition - cameraPosition);
                    vec2 atmosDist = raySphereIntersect(rayOrigin, rayDir, uAtmosRadius);
                    if (atmosDist.y < 0.0) discard;

                    float startDist = max(0.0, atmosDist.x); float endDist = atmosDist.y;
                    vec2 planetDist = raySphereIntersect(rayOrigin, rayDir, uPlanetRadius);
                    if (planetDist.x > 0.0) endDist = min(endDist, planetDist.x);

                    float sampleLength = endDist - startDist; if (sampleLength <= 0.0) discard;

                    vec3 samplePoint = rayOrigin + rayDir * (startDist + sampleLength * 0.5);
                    vec3 sampleNormal = normalize(samplePoint);

                    float sunDot = max(0.0, dot(sampleNormal, uSunDirection));
                    float viewSunDot = dot(rayDir, uSunDirection);

                    float rayleighPhase = 0.75 * (1.0 + viewSunDot * viewSunDot);
                    vec3 rayleighColor = vec3(0.18, 0.48, 1.0) * rayleighPhase;

                    float g = -0.76;
                    float miePhase = 1.5 * ((1.0 - g * g) / (2.0 + g * g)) * (1.0 + viewSunDot * viewSunDot) / pow(1.0 + g * g - 2.0 * g * viewSunDot, 1.5);
                    vec3 mieColor = vec3(1.0, 0.88, 0.72) * miePhase;

                    float thickness = uAtmosRadius - uPlanetRadius;
                    float altitude = max(0.0, length(samplePoint) - uPlanetRadius);
                    float density = exp(-altitude / (thickness * 0.3));
                    float normLength = sampleLength / thickness;

                    vec3 finalScattering = (rayleighColor * 1.6 + mieColor * 0.4) * sunDot * density * normLength * uIntensity;
                    finalScattering = clamp(finalScattering, 0.0, 1.0);
                    float alpha = smoothstep(0.0, 0.18, length(finalScattering));

                    gl_FragColor = vec4(finalScattering, alpha);
                }
            `
        });
    }

    updateTime(time) { 
        this.waterUniforms.uTime.value = time; 
        if (this.landUniforms) this.landUniforms.uTime.value = time;
        if (this.weatherUniforms) this.weatherUniforms.uTime.value = time;
    }
    updateSunPosition(pos) { this.atmosphereUniforms.uSunDirection.value.copy(pos.clone().normalize()); }
}