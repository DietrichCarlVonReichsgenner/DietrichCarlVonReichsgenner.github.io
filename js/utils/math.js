import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';

export function mulberry32(a) {
    return function() {
        var t = a += 0x6D2B79F5;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
}

export function createNoiseGenerator(seed) {
    const prng = mulberry32(seed);
    return new SimplexNoise({ random: prng });
}