import { z } from 'zod'

const TextConfigSchema = z.object({
  content: z.string(),
  font: z.string(),
  fontSize: z.number().min(8).max(200),
  color: z.string(),
  position: z.object({ x: z.number(), y: z.number() }),
  align: z.enum(['left', 'center', 'right']),
  shadow: z.boolean(),
  maxWidth: z.number().min(10).max(100),
  lineHeight: z.number().min(0.5).max(3),
})

const WatermarkConfigSchema = z.object({
  enabled: z.boolean(),
  position: z.enum(['left', 'center', 'right']),
  y: z.number().min(0).max(100).optional(),
  type: z.enum(['image', 'text']).optional(),
  text: z.string().optional(),
  opacity: z.number().min(0).max(1).optional(),
})

const ResolutionSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
})

export const GenerateVideoSchema = z.object({
  config: z.object({
    imageId: z.string().min(1),
    imagePath: z.string().min(1),
    duration: z.number().min(1).max(300),
    transition: z.enum(['fade', 'fadeBlack', 'none']),
    transitionDuration: z.number().min(0).max(10),
    text: TextConfigSchema,
    textEffect: z.enum(['none', 'fadeIn', 'slideUp', 'glowPulse']).optional(),
    grain: z.boolean().optional(),
    resolution: ResolutionSchema,
    outputName: z.string().optional(),
    wrappedLines: z.array(z.string()).optional(),
    watermark: WatermarkConfigSchema.optional(),
  }),
  phraseId: z.string().optional(),
})

export const GenerateImageSchema = z.object({
  config: z.object({
    imageId: z.string().min(1),
    imagePath: z.string().min(1),
    text: TextConfigSchema,
    resolution: ResolutionSchema,
    watermark: WatermarkConfigSchema.optional(),
  }),
  phraseId: z.string().optional(),
  variant: z.enum(['combined', 'hook', 'punchline']).optional(),
})
