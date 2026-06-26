import { CONFIG } from '../config.js';

export const BODY_TYPES = {
    planet: { 
        getGroup: (ss) => ss.planetGroup, 
        radius: (cfg) => cfg.radius.planet, 
        isMoon: false, 
        getSeed: (state) => state.seed, 
        hasWater: true, 
        physics: (cfg) => ({ gravity: cfg.physics.planetGravity, jumpSpeed: cfg.physics.planetJumpSpeed }) 
    },
    moon: { 
        getGroup: (ss) => ss.moonGroup, 
        radius: (cfg) => cfg.radius.moon,
        isMoon: true,  
        getSeed: (state) => state.seed + 999, 
        hasWater: false, 
        physics: (cfg) => ({ gravity: cfg.physics.moonGravity, jumpSpeed: cfg.physics.moonJumpSpeed }) 
    },
    sun: { 
        getGroup: (ss) => ss.sunGroup,  
        radius: (cfg) => cfg.radius.sun,
        isMoon: false, 
        getSeed: () => null,
        hasWater: false, 
        physics: (cfg) => ({ gravity: cfg.physics.sunGravity, jumpSpeed: cfg.physics.sunJumpSpeed }) 
    }
};