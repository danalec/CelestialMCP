import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { parse } from 'csv-parse';
import * as Astronomy from 'astronomy-engine';

// No custom class needed - we'll use our own calculations for fixed stars

// Define interfaces for coordinates
export interface EquatorialCoordinates {
  rightAscension: number; // in hours
  declination: number; // in degrees
  magnitude?: number;     // Visual magnitude
  name?: string;          // Canonical name (e.g., proper name, catalog ID like 'M31', 'HIP 12345')
  commonName?: string;    // Common name, if different from 'name' (used more for DSOs)
  type?: string;          // e.g., 'Star', 'Galaxy', 'Planet'
  constellation?: string; // IAU constellation code/name when available
}

export interface HorizontalCoordinates {
  altitude: number; // in degrees
  azimuth: number; // in degrees
}

export interface Observer {
  latitude: number; // in degrees, positive north
  longitude: number; // in degrees, positive east
  elevation: number; // in meters above sea level
  temperature: number; // in celsius
  pressure: number; // in hPa
}

// Catalogs to store loaded data
export const DSO_CATALOG: Map<string, EquatorialCoordinates> = new Map();
export const STAR_CATALOG: Map<string, EquatorialCoordinates> = new Map();
export const COMMON_NAMES: Map<string, string> = new Map(); // Maps common names to catalog IDs

export const SOLAR_SYSTEM_OBJECTS: Record<string, boolean> = {
  'sun': true,
  'moon': true,
  'mercury': true,
  'venus': true,
  'earth': true,
  'mars': true,
  'jupiter': true,
  'saturn': true,
  'uranus': true,
  'neptune': true,
  'pluto': true
};

/**
 * Load deep sky objects from CSV file
 * @param filePath Path to the DSO CSV file
 */
export async function loadDSOCatalog(filePath: string): Promise<void> {
  try {
    if (!fs.existsSync(filePath)) {
      console.warn(`DSO catalog file ${filePath} not found. Data from this file will not be loaded.`);
      return;
    }
    const isOpenNGC = filePath.endsWith('ngc.csv') || filePath.includes('NGC.csv');
    const delimiter = isOpenNGC ? ';' : ',';
    const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    await new Promise<void>((resolve, reject) => {
      const parser = parse({ columns: true, skip_empty_lines: true, delimiter });
      parser.on('data', (record: any) => {
        let name = record.name || record.Name || record.id || record.ID || record.Name || '';
        const commonName = record.common_name || record.commonName || record['common name'] || record['Common names'] || '';
        const type = record.type || record.Type || '';
        if (isOpenNGC && record.Name) {
          name = record.Name;
          if (name.startsWith('NGC')) {
            const m = name.match(/^NGC0*([1-9]\d*)$/);
            if (m) name = 'NGC' + m[1];
          }
          if (name.startsWith('IC')) {
            const m = name.match(/^IC0*([1-9]\d*)$/);
            if (m) name = 'IC' + m[1];
          }
        }
        let raHours: number | undefined;
        if (record.ra_hours !== undefined) {
          raHours = parseFloat(record.ra_hours);
        } else if (record.RA !== undefined && String(record.RA).includes(':')) {
          const parts = String(record.RA).split(':');
          if (parts.length === 3) {
            const h = parseFloat(parts[0]);
            const m = parseFloat(parts[1]);
            const s = parseFloat(parts[2]);
            if (!isNaN(h) && !isNaN(m) && !isNaN(s)) raHours = h + m / 60 + s / 3600;
          }
        } else if (record.RA !== undefined) {
          const raDeg = parseFloat(record.RA);
          if (!isNaN(raDeg)) raHours = raDeg / 15;
        }
        let decDegrees: number | undefined;
        if (record.dec_degrees !== undefined) {
          const v = parseFloat(record.dec_degrees);
          if (!isNaN(v)) decDegrees = v;
        } else if (record.Dec !== undefined && String(record.Dec).includes(':')) {
          const decStr = String(record.Dec).trim();
          const parts = decStr.split(':');
          if (parts.length === 3) {
            const sign = decStr.startsWith('-') ? -1 : 1;
            const d = parseFloat(parts[0].replace(/^[+-]/, ''));
            const m = parseFloat(parts[1]);
            const s = parseFloat(parts[2]);
            if (!isNaN(d) && !isNaN(m) && !isNaN(s)) decDegrees = (d + m / 60 + s / 3600) * sign;
          }
        } else if (record.Dec !== undefined) {
          const v = parseFloat(record.Dec);
          if (!isNaN(v)) decDegrees = v;
        }
        if (!name || raHours === undefined || decDegrees === undefined || isNaN(raHours) || isNaN(decDegrees)) return;
        let magnitude: number | undefined;
        const vMagStr = record['V-Mag'] || record.VMAG || record.vmag;
        const bMagStr = record['B-Mag'] || record.BMAG || record.bmag;
        const magStr = record.magnitude || record.Magnitude || record.MAG || record.mag;
        const pick = (x: any) => x !== undefined && String(x).trim() !== '' ? parseFloat(String(x)) : undefined;
        magnitude = pick(vMagStr);
        if (magnitude === undefined) magnitude = pick(bMagStr);
        if (magnitude === undefined) magnitude = pick(magStr);
        const constellation = (record.Constellation || record.CON || record.con || '').trim() || undefined;
        DSO_CATALOG.set(String(name).toLowerCase(), {
          name: name,
          rightAscension: raHours,
          declination: decDegrees,
          commonName: commonName,
          type: type,
          magnitude: magnitude,
          constellation
        });
        if (record.M && record.M !== '') {
          const mnum = parseInt(record.M, 10);
          if (!isNaN(mnum)) {
            const mname = 'M' + mnum.toString();
            DSO_CATALOG.set(mname.toLowerCase(), {
              rightAscension: raHours,
              declination: decDegrees,
              commonName: commonName,
              type: type,
              magnitude: magnitude,
              name: mname,
              constellation
            });
          }
        }
        if (commonName) COMMON_NAMES.set(commonName.toLowerCase(), String(name).toLowerCase());
      });
      parser.on('end', () => {
        console.log(`Loaded ${DSO_CATALOG.size} deep sky objects from ${filePath}`);
        resolve();
      });
      parser.on('error', (e: any) => reject(e));
      stream.pipe(parser);
    });
  } catch (error) {
    console.error(`Failed to load DSO catalog from ${filePath}: ${error}. Data from this file will not be loaded.`);
  }
}

/**
 * Load stars from CSV file
 * @param filePath Path to the stars CSV file
 */
export async function loadStarCatalog(filePath: string): Promise<void> {
  try {
    if (!fs.existsSync(filePath)) {
      console.warn(`Star catalog file ${filePath} not found. Data from this file will not be loaded.`);
      return;
    }
    if (filePath.includes('hygdata_v')) {
      console.log('Using specific parser for HYG database format');
      const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
      await new Promise<void>((resolve, reject) => {
        const parser = parse({ columns: true, skip_empty_lines: true, delimiter: ',' });
        parser.on('data', (record: any) => {
          const hasName = record.proper || record.bf;
          const isBright = record.mag !== undefined && parseFloat(record.mag) < 6.0;
          if (!(hasName || isBright)) return;
          let name = '';
          if (record.proper && record.proper.trim()) name = record.proper.trim();
          else if (record.bf && record.bf.trim()) name = record.bf.trim();
          else if (record.hip && record.hip.trim()) name = 'HIP ' + record.hip.trim();
          else if (record.hd && record.hd.trim()) name = 'HD ' + record.hd.trim();
          else if (record.mag !== undefined && parseFloat(record.mag) < 6.0) {
            name = `Star mag ${parseFloat(record.mag).toFixed(1)}`;
            if (record.con && record.con.trim()) name += ` in ${record.con.trim()}`;
          }
          if (!name) return;
          let raHours: number | undefined;
          let decDegrees: number | undefined;
          if (record.ra !== undefined && record.ra !== null && record.ra !== '') raHours = parseFloat(record.ra);
          if (record.dec !== undefined && record.dec !== null && record.dec !== '') decDegrees = parseFloat(record.dec);
          if (raHours === undefined || decDegrees === undefined || isNaN(raHours) || isNaN(decDegrees)) return;
          let magnitude: number | undefined;
          if (record.mag !== undefined && record.mag !== null && String(record.mag).trim() !== '') {
            const v = parseFloat(String(record.mag));
            if (!isNaN(v)) magnitude = v;
          }
          STAR_CATALOG.set(name.toLowerCase(), {
            name,
            rightAscension: raHours,
            declination: decDegrees,
            magnitude,
            type: 'Star',
            constellation: record.con && String(record.con).trim() ? String(record.con).trim() : undefined
          });
        });
        parser.on('end', () => {
          console.log(`Loaded ${STAR_CATALOG.size} stars from HYG database`);
          resolve();
        });
        parser.on('error', (e: any) => reject(e));
        stream.pipe(parser);
      });
      return;
    }
    const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    await new Promise<void>((resolve, reject) => {
      const parser = parse({ columns: true, skip_empty_lines: true, delimiter: ',' });
      parser.on('data', (record: any) => {
        let name = record.name || record.proper || record.ProperName || '';
        let altName = record.alt_name || record.BayerFlamsteed || '';
        let raHours: number | undefined;
        let decDegrees: number | undefined;
        if (record.ra_hours !== undefined) raHours = parseFloat(record.ra_hours);
        else if (record.RA !== undefined) {
          const ra = parseFloat(record.RA);
          if (!isNaN(ra)) raHours = ra / 15;
        }
        if (record.dec_degrees !== undefined) decDegrees = parseFloat(record.dec_degrees);
        else if (record.Dec !== undefined) decDegrees = parseFloat(record.Dec);
        if (!name || raHours === undefined || decDegrees === undefined || isNaN(raHours) || isNaN(decDegrees)) return;
        let magnitude: number | undefined;
        if (record.mag !== undefined && record.mag !== null && record.mag !== '') {
          const v = parseFloat(record.mag);
          if (!isNaN(v)) magnitude = v;
        }
        const constellation = (record.constellation || record.Constellation || record.con || '').trim() || undefined;
        STAR_CATALOG.set(String(name).toLowerCase(), {
          name,
          rightAscension: raHours,
          declination: decDegrees,
          magnitude,
          type: 'Star',
          constellation
        });
        if (altName) {
          STAR_CATALOG.set(String(altName).toLowerCase(), {
            name,
            rightAscension: raHours,
            declination: decDegrees,
            magnitude,
            type: 'Star',
            constellation
          });
        }
      });
      parser.on('end', () => {
        console.log(`Loaded ${STAR_CATALOG.size} stars from ${filePath}`);
        resolve();
      });
      parser.on('error', (e: any) => reject(e));
      stream.pipe(parser);
    });
  } catch (error) {
    console.error(`Failed to load star catalog from ${filePath}: ${error}. Data from this file will not be loaded.`);
  }
}

/**
 * Initialize catalogs from data files
 */
export async function initializeCatalogs(): Promise<void> {
  // Use a direct path to the data directory
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const dataDir = path.resolve(__dirname, '../../data');
  const projectRoot = path.resolve(__dirname, '../../..'); // Project root for running script
  console.log(`Looking for catalog data in: ${dataDir}`);
  
  // Check if data directory exists
  if (!fs.existsSync(dataDir)) {
    console.warn(`Data directory not found at ${dataDir}. It will be created. The application will attempt to download catalogs.`);
    fs.mkdirSync(dataDir, { recursive: true });
  }
  
  // --- Star Catalog ---
  let starCatalogLoaded = false;
  const primaryStarFiles = [
    'hygdata_v41.csv',
    'stars.csv',
    'bright_stars.csv'
  ];
  // sample_stars.csv is in the repo, so check for it as a last resort among existing files.
  const allStarFilesToCheck = [...primaryStarFiles, 'sample_stars.csv']; 

  for (const file of allStarFilesToCheck) {
    const filePath = path.join(dataDir, file);
    if (fs.existsSync(filePath)) {
      console.log(`Loading star catalog from ${filePath}`);
      await loadStarCatalog(filePath);
      starCatalogLoaded = true;
      break;
    }
  }

  if (!starCatalogLoaded) {
    console.warn('No star catalog file was successfully loaded, even after download attempt. Star catalog will be empty or incomplete.');
    // STAR_CATALOG will remain as it is (likely empty).
  }

  // --- DSO Catalog ---
  let dsoCatalogLoaded = false;
  const primaryDsoFiles = [
    'ngc.csv',
    'messier.csv',
    'dso.csv'
  ];
  // sample_dso.csv is in the repo, so check for it as a last resort among existing files.
  const allDsoFilesToCheck = [...primaryDsoFiles, 'sample_dso.csv'];

  for (const file of allDsoFilesToCheck) {
    const filePath = path.join(dataDir, file);
    if (fs.existsSync(filePath)) {
      console.log(`Loading DSO catalog from ${filePath}`);
      await loadDSOCatalog(filePath);
      dsoCatalogLoaded = true;
      break;
    }
  }

  if (!dsoCatalogLoaded) {
    console.warn('No DSO catalog file was successfully loaded, even after download attempt. DSO catalog will be empty or incomplete.');
    // DSO_CATALOG will remain as it is (likely empty).
  }
}


/**
 * Calculate solar system object positions using astronomy-engine
 */
function getSolarSystemCoordinates(name: string, date: Date): EquatorialCoordinates {
  // Create a default observer for equatorial coordinates (geocentric)
  const defaultObserver = new Astronomy.Observer(0, 0, 0);
  
  // Handle special case for sun and moon
  if (name === 'sun') {
    const equ = Astronomy.Equator(Astronomy.Body.Sun, date, defaultObserver, false, true);
    return {
      rightAscension: equ.ra,
      declination: equ.dec
    };
  } else if (name === 'moon') {
    const equ = Astronomy.Equator(Astronomy.Body.Moon, date, defaultObserver, false, true);
    return {
      rightAscension: equ.ra,
      declination: equ.dec
    };
  }

  // Convert name to Body enum for planets
  // Capitalize first letter to match Body enum format
  const bodyName = name.charAt(0).toUpperCase() + name.slice(1);
  let body;
  
  try {
    // Use bracket notation with type checking
    if (bodyName in Astronomy.Body) {
      body = Astronomy.Body[bodyName as keyof typeof Astronomy.Body];
    } else {
      throw new Error(`Unknown solar system object: ${name}`);
    }
  } catch (e) {
    throw new Error(`Unknown solar system object: ${name}`);
  }
  
  // Get equatorial coordinates using astronomy-engine
  const equ = Astronomy.Equator(body, date, defaultObserver, false, true);
  
  return {
    rightAscension: equ.ra,
    declination: equ.dec
  };
}

/**
 * Get equatorial coordinates for a celestial object at a specific time
 * @param objectName Name of the celestial object
 * @param date Date and time of observation
 * @returns Equatorial coordinates (right ascension and declination)
 */
export async function getEquatorialCoordinates(objectName: string, date: Date): Promise<EquatorialCoordinates> {
  // Normalize object name to lowercase for case-insensitive matching
  const normalizedName = objectName.toLowerCase();
  
  // Handle solar system objects
  if (SOLAR_SYSTEM_OBJECTS[normalizedName]) {
    return getSolarSystemCoordinates(normalizedName, date);
  }
  
  // Check if it's a common name (like "Andromeda Galaxy" instead of "M31")
  if (COMMON_NAMES.has(normalizedName)) {
    const catalogName = COMMON_NAMES.get(normalizedName)!;
    const dsoObject = DSO_CATALOG.get(catalogName);
    if (dsoObject) {
      return dsoObject;
    }
  }
  
  // Check for direct matches in catalogs
  if (STAR_CATALOG.has(normalizedName)) {
    return STAR_CATALOG.get(normalizedName)!;
  }
  
  if (DSO_CATALOG.has(normalizedName)) {
    return DSO_CATALOG.get(normalizedName)!;
  }
  
  // If we reach here, the object is not recognized
  throw new Error(`Unknown celestial object: ${objectName}. Try running 'npm run fetch-catalogs' to download more complete star and deep sky object databases.`);
}

/**
 * Convert equatorial coordinates to horizontal (altitude-azimuth) coordinates using astronomy-engine
 */
export function convertToAltAz(
  coords: EquatorialCoordinates,
  observer: Observer,
  date: Date
): HorizontalCoordinates {
  // We already have an astroObserver defined above
  
  // Determine refraction mode - must be one of the preset strings
  // Available options are: 'none', 'normal', 'jplhor'
  // For simplicity, we'll just use 'normal' which includes standard refraction
  const refraction = 'normal';
  
  // Convert equatorial to horizontal coordinates
  const astroObserver = new Astronomy.Observer(
    observer.latitude,
    observer.longitude,
    observer.elevation
  );
  
  const hor = Astronomy.Horizon(
    date,
    astroObserver,
    coords.rightAscension,
    coords.declination,
    refraction
  );
  
  return {
    altitude: hor.altitude,
    azimuth: hor.azimuth
  };
}

/**
 * List all celestial objects from catalogs
 * @param category Optional category filter ('stars', 'planets', 'dso', or 'all')
 * @returns Array of objects grouped by category
 */
/**
 * Get additional information about a celestial object
 */
export function getObjectDetails(objectName: string, date: Date, observer: Observer): any {
  const normalizedName = objectName.toLowerCase();
  
  // Create astronomy-engine Observer reference for this function
  let astroObserver = new Astronomy.Observer(
    observer.latitude,
    observer.longitude,
    observer.elevation
  );
  
  // Check if this is a solar system object
  const isSolarSystemObject = SOLAR_SYSTEM_OBJECTS[normalizedName] ? true : false;
  
  // If not a solar system object, we still want to try calculating rise/set times
  // First, we need to get the equatorial coordinates
  let equatorialCoords: EquatorialCoordinates | null = null;
  
  // Need to check star and DSO catalogs for this object
  if (STAR_CATALOG.has(normalizedName)) {
    equatorialCoords = STAR_CATALOG.get(normalizedName)!;
  } else if (DSO_CATALOG.has(normalizedName)) {
    equatorialCoords = DSO_CATALOG.get(normalizedName)!;
  } else if (COMMON_NAMES.has(normalizedName)) {
    const catalogName = COMMON_NAMES.get(normalizedName)!;
    if (DSO_CATALOG.has(catalogName)) {
      equatorialCoords = DSO_CATALOG.get(catalogName)!;
    }
  }
  
  // If we found coordinates for a star or DSO, calculate rise/set times
  if (equatorialCoords && !isSolarSystemObject) {
    // Create a "star" body dynamically using Astronomy.DefineStar
    const tempStarName = "Star1"; // Use one of the predefined star slots
    
    // Register the star's coordinates for use with astronomy-engine
    Astronomy.DefineStar(
      Astronomy.Body.Star1,
      equatorialCoords.rightAscension, // RA in hours
      equatorialCoords.declination,    // Dec in degrees
      1000 // Distance in light years - not critical for rise/set calculations
    );
    
    const startTime = new Date(date);
    startTime.setHours(0, 0, 0, 0); // Start of the current day
    
    let riseAstroTime, transitAstroEvent, setAstroTime, lowerCulminationEvent;
    
    try { riseAstroTime = Astronomy.SearchRiseSet(Astronomy.Body.Star1, astroObserver, 1, startTime, 1); } catch (e) { riseAstroTime = null; }
    try { transitAstroEvent = Astronomy.SearchHourAngle(Astronomy.Body.Star1, astroObserver, 0, startTime, 1); } catch (e) { transitAstroEvent = null; } // Upper culmination
    try { setAstroTime = Astronomy.SearchRiseSet(Astronomy.Body.Star1, astroObserver, -1, startTime, 1); } catch (e) { setAstroTime = null; }
    try { lowerCulminationEvent = Astronomy.SearchHourAngle(Astronomy.Body.Star1, astroObserver, 12, startTime, 1); } catch (e) { lowerCulminationEvent = null; } // Lower culmination

    // Rise/Set times are AstroTime objects from astronomy-engine, or null.
    // The .date property of AstroTime is a JS Date.
    // For fixed objects, we convert to JS Date directly here for rise/set.
    const riseDate = riseAstroTime ? new Date(riseAstroTime.date) : null;
    const setDate = setAstroTime ? new Date(setAstroTime.date) : null;
    // For transit, transitAstroEvent is { time: AstroTime, hor: HorizontalCoordinates }
    // We pass transitAstroEvent.time (which is AstroTime) to the tool.

    let isCircumpolar = false;
    let alwaysAboveHorizon = false;
    let alwaysBelowHorizon = false;

    // Check for circumpolar status: |Dec| > 90 - |Lat|
    const isPotentiallyCircumpolar = Math.abs(equatorialCoords.declination) > (90 - Math.abs(observer.latitude));

    if (isPotentiallyCircumpolar) {
        isCircumpolar = true;
        // If it's circumpolar, check culminations to determine if always visible/invisible.
        if (lowerCulminationEvent && lowerCulminationEvent.hor && lowerCulminationEvent.hor.altitude > 0) {
            alwaysAboveHorizon = true; // Min altitude (lower culmination) is above horizon.
        }
        if (transitAstroEvent && transitAstroEvent.hor && transitAstroEvent.hor.altitude < 0) {
            alwaysBelowHorizon = true; // Max altitude (upper culmination) is below horizon.
        }

        // Fallback if culmination data is incomplete but rise/set are null
        if (!alwaysAboveHorizon && !alwaysBelowHorizon) { // If not determined by culminations yet
            if (riseDate === null && setDate === null && transitAstroEvent && transitAstroEvent.hor) {
                if (transitAstroEvent.hor.altitude > 0) {
                    alwaysAboveHorizon = true; 
                } else {
                    alwaysBelowHorizon = true;
                }
            }
        }
    }

    return {
      riseTime: riseDate,
      transitTime: transitAstroEvent ? { time: transitAstroEvent.time, hor: transitAstroEvent.hor } : null,
      setTime: setDate,
      isFixedObject: true,
      isCircumpolar: isCircumpolar,
      alwaysAboveHorizon: alwaysAboveHorizon,
      alwaysBelowHorizon: alwaysBelowHorizon
    };
  }
  
  // Only continue with solar system object handling if this is a solar system object
  if (!isSolarSystemObject) {
    return null;
  }
  
  // We already created the astroObserver variable above, so just update it
  astroObserver = new Astronomy.Observer(
    observer.latitude,
    observer.longitude,
    observer.elevation
  );
  
  // Convert name to Body enum
  const bodyName = normalizedName.charAt(0).toUpperCase() + normalizedName.slice(1);
  let body;
  
  if (normalizedName === 'sun') {
    body = Astronomy.Body.Sun;
  } else if (normalizedName === 'moon') {
    body = Astronomy.Body.Moon;
  } else if (bodyName in Astronomy.Body) {
    body = Astronomy.Body[bodyName as keyof typeof Astronomy.Body];
  } else {
    return null; // Unknown body
  }
  
  if (!body) {
    return null;
  }
  
  // Find rise, set, and culmination times
  const now = date;
  const startTime = new Date(now);
  startTime.setHours(0, 0, 0, 0);
  
  let riseTime, transitTime, setTime;
  
  try {
    riseTime = Astronomy.SearchRiseSet(body, astroObserver, 1, startTime, 1);
  } catch (e) {
    riseTime = null; // Object may not rise
  }
  
  try {
    transitTime = Astronomy.SearchHourAngle(body, astroObserver, 0, startTime, 1);
  } catch (e) {
    transitTime = null;
  }
  
  try {
    setTime = Astronomy.SearchRiseSet(body, astroObserver, -1, startTime, 1);
  } catch (e) {
    setTime = null; // Object may not set
  }
  
  // Get distance (for planets, moon)
  let distance = null;
  if (body !== Astronomy.Body.Sun && body !== Astronomy.Body.Earth) {
    try {
      // For the moon, use a different approach
      if (body === Astronomy.Body.Moon) {
        const moonVec = Astronomy.GeoMoon(date);
        distance = {
          au: moonVec.Length(),
          km: moonVec.Length() * Astronomy.KM_PER_AU
        };
      } else {
        // For planets - calculate distance using position vectors
        const bodyPos = Astronomy.HelioVector(body, date);
        const earthPos = Astronomy.HelioVector(Astronomy.Body.Earth, date);
        // Calculate the difference vector
        const dx = bodyPos.x - earthPos.x;
        const dy = bodyPos.y - earthPos.y;
        const dz = bodyPos.z - earthPos.z;
        // Calculate the distance
        const distAu = Math.sqrt(dx*dx + dy*dy + dz*dz);
        distance = {
          au: distAu,
          km: distAu * Astronomy.KM_PER_AU
        };
      }
    } catch (e) {
      // Some objects might not have distance calculation
    }
  }
  
  // Get phase information (for moon and planets)
  let phaseInfo = null;
  if (body !== Astronomy.Body.Sun && body !== Astronomy.Body.Earth) {
    try {
      const illumination = Astronomy.Illumination(body, date);
      phaseInfo = {
        phaseAngle: illumination.phase_angle,
        phasePercent: illumination.phase_fraction * 100,
        isWaxing: illumination.phase_angle < 180
      };
    } catch (e) {
      // Some objects might not have phase calculation
    }
  }
  
  // For the moon, get next phase times
  let moonPhases = null;
  if (body === Astronomy.Body.Moon) {
    moonPhases = {
      nextNewMoon: Astronomy.SearchMoonPhase(0, date, 40),
      nextFirstQuarter: Astronomy.SearchMoonPhase(90, date, 40),
      nextFullMoon: Astronomy.SearchMoonPhase(180, date, 40),
      nextLastQuarter: Astronomy.SearchMoonPhase(270, date, 40)
    };
  }
  
  return {
    riseTime,
    transitTime,
    setTime,
    distance,
    phaseInfo,
    moonPhases
  };
}

/**
 * Star hopping utility functions
 */
export function findNearbyStars(
  targetCoords: EquatorialCoordinates,
  maxDistance: number, // in degrees
  date: Date
): { name: string, coords: EquatorialCoordinates }[] {
  const nearbyStars: { name: string, coords: EquatorialCoordinates }[] = [];
  
  // Convert max distance from degrees to radians
  const maxDistRad = maxDistance * (Math.PI / 180);
  
  // Search through star catalog
  for (const [name, coords] of STAR_CATALOG.entries()) {
    // Skip the target star itself
    if (name.toLowerCase() === targetCoords.name?.toLowerCase()) {
      continue;
    }
    
    // Calculate angular distance using spherical law of cosines
    const sinDec1 = Math.sin(targetCoords.declination * (Math.PI / 180));
    const cosDec1 = Math.cos(targetCoords.declination * (Math.PI / 180));
    const sinDec2 = Math.sin(coords.declination * (Math.PI / 180));
    const cosDec2 = Math.cos(coords.declination * (Math.PI / 180));
    const deltaRA = (coords.rightAscension - targetCoords.rightAscension) * (Math.PI / 180);
    
    // Angular distance in radians
    const angularDistance = Math.acos(sinDec1 * sinDec2 + cosDec1 * cosDec2 * Math.cos(deltaRA));
    
    // If the distance is within the maxDistance, add to results
    if (angularDistance <= maxDistRad) {
      nearbyStars.push({ name, coords });
    }
  }
  
  return nearbyStars;
}

/**
 * List all celestial objects from catalogs
 * @param category Optional category filter ('stars', 'planets', 'dso', or 'all')
 * @returns Array of objects grouped by category
 */
export function listCelestialObjects(category: string = 'all'): { category: string, objects: string[] }[] {
  const result: { category: string, objects: string[] }[] = [];
  
  if (category === 'all' || category === 'planets') {
    result.push({
      category: 'Solar System Objects',
      objects: Object.keys(SOLAR_SYSTEM_OBJECTS).map(name => 
        name.charAt(0).toUpperCase() + name.slice(1) // Capitalize first letter
      )
    });
  }
  
  if (category === 'all' || category === 'stars') {
    // Get unique star names and sort them
    const starNames = Array.from(new Set(
      Array.from(STAR_CATALOG.keys()).map(name => 
        name.charAt(0).toUpperCase() + name.slice(1) // Capitalize first letter
      )
    )).sort();
    
    result.push({
      category: 'Stars',
      objects: starNames
    });
  }
  
  if (category === 'all' || category === 'dso' ||
      category === 'messier' || category === 'ic' || category === 'ngc') {

    const messierObjects: string[] = [];
    const icObjects: string[] = [];
    const ngcObjects: string[] = [];
    const otherDsoObjects: string[] = [];

    Array.from(DSO_CATALOG.keys()).forEach(name => {
      const formattedName = name.charAt(0).toUpperCase() + name.slice(1);

      if (name.startsWith('m') && /^m\d+$/i.test(name)) {
        messierObjects.push(formattedName);
      } else if (name.startsWith('ic') && /^ic\d+$/i.test(name)) {
        icObjects.push(formattedName);
      } else if (name.startsWith('ngc') && /^ngc\d+$/i.test(name)) {
        ngcObjects.push(formattedName);
      } else {
        otherDsoObjects.push(formattedName);
      }
    });

    if ((category === 'all' || category.toLowerCase() === 'messier' || category.toLowerCase() === 'dso') && messierObjects.length > 0) {
      result.push({
        category: 'Messier Objects',
        objects: messierObjects.sort((a, b) => {
          const numA = parseInt(a.substring(1));
          const numB = parseInt(b.substring(1));
          return numA - numB;
        })
      });
    }

    if ((category === 'all' || category.toLowerCase() === 'ic' || category.toLowerCase() === 'dso') && icObjects.length > 0) {
      result.push({
        category: 'IC Objects',
        objects: icObjects.sort((a, b) => {
          const numA = parseInt(a.substring(2));
          const numB = parseInt(b.substring(2));
          return numA - numB;
        })
      });
    }

    if ((category === 'all' || category.toLowerCase() === 'ngc' || category.toLowerCase() === 'dso') && ngcObjects.length > 0) {
      result.push({
        category: 'NGC Objects',
        objects: ngcObjects.sort((a, b) => {
          const numA = parseInt(a.substring(3));
          const numB = parseInt(b.substring(3));
          return numA - numB;
        })
      });
    }
    
    if ((category === 'all' || category.toLowerCase() === 'dso') && otherDsoObjects.length > 0) {
        result.push({
            category: 'Other Deep Sky Objects',
            objects: otherDsoObjects.sort()
        });
    }
  }
  
  return result;
}

// Corrected export of calculateAngularSeparation
export function calculateAngularSeparation(
  coords1: { rightAscension: number; declination: number },
  coords2: { rightAscension: number; declination: number }
): number {
  // Use the spherical law of cosines for angular separation
  const ra1Rad = coords1.rightAscension * 15 * Math.PI / 180;
  const ra2Rad = coords2.rightAscension * 15 * Math.PI / 180;
  const dec1Rad = coords1.declination * Math.PI / 180;
  const dec2Rad = coords2.declination * Math.PI / 180;

  const cosDeltaSigma =
    Math.sin(dec1Rad) * Math.sin(dec2Rad) +
    Math.cos(dec1Rad) * Math.cos(dec2Rad) * Math.cos(ra1Rad - ra2Rad);

  // Clamp the value to [-1, 1] to avoid NaN from Math.acos due to floating point inaccuracies
  const clampedCosDeltaSigma = Math.max(-1, Math.min(1, cosDeltaSigma));

  return Math.acos(clampedCosDeltaSigma) * (180 / Math.PI);
}

// Corrected export of calculateBearing
export function calculateBearing(
  coords1: { rightAscension: number; declination: number },
  coords2: { rightAscension: number; declination: number }
): { degrees: number; cardinal: string } {
  // Compute position angle (bearing) from coords1 to coords2
  const ra1Rad = coords1.rightAscension * 15 * Math.PI / 180;
  const ra2Rad = coords2.rightAscension * 15 * Math.PI / 180;
  const dec1Rad = coords1.declination * Math.PI / 180;
  const dec2Rad = coords2.declination * Math.PI / 180;

  // Formula for position angle (bearing) from coords1 to coords2
  const y = Math.sin(ra2Rad - ra1Rad);
  const x = Math.cos(dec1Rad) * Math.tan(dec2Rad) - Math.sin(dec1Rad) * Math.cos(ra2Rad - ra1Rad);
  let angleDegrees = Math.atan2(y, x) * (180 / Math.PI);
  if (angleDegrees < 0) angleDegrees += 360;

  const directions = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  // Ensure positive index before modulo, and handle potential floating point inaccuracies for rounding.
  // Adding 0.001 before rounding helps stabilize index selection for angles very close to a boundary (e.g. 359.99 deg)
  const index = Math.round((angleDegrees / 22.5) + 0.001) % 16;
  const cardinal = directions[index];

  return { degrees: parseFloat(angleDegrees.toFixed(1)), cardinal };
}
