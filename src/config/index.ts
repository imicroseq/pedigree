export const config = {
	analysis: {
		typeName: process.env.ANALYSIS_TYPE_NAME || 'consensus_sequence',
	},
	ego: {
		clientId: process.env.EGO_CLIENT_ID || '',
		clientSecret: process.env.EGO_CLIENT_SECRET || '',
		url: process.env.EGO_URL || '',
	},
	gs: {
		bucket: process.env.GS_BUCKET_NAME || '',
		folder: process.env.GS_FOLDER || '',
		localFilePath: process.env.LOCAL_FILE_PATH || '',
	},
	jwt: {
		key: process.env.JWT_KEY || '',
		url: process.env.JWT_KEY_URL || '',
	},
	notifications: {
		slack_url: process.env.NOTIFICATIONS_SLACK_URL || '',
	},
	redis: {
		host: process.env.REDIS_HOST || 'localhost',
		password: process.env.REDIS_PASSWORD || '',
		port: parseInt(process.env.REDIS_PORT || '6379'),
	},
	server: {
		apiRetries: parseInt(process.env.API_RETRIES || '3'),
		apiTimeout: parseInt(process.env.API_TIMEOUT || '10000'),
		debug: process.env.ENABLE_DEBUG === 'true',
		timezone: process.env.TIMEZONE || 'America/Toronto',
	},
	song: {
		endpoint: process.env.SONG_ENDPOINT || '',
		patchConcurrency: parseInt(process.env.SONG_PATCH_CONCURRENCY || '5'),
	},
};
