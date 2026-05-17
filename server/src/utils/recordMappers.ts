import { VideoRecord, ImageRecord, VideoConfig, ImageConfig } from '../types'

export function rowToVideoRecord(row: any): VideoRecord {
  const configExtra = row.config_extra ? JSON.parse(row.config_extra) : {}
  const config: VideoConfig = {
    ...configExtra,
    text: {
      ...(configExtra.text ?? {}),
      font: row.font ?? configExtra.text?.font ?? 'Inter-Bold',
    },
    textEffect: row.effect ?? configExtra.textEffect,
    resolution: row.resolution
      ? { width: parseInt(row.resolution.split('x')[0]), height: parseInt(row.resolution.split('x')[1]) }
      : (configExtra.resolution ?? { width: 1080, height: 1920 }),
  }
  return {
    id: row.id,
    filename: row.filename,
    title: row.title ?? '',
    description: row.description ?? '',
    tags: row.tags ? JSON.parse(row.tags) : [],
    localPath: row.local_path ?? '',
    publicUrl: row.public_url ?? '',
    s3Url: row.s3_url ?? undefined,
    driveUrl: row.drive_url ?? undefined,
    phraseId: row.phrase_id ?? undefined,
    viral: row.viral === 1,
    createdAt: row.created_at,
    config,
  }
}

export function rowToImageRecord(row: any): ImageRecord {
  const config: ImageConfig = row.config_extra ? JSON.parse(row.config_extra) : {}
  return {
    id: row.id,
    filename: row.filename,
    localPath: row.local_path ?? '',
    publicUrl: row.public_url ?? '',
    driveUrl: row.drive_url ?? undefined,
    phraseId: row.phrase_id ?? undefined,
    variant: row.variant ?? 'combined',
    viral: row.viral === 1,
    createdAt: row.created_at,
    config,
  }
}
