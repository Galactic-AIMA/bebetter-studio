import dotenv from 'dotenv'
import path from 'path'

dotenv.config()

export const config = {
  port: parseInt(process.env.PORT || '3001'),
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  publicBaseUrl: process.env.PUBLIC_BASE_URL || 'http://localhost:3001',

  paths: {
    images: process.env.IMAGES_PATH || path.join(__dirname, '../../data/images'),
    output: process.env.OUTPUT_PATH || path.join(__dirname, '../../output'),
    fonts: process.env.FONTS_PATH || path.join(__dirname, '../../data/fonts'),
    phrases: path.join(__dirname, '../../data/phrases.json'),
  },

  aws: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    region: process.env.AWS_REGION || 'us-east-1',
    bucket: process.env.AWS_S3_BUCKET || '',
  },

  webhooks: {
    test: process.env.WEBHOOK_TEST_URL || '',
    prod: process.env.WEBHOOK_PROD_URL || '',
  },

  watermark: {
    path: process.env.WATERMARK_PATH || '',
  },

  pinterest: {
    appId: process.env.PINTEREST_APP_ID || '',
    appSecret: process.env.PINTEREST_APP_SECRET || '',
    boardId: process.env.PINTEREST_BOARD_ID || '',
    credentialsPath: path.resolve(
      process.env.PINTEREST_CREDENTIALS_PATH || path.join(__dirname, '../../credentials/pinterest-token.json')
    ),
  },
}
