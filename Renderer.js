import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CONFIG } from '../config.js';

export class Renderer {
    constructor(scene, camera) {
        this.webgl = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
        this.webgl.setSize(window.innerWidth, window.innerHeight);
        this.webgl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        
        this.webgl.toneMapping = THREE.ACESFilmicToneMapping;
        this.webgl.toneMappingExposure = 1.0;
        
        this.webgl.shadowMap.enabled = true;
        this.webgl.shadowMap.type = THREE.PCFSoftShadowMap; 
        
        document.body.appendChild(this.webgl.domElement);

        this.composer = new EffectComposer(this.webgl);
        this.composer.addPass(new RenderPass(scene, camera));
        
        const b = CONFIG.graphics.bloom;
        this.bloomPass = new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight), 
            b.strength, b.radius, b.threshold
        );
        this.composer.addPass(this.bloomPass);

        this.outputPass = new OutputPass();
        this.composer.addPass(this.outputPass);
    }

    setBloomStrength(val) { this.bloomPass.strength = val; }
    setBloomThreshold(val) { this.bloomPass.threshold = val; }

    resize(camera) {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        this.webgl.setSize(window.innerWidth, window.innerHeight);
        this.composer.setSize(window.innerWidth, window.innerHeight);
    }

    render() {
        // ИСПРАВЛЕНИЕ СЧЕТЧИКА: Запрещаем сброс метрик между пассами EffectComposer
        this.webgl.info.autoReset = false;
        this.webgl.info.reset(); // Ручной сброс в начале кадра
        this.composer.render();
    }
}