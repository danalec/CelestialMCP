import { MCPTool } from 'mcp-framework'
import { z } from 'zod'
import { OBSERVER_CONFIG } from '../config.js'
import { getEquatorialCoordinates, convertToAltAz, EquatorialCoordinates } from '../utils/astronomy.js'

interface EphemerisStreamInput {
  objects: string[]
  cadenceMinutes?: number
  durationMinutes?: number
  latitude?: number
  longitude?: number
  altitude?: number
  temperature?: number
  pressure?: number
  minAltitude?: number
  startTime?: string
}

class EphemerisStreamTool extends MCPTool<EphemerisStreamInput> {
  name = 'getEphemerisStream'
  description = 'Generates a time series of altitude/azimuth for selected objects over a period at a fixed cadence. Useful for live tracking or periodic polling.'

  protected schema = {
    objects: {
      type: z.array(z.string()),
      description: 'List of object names or catalog identifiers to track.'
    },
    cadenceMinutes: {
      type: z.number().positive().optional().default(5),
      description: 'Sampling cadence in minutes. Default: 5.'
    },
    durationMinutes: {
      type: z.number().positive().optional().default(60),
      description: 'Total duration in minutes to generate samples for. Default: 60.'
    },
    latitude: {
      type: z.number().optional(),
      description: 'Observer latitude in degrees. Optional.'
    },
    longitude: {
      type: z.number().optional(),
      description: 'Observer longitude in degrees. Optional.'
    },
    altitude: {
      type: z.number().optional(),
      description: 'Observer altitude in meters. Optional.'
    },
    temperature: {
      type: z.number().optional(),
      description: 'Ambient temperature in Celsius. Optional.'
    },
    pressure: {
      type: z.number().optional(),
      description: 'Pressure in hPa. Optional.'
    },
    minAltitude: {
      type: z.number().optional().default(0),
      description: 'Minimum altitude filter in degrees. Default: 0.'
    },
    startTime: {
      type: z.string().optional(),
      description: 'ISO start time for the stream. Defaults to now.'
    }
  }

  async execute(params: EphemerisStreamInput) {
    const cadence = params.cadenceMinutes ?? 5
    const duration = params.durationMinutes ?? 60
    const minAlt = params.minAltitude ?? 0
    const start = params.startTime ? new Date(params.startTime) : new Date()
    const observer = {
      latitude: params.latitude ?? OBSERVER_CONFIG.latitude,
      longitude: params.longitude ?? OBSERVER_CONFIG.longitude,
      elevation: params.altitude ?? OBSERVER_CONFIG.altitude,
      temperature: params.temperature ?? OBSERVER_CONFIG.temperature,
      pressure: params.pressure ?? OBSERVER_CONFIG.pressure
    }

    const frames: any[] = []

    for (let m = 0; m <= duration; m += cadence) {
      const t = new Date(start.getTime() + m * 60000)
      for (const name of params.objects) {
        let eq: EquatorialCoordinates
        try {
          eq = await getEquatorialCoordinates(name, t)
        } catch (e: any) {
          continue
        }
        const hor = convertToAltAz(eq, observer, t)
        if (hor.altitude < minAlt) continue
        frames.push({
          object: name,
          time: t.toISOString(),
          altitude: parseFloat(hor.altitude.toFixed(2)),
          azimuth: parseFloat(hor.azimuth.toFixed(2)),
          aboveHorizon: hor.altitude > 0,
          ...(typeof eq.magnitude === 'number' && { apparentMagnitude: eq.magnitude }),
          ...(eq.constellation && { constellation: eq.constellation }),
          ...(eq.type && { objectType: eq.type })
        })
      }
    }

    frames.sort((a, b) => a.time.localeCompare(b.time) || a.object.localeCompare(b.object))

    return {
      observer: {
        latitude: observer.latitude,
        longitude: observer.longitude,
        altitude: observer.elevation
      },
      cadenceMinutes: cadence,
      durationMinutes: duration,
      suggestedPollIntervalSeconds: cadence * 60,
      samples: frames
    }
  }
}

export default EphemerisStreamTool