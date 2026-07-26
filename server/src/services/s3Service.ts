import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import fs from 'fs'
import path from 'path'
import { config } from '../config'

const s3 = new S3Client({
  region: 'auto',
  endpoint: config.aws.endpoint,
  credentials: {
    accessKeyId: config.aws.accessKeyId,
    secretAccessKey: config.aws.secretAccessKey,
  },
})

export async function uploadVideoToS3(
  localPath: string,
  filename: string
): Promise<string> {
  const fileStream = fs.createReadStream(localPath)
  const key = `videos/${filename}`

  await s3.send(
    new PutObjectCommand({
      Bucket: config.aws.bucket,
      Key: key,
      Body: fileStream,
      ContentType: 'video/mp4',
    })
  )

  return `${config.aws.publicUrl}/${key}`
}

export async function uploadThumbnailToS3(
  localPath: string,
  filename: string
): Promise<string> {
  const fileStream = fs.createReadStream(localPath)
  const key = `thumbnails/${filename}`

  await s3.send(
    new PutObjectCommand({
      Bucket: config.aws.bucket,
      Key: key,
      Body: fileStream,
      ContentType: 'image/jpeg',
    })
  )

  return `${config.aws.publicUrl}/${key}`
}

// Sube una slide de carrusel a R2 y devuelve su URL pública.
// Meta exige URLs públicas accesibles para crear los contenedores de media —
// las rutas locales (/output/...) no sirven. Key: carruseles/<id>/slide_N.png
export async function uploadCarouselSlideToS3(
  localPath: string,
  carouselId: string,
  filename: string
): Promise<string> {
  const fileStream = fs.createReadStream(localPath)
  const key = `carruseles/${carouselId}/${filename}`

  await s3.send(
    new PutObjectCommand({
      Bucket: config.aws.bucket,
      Key: key,
      Body: fileStream,
      ContentType: 'image/png',
    })
  )

  return `${config.aws.publicUrl}/${key}`
}

export async function getPresignedUrl(
  filename: string,
  expiresIn = 3600
): Promise<string> {
  const key = `videos/${filename}`
  const command = new GetObjectCommand({
    Bucket: config.aws.bucket,
    Key: key,
  })
  return getSignedUrl(s3, command, { expiresIn })
}
