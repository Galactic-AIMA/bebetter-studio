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
  region: config.aws.region,
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

  return `https://${config.aws.bucket}.s3.${config.aws.region}.amazonaws.com/${key}`
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
