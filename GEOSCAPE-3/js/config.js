export const CONFIG = {
    defaultSeed: 123456,
    baseTimeMultiplier: 1,
    asyncGeneration: true,
    generationDebounceMs: 500,

    generation: {
        waterLevel: 0.4,    
        continents: 2.5,    
        islands: 0.25,
        elevationSpread: 1.0, 
        globalTemp: 0.0,      
        globalMoisture: 0.0,
        cloudStandard: 0.5,
        cloudRain: 0.3,
        cloudCirrus: 0.4,
        cityCount: 15,          
        riverCount: 10,         
        maxExtrusionPlanet: 0.08,
        maxExtrusionMoon: 0.04,
        waterLevelThreshold: 0.4,
        iceTempThreshold: 0.15,
        stepsPlanet: 8,
        stepsMoon: 4,
        waterHeightOffset: 0.402,
        
        clouds: {
            enabled: true,
            castShadow: true,
            hadleyCells: {
                tropics: { speed: -0.012, limit: 30 },
                temperate: { speed: 0.008, limit: 60 },
                polar: { speed: -0.004, limit: 90 }
            },
            types: {
                cumulus: { density: 0.40, height: 1.20, thickness: 0.12, noiseScale: 2.0,
                           color: 0xffffff, opacity: 0.70, roughness: 0.70, metalness: 0.0 },
                rain:    { density: 0.35, height: 1.10, thickness: 0.20, noiseScale: 2.2,
                           color: 0x888888, opacity: 0.85, roughness: 0.85, metalness: 0.0 },
                cirrus:  { density: 0.30, height: 1.55, thickness: 0.06, noiseScale: 2.5,
                           color: 0xcceeff, opacity: 0.45, roughness: 0.60, metalness: 0.0 }
            }
        }
    },

    graphics: {
        wireframeGlow: { sun: true, planet: false, moon: false },
        bloom: { strength: 1.0, radius: 0.6, threshold: 1.0 },
        lighting: { sun: 5.0, moon: 0.2, ambient: 0.02 },
        defaultAtmosInt: 0.8,
        stars: { count: 10000, distance: 400000000 },
        atmosphereLogDepth: true,
        
        shadow: {
            mapSize: 2048,
            bias: -0.0001,
            normalBias: 0.05,
            near: 1.5,
            far: 6.0,
            frustumSize: 1.15
        },
        
        materials: {
            matte: { color: 0xffffff, roughness: 1.0, metalness: 0.0 },
            ice:   { color: 0xffffff, roughness: 0.4, metalness: 0.0 },
            water: { color: 0xffffff, roughness: 0.3, metalness: 0.0, transmission: 0.6, ior: 1.333, opacity: 0.8 },
            moon:  { color: 0xffffff, roughness: 1.0, metalness: 0.0 },
            city:       { color: 0x777777, roughness: 0.9, metalness: 0.2, emissive: 0xffaa00, emissiveIntensity: 1.2 },
            cityGround: { color: 0x666666, roughness: 1.0, metalness: 0.0 }, // Убрано свечение
            cloud: {
                cumulus: { color: 0xffffff, roughness: 0.7, metalness: 0.0, opacity: 0.70 },
                rain:    { color: 0x888888, roughness: 0.85, metalness: 0.0, opacity: 0.85 },
                cirrus:  { color: 0xcceeff, roughness: 0.6, metalness: 0.0, opacity: 0.45 }
            }
        }
    },

    radius: { planet: 5000, moon: 1500, sun: 500000 },
    
    physics: {
        fixedTimestep: 1 / 60,
        orbitRadiusSun: 100000000, orbitRadiusMoon: 200000,
        orbitSpeedSun: 0.01, orbitSpeedMoon: 0.08,
        rotationSpeedPlanet: 0.05, rotationSpeedMoon: 0.02,
        
        planetGravity: 1200.0,
        planetJumpSpeed: 500.0,
        moonGravity: 200.0,
        moonJumpSpeed: 150.0,
        sunGravity: 0.0,
        sunJumpSpeed: 0.0,
        
        player: {
            stepHeight: 35.0,
            waterDrag: 0.85,
            waterBuoyancy: 300.0,
            groundCheckDistance: 25.0,
            collisionRadius: 18.0
        },

        vehicle: {
            collisionRadius: 15.0,       // Радиус коллизии корпуса корабля
            boardingRadius: 150.0,       // Расстояние посадки в кабину
            groundFriction: 0.8,         // Трение о рельеф при приземлении
            waterFriction: 0.95,         // Гидродинамическое сопротивление
            atmosphericDrag: 0.98,       // Аэродинамическое сопротивление
            thrustAcceleration: 8000.0,  // Дельта тяги за секунду
            maxThrust: 15000.0,          // Максимальная тяга
            pitchRate: 2.0,              // Скорость тангажа (рад/с)
            yawRate: 2.0,                // Скорость рысканья (рад/с)
            rollRate: 3.0                // Скорость крена (рад/с)
        },

        spawnDropHeight: 2000.0,         // Высота десантирования над пиком

        camera: {
            playerFollowUp: 100.0,       // Смещение камеры вверх от игрока
            playerFollowBack: 200.0      // Смещение камеры назад от игрока
        }
    },
    
    camera: {
        near: 100, far: 500000000,
        focusOffsets: {
            planet: { x: 0, y: 15000, z: 30000 },
            moon: { x: 0, y: 3000, z: 6000 },
            sun: { x: 0, y: 1000000, z: 2000000 }
        }
    },
    lod: {
        planet: [
            { distance: 0, detail: 32, atmosDetail: 32, cloudDetail: 32 },
            { distance: 100000, detail: 16, atmosDetail: 16, cloudDetail: 16 },
            { distance: 500000, detail: 8, atmosDetail: 8, cloudDetail: 8 }
        ],
        moon: [
            { distance: 0, detail: 32 },
            { distance: 50000, detail: 16 },
            { distance: 300000, detail: 3 }
        ],
        sun: [
            { distance: 0, detail: 5 },
            { distance: 20000000, detail: 4 },
            { distance: 80000000, detail: 2 }
        ]
    },
    
    performance: {
        mobileReduction: true,
        targetFPS: 30,
        mobileLodFactor: 0.5
    }
};