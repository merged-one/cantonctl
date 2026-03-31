import * as fs from 'node:fs'
import * as path from 'node:path'
import * as yaml from 'js-yaml'
import {z} from 'zod'

const PartySchema = z.object({
  name: z.string(),
  role: z.enum(['operator', 'participant', 'observer']).optional(),
})

const NetworkSchema = z.object({
  auth: z.enum(['jwt', 'shared-secret', 'none']).optional(),
  'json-api-port': z.number().optional(),
  port: z.number().optional(),
  type: z.enum(['sandbox', 'remote', 'docker']),
  url: z.string().optional(),
})

const ConfigSchema = z.object({
  networks: z.record(z.string(), NetworkSchema).optional(),
  parties: z.array(PartySchema).optional(),
  plugins: z.array(z.string()).optional(),
  project: z.object({
    name: z.string(),
    'sdk-version': z.string(),
    template: z.string().optional(),
  }),
  version: z.number(),
})

export type CantonctlConfig = z.infer<typeof ConfigSchema>

const CONFIG_FILENAME = 'cantonctl.yaml'

export async function loadConfig(dir?: string): Promise<CantonctlConfig> {
  const searchDir = dir ?? process.cwd()
  const configPath = findConfig(searchDir)

  if (!configPath) {
    throw new Error(
      `No ${CONFIG_FILENAME} found. Run "cantonctl init" to create a project.`,
    )
  }

  const raw = fs.readFileSync(configPath, 'utf8')
  const parsed = yaml.load(raw)
  return ConfigSchema.parse(parsed)
}

function findConfig(startDir: string): string | undefined {
  let current = startDir
  while (true) {
    const candidate = path.join(current, CONFIG_FILENAME)
    if (fs.existsSync(candidate)) return candidate
    const parent = path.dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}
